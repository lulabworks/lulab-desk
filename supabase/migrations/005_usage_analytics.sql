-- LuLab Adaptive — statistiche aggregate e minimali di utilizzo.
-- Additiva; non modifica dati operativi. Da applicare solo dopo approvazione.

-- pgcrypto è incluso nei deployment PostgreSQL/Supabase supportati. Il lookup
-- dello schema dell'estensione nella RPC gestisce anche installazioni pregresse
-- che l'abbiano collocata in uno schema diverso da extensions.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.usage_feature_catalog (
  feature_key text primary key check (feature_key ~ '^[a-z][a-z0-9_.]{1,63}$'),
  feature_type text not null check (feature_type in ('section_visit', 'operation')),
  label text not null,
  section_key text not null check (section_key ~ '^[a-z][a-z0-9_]{1,31}$')
);

insert into public.usage_feature_catalog (feature_key, feature_type, label, section_key) values
  ('section.home', 'section_visit', 'Home', 'home'),
  ('section.jobs', 'section_visit', 'Lavori', 'jobs'),
  ('section.agenda', 'section_visit', 'Agenda', 'agenda'),
  ('section.customers', 'section_visit', 'Clienti', 'customers'),
  ('section.materials', 'section_visit', 'Materiali', 'materials'),
  ('section.recoveries', 'section_visit', 'Recuperi', 'recoveries'),
  ('section.antitarlo', 'section_visit', 'Antitarlo', 'antitarlo'),
  ('section.statistics', 'section_visit', 'Statistiche', 'statistics'),
  ('section.site', 'section_visit', 'Sito', 'site'),
  ('section.settings', 'section_visit', 'Impostazioni', 'settings'),
  ('customer.created', 'operation', 'Cliente creato', 'customers'),
  ('customer.updated', 'operation', 'Cliente modificato', 'customers'),
  ('customer.deleted', 'operation', 'Cliente eliminato', 'customers'),
  ('job.created', 'operation', 'Commessa creata', 'jobs'),
  ('job.updated', 'operation', 'Commessa aggiornata', 'jobs'),
  ('job.completed', 'operation', 'Commessa conclusa', 'jobs'),
  ('job.task_created', 'operation', 'Attività checklist creata', 'jobs'),
  ('job.task_updated', 'operation', 'Attività checklist aggiornata', 'jobs'),
  ('job.task_deleted', 'operation', 'Attività checklist eliminata', 'jobs'),
  ('agenda.created', 'operation', 'Evento creato', 'agenda'),
  ('agenda.updated', 'operation', 'Evento modificato', 'agenda'),
  ('agenda.completed', 'operation', 'Evento completato', 'agenda'),
  ('agenda.deleted', 'operation', 'Evento eliminato', 'agenda'),
  ('quote.created', 'operation', 'Preventivo creato', 'jobs'),
  ('quote.updated', 'operation', 'Preventivo salvato', 'jobs'),
  ('quote.item_created', 'operation', 'Voce preventivo aggiunta', 'jobs'),
  ('quote.item_deleted', 'operation', 'Voce preventivo rimossa', 'jobs'),
  ('quote.deleted', 'operation', 'Preventivo eliminato', 'jobs'),
  ('time.timer_started', 'operation', 'Cronometro avviato', 'jobs'),
  ('time.timer_stopped', 'operation', 'Cronometro fermato', 'jobs'),
  ('time.manual_created', 'operation', 'Ore inserite manualmente', 'jobs'),
  ('time.deleted', 'operation', 'Registrazione ore eliminata', 'jobs'),
  ('finance.expense_created', 'operation', 'Spesa registrata', 'jobs'),
  ('finance.payment_created', 'operation', 'Pagamento registrato', 'jobs'),
  ('finance.entry_deleted', 'operation', 'Registrazione economica eliminata', 'jobs'),
  ('files.uploaded', 'operation', 'Allegato caricato', 'jobs'),
  ('files.deleted', 'operation', 'Allegato eliminato', 'jobs'),
  ('materials.saved', 'operation', 'Materiale salvato', 'materials'),
  ('materials.movement_created', 'operation', 'Movimento di magazzino registrato', 'materials'),
  ('materials.movement_reversed', 'operation', 'Movimento di magazzino stornato', 'materials'),
  ('materials.category_created', 'operation', 'Categoria materiale creata', 'materials'),
  ('materials.supplier_created', 'operation', 'Fornitore creato', 'materials'),
  ('recovery.created', 'operation', 'Recupero creato', 'recoveries'),
  ('recovery.updated', 'operation', 'Recupero aggiornato', 'recoveries'),
  ('recovery.photo_uploaded', 'operation', 'Foto recupero caricata', 'recoveries'),
  ('recovery.photo_deleted', 'operation', 'Foto recupero eliminata', 'recoveries'),
  ('recovery.material_used', 'operation', 'Materiale assegnato a recupero', 'recoveries'),
  ('recovery.time_created', 'operation', 'Ore recupero registrate', 'recoveries'),
  ('recovery.expense_created', 'operation', 'Spesa recupero registrata', 'recoveries'),
  ('recovery.entry_deleted', 'operation', 'Voce recupero eliminata', 'recoveries'),
  ('recovery.archived', 'operation', 'Recupero archiviato o ripristinato', 'recoveries'),
  ('antitarlo.saved', 'operation', 'Trattamento antitarlo salvato', 'antitarlo'),
  ('antitarlo.expense_created', 'operation', 'Costo trattamento registrato', 'antitarlo'),
  ('antitarlo.payment_created', 'operation', 'Pagamento trattamento registrato', 'antitarlo'),
  ('antitarlo.collaborator_created', 'operation', 'Collaboratore creato', 'antitarlo'),
  ('antitarlo.agenda_created', 'operation', 'Evento trattamento aggiunto in agenda', 'antitarlo'),
  ('site.content_created', 'operation', 'Contenuto sito creato', 'site'),
  ('site.content_saved', 'operation', 'Contenuto sito salvato', 'site'),
  ('site.image_uploaded', 'operation', 'Immagine sito caricata', 'site'),
  ('site.image_updated', 'operation', 'Immagine sito aggiornata', 'site'),
  ('site.image_reordered', 'operation', 'Immagini sito riordinate', 'site'),
  ('site.image_deleted', 'operation', 'Immagine sito eliminata', 'site'),
  ('site.published', 'operation', 'Contenuto pubblicato', 'site'),
  ('site.withdrawn', 'operation', 'Contenuto ritirato', 'site'),
  ('site.inquiry_updated', 'operation', 'Richiesta sito aggiornata', 'site'),
  ('settings.rate_saved', 'operation', 'Tariffa oraria salvata', 'settings'),
  ('settings.data_exported', 'operation', 'Esportazione JSON completata', 'settings')
