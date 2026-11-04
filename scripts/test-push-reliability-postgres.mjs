import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bin = process.env.PUSH_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lulab-push-reliability-'))
const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('PG')) delete env[key]
let started = false
const exec = (name, args) => { const r = spawnSync(`${bin}/${name}`, args, { env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr) }
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-p', '55489', '-U', os.userInfo().username, '-d', 'postgres']
const raw = input => spawnSync(`${bin}/psql`, args, { env, input, encoding: 'utf8' })
const sql = input => { const r = raw(input); assert.equal(r.status, 0, r.stderr); return r.stdout.trim() }
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const expectError = (q, part) => { const r = raw(q); assert.notEqual(r.status, 0); assert(r.stderr.includes(part), r.stderr) }
const insert = key => sql(`insert into public.push_notification_jobs(category,source_kind,source_id,source_marker,dedupe_key,title,body,target_path) values('site_inquiry','site_inquiry',gen_random_uuid(),'test','${key}','Synthetic','Synthetic','/sito') returning id;`)
const claim = () => JSON.parse(sql('select coalesce(json_agg(j),\'[]\') from public.claim_push_notification_job_v2() j;'))
const mutate = (j, action, sub = null, outcome = null) => `select public.mutate_push_job_v2('${j.id}','${j.lease_token}','${action}',${sub ? `'${sub}'` : 'null'},${outcome ? `'${outcome}'` : 'null'});`
function asyncSql(input) {
  const child = spawn(`${bin}/psql`, args, { env }); let out = '', err = ''
  child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d)
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', status => resolve({ status, out, err })) })
  child.stdin.end(input); return done
}
try {
  exec('initdb', ['-D', dir + '/data', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
  exec('pg_ctl', ['-D', dir + '/data', '-l', dir + '/server.log', '-o', `-c listen_addresses='' -k ${dir} -p 55489`, '-w', 'start']); started = true
  sql(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`)
  // Real 006 definitions, only external Auth dependencies stubbed; no operational migrations needed.
  sql(read('supabase/migrations/006_web_push_notifications.sql').split('create or replace function public.enqueue_due_push_reminders()')[0] + '\ncommit;')
  const legacy = insert('legacy')
  sql(`update public.push_notification_jobs set status='processing', attempts=3501,locked_at=now()-interval '1 hour' where id='${legacy}';`)
  const before = sql(`select to_jsonb(j) from public.push_notification_jobs j where id='${legacy}'`)
  const policies = sql("select coalesce(json_agg(p order by tablename,policyname),'[]') from pg_policies p where schemaname='public'")
  sql(read('supabase/migrations/010_push_dispatch_reliability.sql'))
  assert.equal(sql(`select to_jsonb(j)-'dispatch_attempts'-'lease_token' from public.push_notification_jobs j where id='${legacy}'`), before)
  assert.deepEqual(claim(), [], 'Legacy jobs must remain held unchanged')
  assert.equal(sql('select count(*) from public.claim_push_notification_jobs();'), '0')
  assert.equal(sql("select has_table_privilege('service_role','public.push_notification_preferences','SELECT')"), 't')
  assert.equal(sql("select coalesce(json_agg(p order by tablename,policyname),'[]') from pg_policies p where schemaname='public'"), policies)
  sql('set role service_role; select * from public.push_notification_preferences; select * from public.claim_push_notification_job_v2();')
  for (const role of ['anon', 'authenticated']) {
    expectError(`set role ${role}; select * from public.claim_push_notification_job_v2();`, 'permission denied')
    expectError(`set role ${role}; select public.mutate_push_job_v2(gen_random_uuid(),gen_random_uuid(),'sent');`, 'permission denied')
  }
  expectError('set role anon; select * from public.push_notification_preferences;', 'permission denied')
  insert('retry-budget')
  for (let n = 1; n <= 8; n++) {
    const [j] = claim(); assert.equal(j.dispatch_attempts, n)
    sql(mutate(j, 'retry'))
    assert.equal(sql(`select status from public.push_notification_jobs where id='${j.id}'`), n === 8 ? 'failed' : 'pending')
    if (n < 8) sql(`update public.push_notification_jobs set scheduled_for=now() where id='${j.id}'`)
  }
  assert.deepEqual(claim(), [])
  insert('interrupted'); const [old] = claim()
  assert.deepEqual(claim(), [], 'Active lease cannot be stolen')
  sql(`update public.push_notification_jobs set locked_at=now()-interval '6 minutes' where id='${old.id}'`)
  const [fresh] = claim(); assert.equal(fresh.id, old.id); assert.notEqual(fresh.lease_token, old.lease_token)
  expectError(mutate(old, 'retry'), 'Push lease unavailable')
  expectError(mutate(fresh, 'sent'), 'No successful push delivery')
  const user = sql('insert into auth.users values(gen_random_uuid()) returning id;')
  const sub = sql(`insert into public.push_subscriptions(user_id,endpoint,p256dh,auth_key) values('${user}','https://push.invalid/synthetic-only-subscription','${'x'.repeat(32)}','${'x'.repeat(16)}') returning id;`)
  expectError(mutate(old, 'delivery', sub, 'sent'), 'Push lease unavailable')
  sql(mutate(fresh, 'delivery', sub, 'sent')); sql(mutate(fresh, 'delivery', sub, 'retry'))
  assert.equal(sql(`select outcome from public.push_notification_deliveries where job_id='${fresh.id}'`), 'sent', 'Never overwrite successful delivery')
  sql(mutate(fresh, 'sent'))
  insert('interrupted-last'); const [last] = claim()
  sql(`update public.push_notification_jobs set dispatch_attempts=8,locked_at=now()-interval '6 minutes' where id='${last.id}'`)
  assert.deepEqual(claim(), []); assert.equal(sql(`select status from public.push_notification_jobs where id='${last.id}'`), 'failed')
  insert('skipped'); const [skip] = claim(); sql(mutate(skip, 'skipped'))
  assert.equal(sql(`select status||':'||(sent_at is null) from public.push_notification_jobs where id='${skip.id}'`), 'skipped:true')
  // Real concurrent connections: first claim remains uncommitted while second skips its row.
  insert('race-1'); insert('race-2')
  const leader = asyncSql('begin; select id from public.claim_push_notification_job_v2(); select pg_advisory_xact_lock(101010); select pg_sleep(1); commit;')
  let locked = false
  for (let i = 0; i < 100; i++) {
    if (sql("select exists(select 1 from pg_locks where locktype='advisory' and objid=101010 and granted)") === 't') { locked = true; break }
    await new Promise(r => setTimeout(r, 10))
  }
  assert(locked)
  const follower = claim(); const a = await leader; assert.equal(a.status, 0, a.err)
  assert.equal(follower.length, 1); assert(!a.out.includes(follower[0].id), 'Two workers claimed the same job')
  assert.equal(sql("select count(*) from public.push_notification_jobs where dedupe_key like 'race-%' and dispatch_attempts=1 and status='processing'"), '2')
  assert.equal(sql(`select to_jsonb(j)-'dispatch_attempts'-'lease_token' from public.push_notification_jobs j where id='${legacy}'`), before)
  console.log('PostgreSQL 17: 010 reale, GRANT, legacy invariato, 8 tentativi, lease/fencing, stati terminali, deduplica consegne e claim concorrenti: OK')
} finally {
  if (started) exec('pg_ctl', ['-D', dir + '/data', '-m', 'fast', '-w', 'stop'])
  fs.rmSync(dir, { recursive: true }); console.log('Cluster temporaneo arrestato e rimosso.')
}
