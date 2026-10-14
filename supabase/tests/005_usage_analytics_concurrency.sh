#!/usr/bin/env bash
set -euo pipefail

# Eseguire SOLO su un database PostgreSQL/Supabase temporaneo e isolato.
# Richiede psql, DATABASE_URL di test e TEST_USER_ID (UUID auth.users).
if [[ -z "${DATABASE_URL:-}" || -z "${TEST_USER_ID:-}" ]]; then
  echo "Impostare DATABASE_URL e TEST_USER_ID per il database isolato." >&2
  exit 2
fi
if [[ ! "$TEST_USER_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "TEST_USER_ID deve essere un UUID." >&2
  exit 2
fi

feature=section.home
batch_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
activity_at="$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')"
activity_day="${activity_at:0:10}"
payload="[{\"feature_key\":\"$feature\",\"occurred_at\":\"$activity_at\",\"count\":1}]"

enabled="$(psql "$DATABASE_URL" -X -Atq -v ON_ERROR_STOP=1 -c "select collection_enabled from public.usage_analytics_config where singleton")"
if [[ "$enabled" != "t" ]]; then
  echo "La raccolta deve essere abilitata esplicitamente nel database isolato per questo test." >&2
  exit 2
fi

before="$(psql "$DATABASE_URL" -X -Atq -v ON_ERROR_STOP=1 -c "select coalesce(visits,0) from public.usage_daily_aggregates where user_id='$TEST_USER_ID' and usage_date='$activity_day' and feature_key='$feature'")"
before="${before:-0}"
statement="begin; set local role authenticated; select set_config('request.jwt.claim.sub','$TEST_USER_ID',true); select set_config('request.jwt.claims','{\"sub\":\"$TEST_USER_ID\"}',true); select public.record_usage_batch('$batch_id'::uuid,'$payload'::jsonb); commit;"

# Due connessioni autonome partono con lo stesso UUID e payload: l'univocità
# delle ricevute le serializza e una sola incrementa il contatore.
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "$statement" >/dev/null & first=$!
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "$statement" >/dev/null & second=$!
wait "$first"
wait "$second"

after="$(psql "$DATABASE_URL" -X -Atq -v ON_ERROR_STOP=1 -c "select visits from public.usage_daily_aggregates where user_id='$TEST_USER_ID' and usage_date='$activity_day' and feature_key='$feature'")"
if [[ "$after" -ne "$((before + 1))" ]]; then
  echo "ERRORE: due richieste concorrenti hanno prodotto $((after - before)) incrementi, atteso 1." >&2
  exit 1
fi
echo "OK: due richieste concorrenti con lo stesso batch UUID hanno prodotto un solo incremento."