on conflict (feature_key) do update
set feature_type = excluded.feature_type, label = excluded.label, section_key = excluded.section_key;

create table public.usage_daily_aggregates (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  feature_key text not null references public.usage_feature_catalog(feature_key) on delete restrict,
  visits integer not null default 0 check (visits >= 0),
  operations integer not null default 0 check (operations >= 0),
  last_used_at timestamptz not null default now(),
  primary key (user_id, usage_date, feature_key),
  check (visits > 0 or operations > 0)
);

create index usage_daily_aggregates_period_idx
  on public.usage_daily_aggregates (user_id, usage_date desc, feature_key);

alter table public.usage_feature_catalog enable row level security;
alter table public.usage_daily_aggregates enable row level security;
alter table public.usage_daily_aggregates force row level security;

create policy "Users read their own usage aggregates"
  on public.usage_daily_aggregates for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all privileges on table public.usage_feature_catalog from public, anon, authenticated;
revoke all privileges on table public.usage_daily_aggregates from public, anon, authenticated;
grant select on table public.usage_daily_aggregates to authenticated;

create table public.usage_analytics_config (
  singleton boolean primary key default true check (singleton),
  collection_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.usage_analytics_config (singleton, collection_enabled)
values (true, false)
on conflict (singleton) do nothing;
alter table public.usage_analytics_config enable row level security;
alter table public.usage_analytics_config force row level security;
revoke all privileges on table public.usage_analytics_config from public, anon, authenticated;

create table public.usage_batch_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, batch_id)
);
create index usage_batch_receipts_created_at_idx on public.usage_batch_receipts (created_at);
alter table public.usage_batch_receipts enable row level security;
alter table public.usage_batch_receipts force row level security;
revoke all privileges on table public.usage_batch_receipts from public, anon, authenticated;

