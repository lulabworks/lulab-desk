-- Solo database PostgreSQL/Supabase isolato dopo 001–005; tutte le modifiche
-- sono transazionali e annullate al termine. Richiede due auth.users di test.
begin;

do $$
begin
  if (select count(*) from (select id from auth.users order by created_at limit 2) users) < 2 then
    raise exception 'Il test richiede due utenti di prova in auth.users.';
  end if;
  if (select collection_enabled from public.usage_analytics_config where singleton) is distinct from false then
    raise exception 'La raccolta deve partire disabilitata.';
  end if;
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pgcrypto') then
    raise exception 'Test SHA-256 richiede pgcrypto.';
  end if;
end;
$$;

select set_config('test.actor_one', (select id::text from auth.users order by created_at limit 1), true);
select set_config('test.actor_two', (select id::text from auth.users order by created_at offset 1 limit 1), true);
update public.usage_analytics_config set collection_enabled = true where singleton;
set local role authenticated;

do $$
declare
  actor_one uuid := current_setting('test.actor_one')::uuid;
  actor_two uuid := current_setting('test.actor_two')::uuid;
  batch_one constant uuid := '11111111-1111-4111-8111-111111111111';
  batch_two constant uuid := '22222222-2222-4222-8222-222222222222';
  observed bigint;
  accepted boolean;
  retry_payload jsonb;
begin
  perform set_config('request.jwt.claim.sub', actor_one::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor_one)::text, true);

  retry_payload := jsonb_build_array(jsonb_build_object(
    'feature_key', 'section.home', 'occurred_at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'count', 2
  ));
  perform set_config('test.retry_payload', retry_payload::text, true);
  accepted := public.record_usage_batch(batch_one, retry_payload);
  if accepted is distinct from true then raise exception 'Il primo batch valido non è stato accettato.'; end if;
  accepted := public.record_usage_batch(batch_one, retry_payload);
  -- L'istante fa parte del digest: ripetere identicamente il payload è un retry;
  -- lo stesso UUID con timestamp diverso deve essere rifiutato.
  if accepted then raise exception 'Un batch duplicato è stato contato di nuovo.'; end if;

  select visits into observed from public.usage_daily_aggregates
  where user_id = actor_one and usage_date = (clock_timestamp() at time zone 'UTC')::date and feature_key = 'section.home';
  if observed <> 2 then raise exception 'Retry dello stesso batch ha alterato i contatori.'; end if;

  perform public.record_usage_batch(batch_two, jsonb_build_array(jsonb_build_object(
    'feature_key', 'section.home', 'occurred_at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'count', 3
  )));
  select visits into observed from public.usage_daily_aggregates
  where user_id = actor_one and usage_date = (clock_timestamp() at time zone 'UTC')::date and feature_key = 'section.home';
  if observed <> 5 then raise exception 'Batch distinti non sono stati sommati.'; end if;

  -- UUID riutilizzato con payload diverso è errore, non una seconda scrittura.
  begin
    perform public.record_usage_batch(batch_one, jsonb_build_array(jsonb_build_object(
      'feature_key', 'section.home', 'occurred_at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'count', 4
    )));
    raise exception 'UUID riutilizzato con payload differente accettato.';
  exception when sqlstate '22023' then null;
  end;

  -- Timestamp passato mantiene giorno e ora dell'attività, non dell'invio.
  perform public.record_usage_batch('33333333-3333-4333-8333-333333333333', jsonb_build_array(jsonb_build_object(
    'feature_key', 'customer.created', 'occurred_at', to_char((clock_timestamp() - interval '2 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'count', 1
  )));
  if not exists (select 1 from public.usage_daily_aggregates where user_id = actor_one
    and feature_key = 'customer.created' and usage_date = ((clock_timestamp() at time zone 'UTC')::date - 2)
    and last_used_at < clock_timestamp() - interval '1 day') then
    raise exception 'Data di attività ritardata non preservata in UTC.';
  end if;

  if exists (select 1 from public.usage_daily_aggregates where user_id = actor_two) then
    raise exception 'RLS espone righe di un altro utente.';
  end if;

  -- Rifiuto dei payload malformati e delle date oltre le finestre consentite.
  begin
    perform public.record_usage_batch('44444444-4444-4444-8444-444444444444', '[{"feature_key":"customer.created","occurred_at":"2026-01-01T00:00:00Z","count":1}]'::jsonb);
    raise exception 'Timestamp troppo vecchio accettato.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.record_usage_batch('55555555-5555-4555-8555-555555555555', '[{"feature_key":"customer.created","occurred_at":"2099-01-01T00:00:00Z","count":1}]'::jsonb);
    raise exception 'Timestamp futuro accettato.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.record_usage_batch('66666666-6666-4666-8666-666666666666', '[{"feature_key":"customer.created","occurred_at":"ieri","count":1}]'::jsonb);
    raise exception 'Timestamp non valido accettato.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.record_usage_batch('77777777-7777-4777-8777-777777777777', jsonb_build_array(jsonb_build_object(
      'feature_key', 'customer.created', 'occurred_at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'count', 0
    )));
    raise exception 'Conteggio non positivo accettato.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.record_usage_batch('88888888-8888-4888-8888-888888888888', jsonb_build_array(jsonb_build_object(
      'feature_key', 'customer.name', 'occurred_at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'count', 1
    )));
    raise exception 'Funzione arbitraria accettata.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.record_usage_batch('99999999-9999-4999-8999-999999999999', jsonb_build_array(jsonb_build_object(
      'feature_key', 'customer.created', 'occurred_at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'count', 1, 'private', 'x'
    )));
    raise exception 'Campi inattesi accettati.';
  exception when sqlstate '22023' then null;
  end;

  perform set_config('request.jwt.claim.sub', actor_two::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor_two)::text, true);
  perform public.record_usage_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jsonb_build_array(jsonb_build_object(
    'feature_key', 'section.jobs', 'occurred_at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'count', 1
  )));
  if exists (select 1 from public.usage_daily_aggregates where user_id = actor_one) then
    raise exception 'RLS non isola i dati del primo utente.';
  end if;
