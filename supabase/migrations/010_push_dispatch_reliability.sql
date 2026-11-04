-- Nessun UPDATE dei job esistenti: dispatch_attempts NULL richiede revisione manuale.
begin;
grant select on table public.push_notification_preferences to service_role;
alter type public.push_job_status add value if not exists 'failed';
alter type public.push_job_status add value if not exists 'skipped';
alter table public.push_notification_jobs
  add column dispatch_attempts integer check (dispatch_attempts between 0 and 8),
  add column lease_token uuid;
-- DEFAULT separato: solo i nuovi job ricevono il budget, lo storico resta NULL.
alter table public.push_notification_jobs alter column dispatch_attempts set default 0;

-- Il vecchio dispatcher non deve acquisire job senza fencing. Pausa compatibile
-- tra migrazione e deploy della nuova funzione; nessun cambiamento al cron.
create or replace function public.claim_push_notification_jobs(p_limit integer default 40)
returns setof public.push_notification_jobs language sql security definer set search_path = ''
as $$ select j.* from public.push_notification_jobs j where false; $$;

create function public.claim_push_notification_job_v2()
returns setof public.push_notification_jobs language plpgsql security definer set search_path = ''
as $$
begin
  -- Un worker interrotto all'ultimo tentativo non deve restare processing per sempre.
  update public.push_notification_jobs j set status = 'failed', locked_at = null, lease_token = null
  where j.dispatch_attempts = 8 and
    (j.status = 'pending' or (j.status = 'processing' and
      (j.locked_at is null or j.locked_at < pg_catalog.clock_timestamp() - interval '5 minutes')));
  return query
  with candidate as (
    select j.id from public.push_notification_jobs j
    where j.dispatch_attempts < 8 and j.scheduled_for <= pg_catalog.clock_timestamp()
      and (j.status = 'pending' or (j.status = 'processing' and
        (j.locked_at is null or j.locked_at < pg_catalog.clock_timestamp() - interval '5 minutes')))
    order by j.scheduled_for, j.created_at, j.id for update skip locked limit 1
  )
  update public.push_notification_jobs j set status = 'processing',
    locked_at = pg_catalog.clock_timestamp(), lease_token = pg_catalog.gen_random_uuid(),
    attempts = j.attempts + 1, dispatch_attempts = j.dispatch_attempts + 1
  from candidate c where j.id = c.id returning j.*;
end;
$$;

-- Tutte le scritture del nuovo worker sono recintate dal token corrente.
create function public.mutate_push_job_v2(p_job_id uuid, p_token uuid, p_action text,
  p_subscription_id uuid default null, p_outcome text default null)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare j public.push_notification_jobs%rowtype;
begin
  select * into j from public.push_notification_jobs where id = p_job_id for update;
  if not found or j.status <> 'processing' or j.lease_token is distinct from p_token
    or p_token is null or j.locked_at is null
    or j.locked_at < pg_catalog.clock_timestamp() - interval '5 minutes' then
    raise exception using errcode = '55000', message = 'Push lease unavailable';
  end if;
  if p_action = 'heartbeat' then
    update public.push_notification_jobs set locked_at = pg_catalog.clock_timestamp() where id = j.id;
  elsif p_action = 'delivery' then
    if p_subscription_id is null or p_outcome is null or p_outcome not in ('retry', 'sent', 'expired', 'disabled') then
      raise exception using errcode = '22023', message = 'Invalid delivery outcome';
    end if;
    insert into public.push_notification_deliveries(job_id, subscription_id, outcome, attempted_at)
    values(j.id, p_subscription_id, p_outcome, pg_catalog.clock_timestamp())
    on conflict(job_id, subscription_id) do update set outcome = excluded.outcome, attempted_at = excluded.attempted_at
    where public.push_notification_deliveries.outcome = 'retry';
  elsif p_action in ('sent', 'skipped', 'retry') then
    if p_action = 'sent' and not exists(select 1 from public.push_notification_deliveries d where d.job_id = j.id and d.outcome = 'sent') then
      raise exception using errcode = '23514', message = 'No successful push delivery';
    end if;
    update public.push_notification_jobs set
      status = (case when p_action = 'retry' then case when j.dispatch_attempts >= 8 then 'failed' else 'pending' end else p_action end)::public.push_job_status,
      scheduled_for = case when p_action = 'retry' then pg_catalog.clock_timestamp() + interval '5 minutes' else scheduled_for end,
      sent_at = case when p_action = 'sent' then pg_catalog.clock_timestamp() else null end,
      locked_at = null, lease_token = null where id = j.id;
  else
    raise exception using errcode = '22023', message = 'Invalid push action';
  end if;
  return true;
end;
$$;
revoke all on function public.claim_push_notification_job_v2() from public, anon, authenticated;
revoke all on function public.mutate_push_job_v2(uuid,uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_push_notification_job_v2() to service_role;
grant execute on function public.mutate_push_job_v2(uuid,uuid,text,uuid,text) to service_role;
comment on column public.push_notification_jobs.dispatch_attempts is
  'NULL: legacy job held for explicit review. New jobs: bounded retry budget, independent of historical attempts.';
commit;
