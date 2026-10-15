-- LuLab Desk — notifiche Web Push
-- Migrazione incrementale dopo 001–005. Non abilita servizi remoti né invii.
begin;

create type public.push_notification_category as enum (
  'site_inquiry', 'appointment', 'job_delivery', 'quote_follow_up'
);
create type public.push_job_status as enum ('pending', 'processing', 'sent');
create type public.push_reminder_source as enum (
  'site_inquiry', 'agenda_event', 'antitarlo_treatment', 'job_due_date', 'agenda_delivery', 'quote_send_cycle'
);

-- Le preferenze sono personali e possono essere lette/modificate solo dal proprietario.
create table public.push_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  site_inquiries_enabled boolean not null default true,
  appointments_enabled boolean not null default true,
  job_deliveries_enabled boolean not null default true,
  quotes_enabled boolean not null default true,
  appointment_days_before smallint not null default 1 check (appointment_days_before between 1 and 30),
  appointment_hour smallint not null default 18 check (appointment_hour between 0 and 23),
  delivery_days_before smallint not null default 2 check (delivery_days_before between 1 and 30),
  delivery_hour smallint not null default 9 check (delivery_hour between 0 and 23),
  quote_days_after smallint not null default 7 check (quote_days_after between 1 and 60),
  quote_hour smallint not null default 10 check (quote_hour between 0 and 23),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sottoscrizioni e coda sono dati riservati al backend. Nessuna policy client:
-- browser e utenti authenticated non possono leggere endpoint o chiavi push.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 32 and 4096),
  p256dh text not null check (char_length(p256dh) between 32 and 256),
  auth_key text not null check (char_length(auth_key) between 16 and 256),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);

create table public.push_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  category public.push_notification_category not null,
  source_kind public.push_reminder_source not null,
  source_id uuid not null,
  source_marker text not null,
  -- NULL è ammesso soltanto per l'audience editoriale delle richieste del sito.
  recipient_user_id uuid,
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 240),
  title text not null check (char_length(title) between 1 and 80),
  body text not null check (char_length(body) between 1 and 160),
  target_path text not null check (target_path like '/%' and target_path not like '//%'),
  scheduled_for timestamptz not null default now(),
  status public.push_job_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check ((category = 'site_inquiry' and recipient_user_id is null) or
         (category <> 'site_inquiry' and recipient_user_id is not null))
);
create index push_jobs_dispatch_idx on public.push_notification_jobs(status, scheduled_for, created_at);
create index push_jobs_recipient_idx on public.push_notification_jobs(recipient_user_id, category);

create table public.push_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.push_notification_jobs(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  outcome text not null check (outcome in ('sent', 'retry', 'expired', 'disabled')),
  unique (job_id, subscription_id)
);

alter table public.push_notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_notification_jobs enable row level security;
alter table public.push_notification_deliveries enable row level security;

revoke all on public.push_notification_preferences, public.push_subscriptions,
  public.push_notification_jobs, public.push_notification_deliveries from public, anon;
revoke all on public.push_subscriptions, public.push_notification_jobs,
  public.push_notification_deliveries from authenticated;
grant select, insert, update, delete on public.push_notification_preferences to authenticated;
grant all on public.push_subscriptions, public.push_notification_jobs,
  public.push_notification_deliveries to service_role;

create policy "Users manage their push preferences"
  on public.push_notification_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.claim_push_notification_jobs(p_limit integer default 40)
returns setof public.push_notification_jobs
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select j.id
    from public.push_notification_jobs j
    where j.scheduled_for <= pg_catalog.now()
      and (j.status = 'pending'::public.push_job_status or
           (j.status = 'processing'::public.push_job_status and j.locked_at < pg_catalog.now() - interval '5 minutes'))
    order by j.scheduled_for, j.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
  )
  update public.push_notification_jobs j
  set status = 'processing'::public.push_job_status,
      locked_at = pg_catalog.now(),
      attempts = j.attempts + 1
  from candidates c where j.id = c.id
  returning j.*;
$$;
revoke all on function public.claim_push_notification_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_push_notification_jobs(integer) to service_role;