end;
$$;

reset role;
do $$
declare
  crypto_schema name;
  expected_sha text;
  stored_sha text;
begin
  select namespace.nspname into crypto_schema
  from pg_catalog.pg_extension extension_row
  join pg_catalog.pg_namespace namespace on namespace.oid = extension_row.extnamespace
  where extension_row.extname = 'pgcrypto';
  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest(pg_catalog.convert_to($1, ''UTF8''), ''sha256''), ''hex'')', crypto_schema
  ) into expected_sha using current_setting('test.retry_payload')::jsonb::text;
  select payload_sha256 into stored_sha from public.usage_batch_receipts
  where user_id = current_setting('test.actor_one')::uuid
    and batch_id = '11111111-1111-4111-8111-111111111111';
  if stored_sha is null or stored_sha !~ '^[0-9a-f]{64}$' or stored_sha <> expected_sha then
    raise exception 'Fingerprint SHA-256 non corrisponde al payload JSONB canonico.';
  end if;
  if exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'usage_batch_receipts' and column_name in ('payload', 'events')) then
    raise exception 'La ricevuta conserva ancora il payload completo.';
  end if;
end;
$$;
update public.usage_analytics_config set collection_enabled = false where singleton;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.actor_one'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.actor_one'))::text, true);
do $$
begin
  if public.record_usage_batch('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', jsonb_build_array(jsonb_build_object(
    'feature_key', 'section.home', 'occurred_at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'count', 1
  ))) then
    raise exception 'Batch accettato mentre la raccolta è disabilitata.';
  end if;
end;
$$;

reset role;
do $$
begin
  if exists (select 1 from public.usage_batch_receipts
    where batch_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then
    raise exception 'Raccolta disabilitata ha creato una ricevuta.';
  end if;
end;
$$;
do $$
begin
  if has_table_privilege('authenticated', 'public.usage_daily_aggregates', 'INSERT')
    or has_table_privilege('authenticated', 'public.usage_daily_aggregates', 'UPDATE')
    or has_table_privilege('anon', 'public.usage_daily_aggregates', 'SELECT')
    or has_table_privilege('anon', 'public.usage_daily_aggregates', 'INSERT')
    or has_table_privilege('anon', 'public.usage_batch_receipts', 'SELECT') then
    raise exception 'Permessi tabella statistiche o ricevute troppo ampi.';
  end if;
  if has_function_privilege('anon', 'public.record_usage_batch(uuid,jsonb)', 'EXECUTE') then
    raise exception 'Il ruolo anon può invocare il registratore.';
  end if;
end;
$$;

-- Ruolo anon non può né leggere la tabella né invocare l'RPC.
set local role anon;
do $$
begin
  begin
    perform 1 from public.usage_daily_aggregates limit 1;
    raise exception 'anon può leggere gli aggregati.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.usage_batch_receipts limit 1;
    raise exception 'anon può leggere le ricevute.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_usage_batch('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '[]'::jsonb);
    raise exception 'RPC invocabile da anon.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
