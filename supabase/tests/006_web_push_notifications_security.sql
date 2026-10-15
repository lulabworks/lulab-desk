-- Eseguire SOLO in PostgreSQL/Supabase isolato dopo le migrazioni 001–006.
-- La transazione viene annullata: nessun dato dei test rimane.
begin;

do $$
declare
  test_user uuid;
begin
  if not exists (select 1 from pg_catalog.pg_class where oid = 'public.push_subscriptions'::regclass and relrowsecurity) then
    raise exception 'RLS mancante su push_subscriptions';
  end if;
  if not exists (select 1 from pg_catalog.pg_class where oid = 'public.push_notification_jobs'::regclass and relrowsecurity) then
    raise exception 'RLS mancante su push_notification_jobs';
  end if;
  if not exists (select 1 from pg_catalog.pg_class where oid = 'public.push_notification_deliveries'::regclass and relrowsecurity) then
    raise exception 'RLS mancante su push_notification_deliveries';
  end if;
  if has_table_privilege('anon', 'public.push_subscriptions', 'select') or
     has_table_privilege('anon', 'public.push_notification_jobs', 'select') or
     has_table_privilege('authenticated', 'public.push_subscriptions', 'select') then
    raise exception 'Endpoint o coda push leggibili dal client';
  end if;
  if not (has_table_privilege('authenticated', 'public.push_notification_preferences', 'select') and
          has_table_privilege('authenticated', 'public.push_notification_preferences', 'insert') and
          has_table_privilege('authenticated', 'public.push_notification_preferences', 'update') and
          has_table_privilege('authenticated', 'public.push_notification_preferences', 'delete')) then
    raise exception 'Permessi preferenze incompleti per authenticated';
  end if;
  if (select count(*) from public.quotes where status = 'inviato' and (sent_at is not null or send_cycle_id is not null)) > 0 then
    raise exception 'Il test va eseguito su schema pulito: preventivi legacy non devono essere retro-notificati';
  end if;
  if (select count(*) from auth.users) < 2 then raise exception 'Servono due utenti auth di test per l’isolamento'; end if;
  select id into test_user from auth.users order by created_at limit 1;
end;
$$;

select set_config('request.jwt.claim.sub', (select id::text from auth.users order by created_at limit 1), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id::text from auth.users order by created_at limit 1), 'role', 'authenticated')::text, true);
select set_config('test.actor_one', (select id::text from auth.users order by created_at limit 1), true);
select set_config('test.actor_two', (select id::text from auth.users order by created_at offset 1 limit 1), true);
set local role authenticated;

insert into public.push_notification_preferences(user_id) values (auth.uid());
do $$
begin
  if not exists (select 1 from public.push_notification_preferences where user_id = auth.uid() and appointment_hour = 18 and delivery_hour = 9 and quote_hour = 10) then
    raise exception 'Preferenze e orari predefiniti incoerenti';
  end if;
  perform set_config('request.jwt.claim.sub', current_setting('test.actor_two'), true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.actor_two'), 'role', 'authenticated')::text, true);
  if exists (select 1 from public.push_notification_preferences where user_id <> auth.uid()) then
    raise exception 'RLS espone le preferenze di un altro utente';
  end if;
  begin
    insert into public.push_notification_preferences(user_id) values (current_setting('test.actor_one')::uuid);
    raise exception 'RLS ha accettato preferenze di un altro utente';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.push_notification_preferences(user_id, appointment_days_before) values (auth.uid(), 0)
      on conflict (user_id) do update set appointment_days_before = excluded.appointment_days_before;
    raise exception 'Vincolo ha accettato un intervallo non valido';
  exception when check_violation then null;
  end;
end;
$$;
reset role;

-- L'accesso anonimo non deve nemmeno poter interrogare endpoint/coda.
set local role anon;
do $$
begin
  begin
    perform 1 from public.push_subscriptions;
    raise exception 'Ruolo anon ha letto le sottoscrizioni';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_push_notification_jobs(1);
    raise exception 'Ruolo anon ha potuto reclamare la coda';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Il trigger registra INSERT e nuove transizioni di invio, conserva il ciclo
-- durante modifiche successive e azzera i dati quando lo stato cambia.
do $$
declare
  source_job public.jobs%rowtype;
  quote_id uuid;
  first_cycle uuid;
  second_cycle uuid;
  first_sent_at timestamptz;
  delivery_job_id uuid;
  delivery_due_date date;
  delivery_reminder timestamptz;
begin
  if public.enqueue_due_push_reminders() <> 0 then raise exception 'Nessun reminder era pronto nel fixture iniziale'; end if;

  select j.* into source_job from public.jobs j
  where not exists (select 1 from public.quotes q where q.job_id = j.id and q.status = 'accettato')
  order by j.created_at limit 1;
  if source_job.id is null then raise exception 'Il test quote richiede una commessa senza preventivo accettato'; end if;

  insert into public.quotes(user_id, job_id, title, status)
  values (source_job.user_id, source_job.id, 'Push test transazionale', 'inviato')
  returning id, send_cycle_id, sent_at into quote_id, first_cycle, first_sent_at;
  if first_cycle is null or first_sent_at is null then raise exception 'INSERT diretto inviato non ha inizializzato il ciclo'; end if;
  update public.quotes set notes = 'aggiornamento non di stato' where id = quote_id;
  if (select send_cycle_id from public.quotes where id = quote_id) <> first_cycle or
     (select sent_at from public.quotes where id = quote_id) <> first_sent_at then
    raise exception 'Un aggiornamento ordinario ha alterato il ciclo di invio';
  end if;
  update public.quotes set status = 'rifiutato' where id = quote_id;
  if exists (select 1 from public.quotes where id = quote_id and (sent_at is not null or send_cycle_id is not null)) then
    raise exception 'Un preventivo non più inviato conserva la pianificazione';
  end if;
  update public.quotes set status = 'inviato' where id = quote_id;
  select send_cycle_id into second_cycle from public.quotes where id = quote_id;
  if second_cycle is null or second_cycle = first_cycle then raise exception 'Nuovo ciclo di invio non distinto'; end if;

  insert into public.jobs(user_id, title, type, status, due_date)
  values (source_job.user_id, 'Scadenza push test', 'restauro', 'confermato', current_date + 20)
  returning id, due_date into delivery_job_id, delivery_due_date;
  delivery_reminder := ((delivery_due_date - 2)::timestamp + interval '9 hours') at time zone 'Europe/Rome';
  insert into public.push_notification_jobs(category, source_kind, source_id, source_marker, recipient_user_id,
    dedupe_key, title, body, target_path, scheduled_for)
  values ('job_delivery', 'job_due_date', delivery_job_id, delivery_due_date::text, source_job.user_id,
    'test-date-change:' || delivery_job_id::text, 'Test', 'Test', '/lavori/' || delivery_job_id::text, delivery_reminder);
  if not public.is_push_notification_job_valid((select id from public.push_notification_jobs where dedupe_key = 'test-date-change:' || delivery_job_id::text)) then
    raise exception 'Il reminder con scadenza sorgente invariata è stato invalidato';
  end if;
  update public.jobs set due_date = due_date + 1 where id = delivery_job_id;
  if public.is_push_notification_job_valid((select id from public.push_notification_jobs where dedupe_key = 'test-date-change:' || delivery_job_id::text)) then
    raise exception 'Il reminder con scadenza modificata è rimasto valido';
  end if;
end;
$$;

rollback;