create or replace function public.enqueue_due_push_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
begin
  -- Appuntamenti, sopralluoghi e ritiri in agenda. Le date vengono calcolate
  -- nel fuso Europe/Rome nel database, incluse le regole DST.
  with candidates as (
    select e.user_id, e.id, e.starts_at, p.appointment_days_before, p.appointment_hour,
      (((e.starts_at at time zone 'Europe/Rome')::date - coalesce(p.appointment_days_before, 1))::timestamp
        + pg_catalog.make_interval(hours => coalesce(p.appointment_hour, 18))) at time zone 'Europe/Rome' as remind_at
    from public.agenda_events e
    left join public.push_notification_preferences p on p.user_id = e.user_id
    where e.event_type in ('appuntamento'::public.agenda_event_type, 'sopralluogo'::public.agenda_event_type, 'ritiro'::public.agenda_event_type)
      and not e.is_completed and e.starts_at > pg_catalog.now()
      and coalesce(p.appointments_enabled, true)
  ), inserted as (
    insert into public.push_notification_jobs(category, source_kind, source_id, source_marker, recipient_user_id, dedupe_key, title, body, target_path, scheduled_for)
    select 'appointment'::public.push_notification_category, 'agenda_event'::public.push_reminder_source, c.id, c.starts_at::text, c.user_id,
      'appointment:' || c.id::text || ':' || c.remind_at::text,
      'Promemoria agenda', 'Hai un’attività in programma.',
      '/agenda?evento=' || c.id::text, c.remind_at
    from candidates c
    where c.remind_at between pg_catalog.now() - interval '10 minutes' and pg_catalog.now() + interval '1 minute'
    on conflict (dedupe_key) do nothing returning 1
  ) select count(*) into inserted_count from inserted;

  -- Ritiro antitarlo non presente in Agenda. Se esiste un evento collegato,
  -- è l'evento dell'Agenda a governare il promemoria e non si duplica.
  with candidates as (
    select t.user_id, t.id, t.pickup_date, p.appointment_days_before, p.appointment_hour,
      ((t.pickup_date - coalesce(p.appointment_days_before, 1))::timestamp
        + pg_catalog.make_interval(hours => coalesce(p.appointment_hour, 18))) at time zone 'Europe/Rome' as remind_at
    from public.antitarlo_treatments t
    left join public.push_notification_preferences p on p.user_id = t.user_id
    where t.pickup_date is not null and t.status = 'da_programmare'::public.antitarlo_status
      and coalesce(p.appointments_enabled, true)
      and not exists (select 1 from public.agenda_events e where e.antitarlo_treatment_id = t.id and e.event_type = 'ritiro'::public.agenda_event_type)
  ), inserted as (
    insert into public.push_notification_jobs(category, source_kind, source_id, source_marker, recipient_user_id, dedupe_key, title, body, target_path, scheduled_for)
    select 'appointment'::public.push_notification_category, 'antitarlo_treatment'::public.push_reminder_source, c.id, c.pickup_date::text, c.user_id,
      'treatment-pickup:' || c.id::text || ':' || c.pickup_date::text,
      'Promemoria ritiro', 'È previsto un ritiro antitarlo.', '/antitarlo?trattamento=' || c.id::text, c.remind_at
    from candidates c
    where c.remind_at between pg_catalog.now() - interval '10 minutes' and pg_catalog.now() + interval '1 minute'
    on conflict (dedupe_key) do nothing returning 1
  ) select inserted_count + count(*) into inserted_count from inserted;

  -- Consegna prevista della commessa; stati non confermati, conclusi o annullati esclusi.
  with candidates as (
    select j.user_id, j.id, j.due_date, p.delivery_days_before, p.delivery_hour,
      ((j.due_date - coalesce(p.delivery_days_before, 2))::timestamp
        + pg_catalog.make_interval(hours => coalesce(p.delivery_hour, 9))) at time zone 'Europe/Rome' as remind_at
    from public.jobs j
    left join public.push_notification_preferences p on p.user_id = j.user_id
    where j.due_date is not null
      and j.status in ('confermato'::public.job_status, 'da_iniziare'::public.job_status,
        'in_lavorazione'::public.job_status, 'in_attesa'::public.job_status, 'pronto_consegna'::public.job_status)
      and coalesce(p.job_deliveries_enabled, true)
  ), inserted as (
    insert into public.push_notification_jobs(category, source_kind, source_id, source_marker, recipient_user_id, dedupe_key, title, body, target_path, scheduled_for)
    select 'job_delivery'::public.push_notification_category, 'job_due_date'::public.push_reminder_source, c.id, c.due_date::text, c.user_id,
      'job-delivery:' || c.id::text || ':' || c.due_date::text,
      'Consegna in avvicinamento', 'Una commessa ha una consegna prevista.', '/lavori/' || c.id::text, c.remind_at
    from candidates c
    where c.remind_at between pg_catalog.now() - interval '10 minutes' and pg_catalog.now() + interval '1 minute'
    on conflict (dedupe_key) do nothing returning 1
  ) select inserted_count + count(*) into inserted_count from inserted;

  -- Appuntamenti di consegna espliciti solo se non coincidono con due_date.
  with candidates as (
    select e.user_id, e.id, e.job_id, e.starts_at,
      coalesce(p.delivery_days_before, 2) as days_before, coalesce(p.delivery_hour, 9) as reminder_hour,
      (((e.starts_at at time zone 'Europe/Rome')::date - coalesce(p.delivery_days_before, 2))::timestamp
        + pg_catalog.make_interval(hours => coalesce(p.delivery_hour, 9))) at time zone 'Europe/Rome' as remind_at
    from public.agenda_events e
    left join public.push_notification_preferences p on p.user_id = e.user_id
    where e.event_type = 'consegna'::public.agenda_event_type and not e.is_completed
      and e.starts_at > pg_catalog.now() and e.job_id is not null
      and coalesce(p.job_deliveries_enabled, true)
      and not exists (select 1 from public.jobs j where j.id = e.job_id and j.due_date = (e.starts_at at time zone 'Europe/Rome')::date)
  ), inserted as (
    insert into public.push_notification_jobs(category, source_kind, source_id, source_marker, recipient_user_id, dedupe_key, title, body, target_path, scheduled_for)
    select 'job_delivery'::public.push_notification_category, 'agenda_delivery'::public.push_reminder_source, c.id, c.starts_at::text, c.user_id,
      'agenda-delivery:' || c.id::text || ':' || c.starts_at::text,
      'Consegna in avvicinamento', 'Hai una consegna in programma.', '/lavori/' || c.job_id::text, c.remind_at
    from candidates c
    where c.remind_at between pg_catalog.now() - interval '10 minutes' and pg_catalog.now() + interval '1 minute'
    on conflict (dedupe_key) do nothing returning 1
  ) select inserted_count + count(*) into inserted_count from inserted;

  -- Solo cicli creati dopo la migrazione hanno sent_at valorizzato. Il richiamo
  -- cade dopo il numero configurato di giorni, all'ora locale scelta.
  with candidates as (
    select q.user_id, q.id, q.send_cycle_id,
      (((q.sent_at at time zone 'Europe/Rome')::date + coalesce(p.quote_days_after, 7))::timestamp
        + pg_catalog.make_interval(hours => coalesce(p.quote_hour, 10))) at time zone 'Europe/Rome' as remind_at
    from public.quotes q
    left join public.push_notification_preferences p on p.user_id = q.user_id
    where q.status = 'inviato'::public.quote_status and q.sent_at is not null and q.send_cycle_id is not null
      and coalesce(p.quotes_enabled, true)
  ), inserted as (
    insert into public.push_notification_jobs(category, source_kind, source_id, source_marker, recipient_user_id, dedupe_key, title, body, target_path, scheduled_for)
    select 'quote_follow_up'::public.push_notification_category, 'quote_send_cycle'::public.push_reminder_source, c.id, c.send_cycle_id::text, c.user_id,
      'quote-follow-up:' || c.send_cycle_id::text,
      'Preventivo in attesa', 'Un preventivo inviato è ancora in attesa.',
      '/lavori/' || q.job_id::text || '/preventivi/' || q.id::text, c.remind_at
    from candidates c join public.quotes q on q.id = c.id
    where c.remind_at between pg_catalog.now() - interval '10 minutes' and pg_catalog.now() + interval '1 minute'
    on conflict (dedupe_key) do nothing returning 1
  ) select inserted_count + count(*) into inserted_count from inserted;

  return inserted_count;