create or replace function public.record_usage_batch(p_batch_id uuid, p_events jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_entry record;
  event_type text;
  actor_id uuid := auth.uid();
  now_at timestamptz := pg_catalog.clock_timestamp();
  batch_size integer;
  entry_size integer;
  activity_at timestamptz;
  activity_date date;
  event_count integer;
  crypto_schema name;
  claim_id uuid;
  payload_sha256 text;
  existing_sha256 text;
begin
  if actor_id is null then
    raise exception 'Autenticazione richiesta.' using errcode = '28000';
  end if;
  if p_batch_id is null then
    raise exception 'Identificatore batch non valido.' using errcode = '22023';
  end if;
  if p_events is null or pg_catalog.jsonb_typeof(p_events) <> 'array' then
    raise exception 'Formato statistiche non valido.' using errcode = '22023';
  end if;
  batch_size := pg_catalog.jsonb_array_length(p_events);
  if batch_size < 1 or batch_size > 100 then
    raise exception 'Dimensione del lotto non valida.' using errcode = '22023';
  end if;

  -- Validare l'intero payload prima di qualsiasi scrittura: le date sono UTC,
  -- accettiamo invii offline fino a 90 giorni e al massimo 5 minuti futuri.
  for event_entry in select value as entry from pg_catalog.jsonb_array_elements(p_events)
  loop
    if pg_catalog.jsonb_typeof(event_entry.entry) <> 'object' then
      raise exception 'Evento statistico non valido.' using errcode = '22023';
    end if;
    select count(*) into entry_size from pg_catalog.jsonb_object_keys(event_entry.entry);
    if entry_size <> 3
      or not (event_entry.entry ? 'feature_key')
      or not (event_entry.entry ? 'occurred_at')
      or not (event_entry.entry ? 'count') then
      raise exception 'Campi evento non validi.' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(event_entry.entry -> 'feature_key') <> 'string'
      or pg_catalog.jsonb_typeof(event_entry.entry -> 'occurred_at') <> 'string'
      or pg_catalog.jsonb_typeof(event_entry.entry -> 'count') <> 'number'
      or (event_entry.entry ->> 'count') !~ '^[1-9][0-9]{0,2}$'
      or (event_entry.entry ->> 'occurred_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$' then
      raise exception 'Valori evento non validi.' using errcode = '22023';
    end if;
    begin
      activity_at := (event_entry.entry ->> 'occurred_at')::timestamptz;
      event_count := (event_entry.entry ->> 'count')::integer;
    exception when others then
      raise exception 'Istante attività non valido.' using errcode = '22023';
    end;
    if activity_at < now_at - interval '90 days' or activity_at > now_at + interval '5 minutes' then
      raise exception 'Istante attività fuori dalla finestra consentita.' using errcode = '22023';
    end if;
    activity_date := (activity_at at time zone 'UTC')::date;
    select feature.feature_type into event_type
    from public.usage_feature_catalog feature
    where feature.feature_key = event_entry.entry ->> 'feature_key';
    if event_type is null then
      raise exception 'Funzionalità non riconosciuta.' using errcode = '22023';
    end if;
  end loop;

  if not exists (
    select 1 from public.usage_analytics_config config
    where config.singleton and config.collection_enabled
  ) then
    return false;
  end if;

  select namespace.nspname into crypto_schema
  from pg_catalog.pg_extension extension_row
  join pg_catalog.pg_namespace namespace on namespace.oid = extension_row.extnamespace
  where extension_row.extname = 'pgcrypto';
  if crypto_schema is null then
    raise exception 'Estensione pgcrypto non disponibile.' using errcode = '55000';
  end if;
  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest(pg_catalog.convert_to($1, ''UTF8''), ''sha256''), ''hex'')',
    crypto_schema
  ) into payload_sha256 using p_events::text;

  insert into public.usage_batch_receipts (user_id, batch_id, payload_sha256)
  values (actor_id, p_batch_id, payload_sha256)
  on conflict (user_id, batch_id) do nothing
  returning batch_id into claim_id;
  if claim_id is null then
    select receipt.payload_sha256 into existing_sha256
    from public.usage_batch_receipts receipt
    where receipt.user_id = actor_id and receipt.batch_id = p_batch_id;
    if existing_sha256 is distinct from payload_sha256 then
      raise exception 'UUID batch già utilizzato con un payload diverso.' using errcode = '22023';
    end if;
    return false;
  end if;

  -- Deduplica transazionale: la ricevuta e gli incrementi fanno parte della
  -- stessa transazione; un conflitto concorrente attende e poi diventa retry.
  for event_entry in select value as entry from pg_catalog.jsonb_array_elements(p_events)
  loop
    select feature.feature_type into event_type
    from public.usage_feature_catalog feature
    where feature.feature_key = event_entry.entry ->> 'feature_key';
    activity_at := (event_entry.entry ->> 'occurred_at')::timestamptz;
    activity_date := (activity_at at time zone 'UTC')::date;
    event_count := (event_entry.entry ->> 'count')::integer;

    insert into public.usage_daily_aggregates as current_row (
      user_id, usage_date, feature_key, visits, operations, last_used_at
    ) values (
      actor_id,
      activity_date,
      event_entry.entry ->> 'feature_key',
      case when event_type = 'section_visit' then event_count else 0 end,
      case when event_type = 'operation' then event_count else 0 end,
      activity_at
    )
    on conflict (user_id, usage_date, feature_key) do update set
      visits = current_row.visits + excluded.visits,
      operations = current_row.operations + excluded.operations,
      last_used_at = greatest(current_row.last_used_at, excluded.last_used_at);
  end loop;

  delete from public.usage_batch_receipts receipt
  where receipt.created_at < now_at - interval '100 days';
  return true;
end;
$$;

revoke all on function public.record_usage_batch(uuid, jsonb) from public, anon;
grant execute on function public.record_usage_batch(uuid, jsonb) to authenticated;

comment on table public.usage_daily_aggregates is
  'Contatori giornalieri per utente e funzione; non contiene eventi individuali o contenuti operativi.';
comment on function public.record_usage_batch(uuid, jsonb) is
  'Batch UUID idempotenti; aggrega in UTC l’istante reale client validato entro 90 giorni/5 minuti, solo per auth.uid().';
comment on column public.usage_batch_receipts.payload_sha256 is
  'SHA-256 esadecimale del JSONB canonico UTF-8; non conserva il payload del batch.';
