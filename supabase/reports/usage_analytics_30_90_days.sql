-- Report aggregato read-only in UTC. usage_date e last_used_at derivano da occurred_at,
-- cioè dall'istante dell'attività validato dal server (non dall'ora di invio batch).
-- Sostituire l'UUID e 30 con i valori desiderati (30 o 90).
-- Eseguire nel SQL Editor Supabase con un ruolo amministrativo: non contiene scritture.
with params as (
  select '00000000-0000-4000-8000-000000000000'::uuid as user_id, 30::integer as days
),
period_rows as (
  select a.feature_key,
         sum(a.visits)::bigint as visits,
         sum(a.operations)::bigint as operations,
         count(distinct a.usage_date)::integer as active_days,
         max(a.last_used_at) as last_used_in_period
  from public.usage_daily_aggregates a
  cross join params p
  where a.user_id = p.user_id
    and a.usage_date >= ((current_timestamp at time zone 'UTC')::date - p.days + 1)
    and a.usage_date <= (current_timestamp at time zone 'UTC')::date
  group by a.feature_key
),
history as (
  select a.feature_key, max(a.last_used_at) as last_used_ever
  from public.usage_daily_aggregates a
  cross join params p
  where a.user_id = p.user_id
  group by a.feature_key
),
user_history as (
  select exists (
    select 1 from public.usage_daily_aggregates a cross join params p where a.user_id = p.user_id
  ) as has_any_data,
  (select count(distinct a.usage_date)::integer
   from public.usage_daily_aggregates a cross join params p
   where a.user_id = p.user_id
     and a.usage_date >= ((current_timestamp at time zone 'UTC')::date - p.days + 1)
     and a.usage_date <= (current_timestamp at time zone 'UTC')::date) as total_active_days
)
select p.days as giorni_periodo,
       c.feature_type as tipo,
       c.section_key as sezione,
       c.feature_key as funzione,
       c.label as nome,
       coalesce(r.visits, 0) as visite,
       coalesce(r.operations, 0) as operazioni_riuscite,
       coalesce(r.active_days, 0) as giorni_attivi_funzione,
       h.total_active_days as giorni_attivi_gestionale,
       r.last_used_in_period as ultimo_uso_attivita_utc_nel_periodo,
       history.last_used_ever as ultimo_uso_attivita_utc_storico,
       case
         when r.feature_key is not null then 'usata_nel_periodo'
         when history.feature_key is not null then 'non_usata_nel_periodo'
         when h.has_any_data then 'mai_usata'
         else 'nessun_dato_disponibile'
       end as stato
from public.usage_feature_catalog c
cross join params p
cross join user_history h
left join period_rows r on r.feature_key = c.feature_key
left join history on history.feature_key = c.feature_key
order by c.feature_type, c.section_key, c.feature_key;