end;
$$;
revoke all on function public.enqueue_due_push_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_due_push_reminders() to service_role;

create or replace function public.is_push_notification_job_valid(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.push_notification_jobs%rowtype;
  expected_at timestamptz;
  due_day date;
  start_time timestamptz;
begin
  select * into j from public.push_notification_jobs where id = p_job_id;
  if not found then return false; end if;
  case j.source_kind
    when 'site_inquiry'::public.push_reminder_source then
      return j.category = 'site_inquiry'::public.push_notification_category and
        exists (select 1 from public.customer_inquiries i where i.id = j.source_id);
    when 'agenda_event'::public.push_reminder_source then
      select e.starts_at into start_time from public.agenda_events e
      where e.id = j.source_id and e.user_id = j.recipient_user_id and not e.is_completed
        and e.event_type in ('appuntamento'::public.agenda_event_type, 'sopralluogo'::public.agenda_event_type, 'ritiro'::public.agenda_event_type);
      if not found then return false; end if;
      select (((start_time at time zone 'Europe/Rome')::date - coalesce(p.appointment_days_before, 1))::timestamp
        + pg_catalog.make_interval(hours => coalesce(p.appointment_hour, 18))) at time zone 'Europe/Rome'
        into expected_at from public.push_notification_preferences p where p.user_id = j.recipient_user_id;
      if expected_at is null then expected_at := (((start_time at time zone 'Europe/Rome')::date - 1)::timestamp + interval '18 hours') at time zone 'Europe/Rome'; end if;
      return expected_at = j.scheduled_for and j.source_marker::timestamptz = start_time;
    when 'antitarlo_treatment'::public.push_reminder_source then
      select t.pickup_date into due_day from public.antitarlo_treatments t
      where t.id = j.source_id and t.user_id = j.recipient_user_id and t.status = 'da_programmare'::public.antitarlo_status;
      if not found or due_day is null or exists (select 1 from public.agenda_events e where e.antitarlo_treatment_id = j.source_id and e.event_type = 'ritiro'::public.agenda_event_type) then return false; end if;
      select ((due_day - coalesce(p.appointment_days_before, 1))::timestamp
        + pg_catalog.make_interval(hours => coalesce(p.appointment_hour, 18))) at time zone 'Europe/Rome'
        into expected_at from public.push_notification_preferences p where p.user_id = j.recipient_user_id;
      if expected_at is null then expected_at := ((due_day - 1)::timestamp + interval '18 hours') at time zone 'Europe/Rome'; end if;
      return expected_at = j.scheduled_for and j.source_marker::date = due_day;
    when 'job_due_date'::public.push_reminder_source then
      select due_date into due_day from public.jobs where id = j.source_id and user_id = j.recipient_user_id
        and status in ('confermato'::public.job_status, 'da_iniziare'::public.job_status, 'in_lavorazione'::public.job_status, 'in_attesa'::public.job_status, 'pronto_consegna'::public.job_status);
      if not found or due_day is null then return false; end if;
      select ((due_day - coalesce(p.delivery_days_before, 2))::timestamp
        + pg_catalog.make_interval(hours => coalesce(p.delivery_hour, 9))) at time zone 'Europe/Rome'
        into expected_at from public.push_notification_preferences p where p.user_id = j.recipient_user_id;
      if expected_at is null then expected_at := ((due_day - 2)::timestamp + interval '9 hours') at time zone 'Europe/Rome'; end if;
      return expected_at = j.scheduled_for and j.source_marker::date = due_day;
    when 'agenda_delivery'::public.push_reminder_source then
      select e.starts_at into start_time from public.agenda_events e
      where e.id = j.source_id and e.user_id = j.recipient_user_id and e.event_type = 'consegna'::public.agenda_event_type and not e.is_completed and e.job_id is not null;
      if not found or exists (select 1 from public.jobs x where x.id = (select e.job_id from public.agenda_events e where e.id = j.source_id) and x.due_date = (start_time at time zone 'Europe/Rome')::date) then return false; end if;
      select (((start_time at time zone 'Europe/Rome')::date - coalesce(p.delivery_days_before, 2))::timestamp
        + pg_catalog.make_interval(hours => coalesce(p.delivery_hour, 9))) at time zone 'Europe/Rome'
        into expected_at from public.push_notification_preferences p where p.user_id = j.recipient_user_id;
      if expected_at is null then expected_at := (((start_time at time zone 'Europe/Rome')::date - 2)::timestamp + interval '9 hours') at time zone 'Europe/Rome'; end if;
      return expected_at = j.scheduled_for and j.source_marker::timestamptz = start_time;
    when 'quote_send_cycle'::public.push_reminder_source then
      select ((((q.sent_at at time zone 'Europe/Rome')::date + coalesce(p.quote_days_after, 7))::timestamp
        + pg_catalog.make_interval(hours => coalesce(p.quote_hour, 10))) at time zone 'Europe/Rome')
        into expected_at
      from public.quotes q left join public.push_notification_preferences p on p.user_id = q.user_id
      where q.id = j.source_id and q.user_id = j.recipient_user_id and q.status = 'inviato'::public.quote_status
        and q.send_cycle_id::text = j.source_marker and q.sent_at is not null;
      return expected_at is not null and expected_at = j.scheduled_for;
  end case;
  return false;
end;
$$;
revoke all on function public.is_push_notification_job_valid(uuid) from public, anon, authenticated;
grant execute on function public.is_push_notification_job_valid(uuid) to service_role;

-- Il client può solo registrare/rimuovere la propria subscription attraverso
-- l'Edge Function autenticata; il backend usa service_role e applica ownership.

-- Timestamp affidabile del ciclo di invio: gli inviati preesistenti restano NULL
-- così il primo scheduler non genera promemoria retroattivi.
alter table public.quotes
  add column sent_at timestamptz,
  add column send_cycle_id uuid;
create index quotes_sent_follow_up_idx on public.quotes(sent_at)
  where status = 'inviato' and sent_at is not null;

create or replace function public.track_quote_send_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'inviato'::public.quote_status and tg_op = 'INSERT' then
    new.sent_at := pg_catalog.clock_timestamp();
    new.send_cycle_id := pg_catalog.gen_random_uuid();
  elsif new.status = 'inviato'::public.quote_status and
        old.status is distinct from 'inviato'::public.quote_status then
    new.sent_at := pg_catalog.clock_timestamp();
    new.send_cycle_id := pg_catalog.gen_random_uuid();
  elsif tg_op = 'UPDATE' and old.status = 'inviato'::public.quote_status and
        new.status = 'inviato'::public.quote_status then
    new.sent_at := old.sent_at;
    new.send_cycle_id := old.send_cycle_id;
  elsif new.status <> 'inviato'::public.quote_status then
    new.sent_at := null;
    new.send_cycle_id := null;
  end if;
  return new;
end;
$$;
create trigger quotes_track_send_cycle
before insert or update of status on public.quotes
for each row execute function public.track_quote_send_cycle();

create trigger push_preferences_updated_at before update on public.push_notification_preferences
for each row execute function public.set_updated_at();

comment on table public.push_subscriptions is
  'Dati endpoint Web Push accessibili esclusivamente alle Edge Functions service_role.';
comment on table public.push_notification_jobs is
  'Outbox idempotente; title/body/target_path non devono contenere dati personali.';
comment on column public.quotes.sent_at is
  'Timestamp server del passaggio al ciclo corrente di stato inviato; NULL per preventivi già inviati prima della migrazione.';

commit;
