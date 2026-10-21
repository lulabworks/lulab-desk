#!/usr/bin/env bash
set -euo pipefail
BARCODE_REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BARCODE_PG_BIN="${BARCODE_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
for binary in initdb pg_ctl psql; do test -x "$BARCODE_PG_BIN/$binary" || { echo "Manca PostgreSQL 17: $BARCODE_PG_BIN/$binary" >&2; exit 1; }; done
BARCODE_TEST_ROOT="$(mktemp -d /tmp/lulab-barcodes.XXXXXX)"
cleanup() {
  "$BARCODE_PG_BIN/pg_ctl" -D "$BARCODE_TEST_ROOT/data" -m fast -w stop >/dev/null 2>&1 || true
  case "$BARCODE_TEST_ROOT" in /tmp/lulab-barcodes.*) rm -rf -- "$BARCODE_TEST_ROOT" ;; *) echo 'Percorso inatteso: cluster non rimosso' >&2; return 1 ;; esac
  echo 'Cluster PostgreSQL temporaneo arrestato e rimosso.'
}
trap cleanup EXIT
mkdir "$BARCODE_TEST_ROOT/socket"
"$BARCODE_PG_BIN/initdb" -D "$BARCODE_TEST_ROOT/data" -A trust --no-locale --encoding=UTF8 >"$BARCODE_TEST_ROOT/init.log"
"$BARCODE_PG_BIN/pg_ctl" -D "$BARCODE_TEST_ROOT/data" -l "$BARCODE_TEST_ROOT/server.log" -o "-c listen_addresses='' -k $BARCODE_TEST_ROOT/socket -p 55473" -w start >/dev/null
barcode_psql=(env -u PGPASSWORD -u PGSERVICE -u PGOPTIONS -u PGSSLMODE "$BARCODE_PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$BARCODE_TEST_ROOT/socket" -p 55473 -U "$(id -un)" -d postgres)
"${barcode_psql[@]}" -q <<'SQL'
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
grant usage on schema storage to anon,authenticated;
SQL
for migration in 001_initial_schema.sql 002_phase2_operations.sql 003_phase3_management.sql; do
  "${barcode_psql[@]}" -q -f "$BARCODE_REPO_ROOT/supabase/migrations/$migration"
done
"${barcode_psql[@]}" -q <<'SQL'
insert into auth.users values('71000000-0000-4000-8000-000000000099');
insert into public.materials(id,user_id,name,code,unit) values('70000000-0000-4000-8000-000000000099','71000000-0000-4000-8000-000000000099','Legacy materiale','LEGACY','pz');
insert into public.material_movements(user_id,material_id,movement_type,quantity_delta,unit_cost_snapshot) values('71000000-0000-4000-8000-000000000099','70000000-0000-4000-8000-000000000099','carico',2,3);
SQL
"${barcode_psql[@]}" -q -f "$BARCODE_REPO_ROOT/supabase/migrations/007_material_barcodes.sql"
barcode_counts='select (select count(*) from auth.users), (select count(*) from public.materials), (select count(*) from public.material_movements), (select count(*) from public.jobs), (select count(*) from public.recovered_items)'
barcode_before="$("${barcode_psql[@]}" -Atc "$barcode_counts")"
"${barcode_psql[@]}" -q -f "$BARCODE_REPO_ROOT/supabase/tests/007_material_barcodes.sql"
test "$barcode_before" = "$("${barcode_psql[@]}" -Atc "$barcode_counts")" || { echo 'Residui dopo il rollback SQL' >&2; exit 1; }

# Two real connections compete to withdraw 7 from a stock of 10. Exactly one
# must succeed; the existing atomic SQL trigger must leave stock at 3.
"${barcode_psql[@]}" -q <<'SQL'
insert into auth.users values('71000000-0000-4000-8000-000000000088');
insert into public.materials(id,user_id,name,barcode,unit) values('70000000-0000-4000-8000-000000000088','71000000-0000-4000-8000-000000000088','Concorrenza barcode','LuLab-concurrent','pz');
insert into public.material_movements(user_id,material_id,movement_type,quantity_delta,unit_cost_snapshot) values('71000000-0000-4000-8000-000000000088','70000000-0000-4000-8000-000000000088','carico',10,1);
SQL
barcode_withdraw="begin; set local role authenticated; select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000088',true); insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot) values('70000000-0000-4000-8000-000000000088','scarico',-7,1); select pg_sleep(0.3); commit;"
"${barcode_psql[@]}" -q -c "$barcode_withdraw" >"$BARCODE_TEST_ROOT/race1.log" 2>&1 & barcode_pid1=$!
"${barcode_psql[@]}" -q -c "$barcode_withdraw" >"$BARCODE_TEST_ROOT/race2.log" 2>&1 & barcode_pid2=$!
barcode_status1=0; wait "$barcode_pid1" || barcode_status1=$?
barcode_status2=0; wait "$barcode_pid2" || barcode_status2=$?
if ! { { test "$barcode_status1" = 0 && test "$barcode_status2" != 0; } || { test "$barcode_status2" = 0 && test "$barcode_status1" != 0; }; }; then
  cat "$BARCODE_TEST_ROOT/race1.log" "$BARCODE_TEST_ROOT/race2.log"; echo 'Esito concorrenza inatteso' >&2; exit 1
fi
rg -q 'Movimento non valido: materiale non trovato o giacenza insufficiente' "$BARCODE_TEST_ROOT/race1.log" "$BARCODE_TEST_ROOT/race2.log"
test "$("${barcode_psql[@]}" -Atc "select quantity_available from public.materials where barcode='LuLab-concurrent'")" = '3.000'
test "$("${barcode_psql[@]}" -Atc "select count(*) from public.material_movements where material_id='70000000-0000-4000-8000-000000000088'")" = '2'
echo 'Concorrenza reale: un solo scarico accettato, giacenza 3, nessun movimento respinto residuo: OK'
