import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bin = process.env.BARCODE_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lulab-lifecycle-'))
const env = { ...process.env }
for (const key of Object.keys(env)) if (key.startsWith('PG')) delete env[key]
let started = false
function exec(name, args) {
  const result = spawnSync(`${bin}/${name}`, args, { env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}
const args = ['-X','-qAt','-v','ON_ERROR_STOP=1','-h',dir,'-p','55481','-U',os.userInfo().username,'-d','postgres']
const raw = (sql) => spawnSync(`${bin}/psql`, args, { env, input: sql, encoding: 'utf8' })
function sql(query) { const result = raw(query); assert.equal(result.status, 0, result.stderr); return result.stdout.trim() }
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const move = (id, delta) => `insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot) values ('${id}','${delta > 0 ? 'carico' : 'scarico'}',${delta},1);`
function asyncSql(query) {
  const child = spawn(`${bin}/psql`, args, { env }); let out='',err=''
  child.stdout.on('data',d=>out+=d); child.stderr.on('data',d=>err+=d)
  const done = new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',status=>resolve({status,out,err}))})
  child.stdin.end(query); return done
}
async function race(first, second, secondSucceeds, errorPart='') {
  const leader = asyncSql(`begin; ${first} select pg_advisory_xact_lock(88008); select pg_sleep(0.7); commit;`)
  let observed=false
  for(let i=0;i<100;i++) {
    if(sql("select exists(select 1 from pg_locks where locktype='advisory' and objid=88008 and granted)")==='t') {observed=true;break}
    await new Promise(r=>setTimeout(r,10))
  }
  assert.ok(observed,'La prima connessione non ha acquisito il lock atteso')
  const follower=asyncSql(`set lock_timeout='5s'; ${second}`)
  const [a,b]=await Promise.all([leader,follower]); assert.equal(a.status,0,a.err)
  if(secondSucceeds) assert.equal(b.status,0,b.err)
  else {assert.notEqual(b.status,0);assert.ok(b.err.includes(errorPart),b.err)}
}
try {
  exec('initdb',['-D',dir+'/data','-A','trust','--no-locale','--encoding=UTF8'])
  exec('pg_ctl',['-D',dir+'/data','-l',dir+'/server.log','-o',`-c listen_addresses='' -k ${dir} -p 55481`,'-w','start']); started=true
  const harness=read('scripts/test-material-barcodes-postgres.sh')
  sql(harness.split("<<'SQL'\n")[1].split('\nSQL')[0])
  for(const file of ['001_initial_schema.sql','002_phase2_operations.sql','003_phase3_management.sql','007_material_barcodes.sql']) sql(read('supabase/migrations/'+file))
  sql("insert into auth.users(id) values ('81000000-0000-4000-8000-000000000099');")
  // Each psql invocation has a separate session: pass an explicit owner in the
  // setup movement rather than relying on persistent auth settings.
  sql("select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000099',false); insert into public.materials(id,user_id,name,unit,barcode) values ('82000000-0000-4000-8000-000000000099','81000000-0000-4000-8000-000000000099','Preesistente','pz','PREFLIGHT');"+move('82000000-0000-4000-8000-000000000099',1)+"update public.materials set is_active=false where barcode='PREFLIGHT';")
  const before=sql("select row_to_json(m)::text from public.materials m where barcode='PREFLIGHT'")
  const blocked=raw(read('supabase/migrations/008_material_lifecycle.sql'))
  assert.notEqual(blocked.status,0);assert.ok(blocked.stderr.includes('008 non applicata'),blocked.stderr)
  assert.equal(sql("select row_to_json(m)::text from public.materials m where barcode='PREFLIGHT'"),before)
  assert.equal(sql("select count(*) from pg_constraint where conname='materials_archived_zero_stock'"),'0')
  sql("update public.materials set is_active=true where barcode='PREFLIGHT';") // Synthetic fixture only.
  const security=()=>sql("select json_build_object('policies',(select json_agg(p order by tablename,policyname) from pg_policies p where schemaname='public'),'acl',(select json_agg(json_build_object('table',relname,'acl',relacl,'rls',relrowsecurity) order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r'),'fn_acl',(select proacl from pg_proc where oid='public.apply_material_movement()'::regprocedure))::text")
  const securityBefore=security()
  sql(read('supabase/migrations/008_material_lifecycle.sql'))
  assert.equal(security(),securityBefore,'RLS, grant o ACL della funzione esistente cambiati')
  const counts=()=>sql('select (select count(*) from auth.users),(select count(*) from public.materials),(select count(*) from public.material_movements)')
  const baseline=counts();sql(read('supabase/tests/008_material_lifecycle.sql'));assert.equal(counts(),baseline)
  const id='82000000-0000-4000-8000-000000000088'
  sql(`insert into public.materials(id,user_id,name,unit) values ('${id}','81000000-0000-4000-8000-000000000099','Concorrenza','pz');`)
  const asUser="set role authenticated; select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000099',false);"
  await race(asUser+`update public.materials set is_active=false where id='${id}';`,asUser+move(id,1),false,'Materiale archiviato')
  assert.equal(sql(`select is_active||':'||quantity_available from public.materials where id='${id}'`),'false:0.000')
  sql(`update public.materials set is_active=true where id='${id}';`)
  await race(asUser+move(id,1),asUser+`update public.materials set is_active=false where id='${id}';`,false,'giacenza zero')
  await race(asUser+move(id,-1),asUser+`update public.materials set is_active=false where id='${id}';`,true)
  assert.equal(sql(`select is_active||':'||quantity_available from public.materials where id='${id}'`),'false:0.000')
  sql(`update public.materials set is_active=true where id='${id}';`)
  await race(asUser+move(id,1),asUser+move(id,1),true)
  assert.equal(sql(`select quantity_available from public.materials where id='${id}'`),'2.000')
  const reversal='83000000-0000-4000-8000-000000000088'
  sql(asUser+`insert into public.material_movements(id,material_id,movement_type,quantity_delta,unit_cost_snapshot) values ('${reversal}','${id}','scarico',-2,1);`)
  const reverse=`insert into public.material_movements(material_id,movement_type,quantity_delta,unit_cost_snapshot,reversal_of_id) values ('${id}','rettifica',2,1,'${reversal}');`
  await race(asUser+`update public.materials set is_active=false where id='${id}';`,asUser+reverse,false,'Materiale archiviato')
  assert.equal(sql(`select count(*) from public.material_movements where reversal_of_id='${reversal}'`),'0')
  sql(`update public.materials set is_active=true where id='${id}';`)
  await race(asUser+reverse,asUser+`update public.materials set is_active=false where id='${id}';`,false,'giacenza zero')
  const disposable='82000000-0000-4000-8000-000000000077'
  sql(`insert into public.materials(id,user_id,name,unit) values ('${disposable}','81000000-0000-4000-8000-000000000099','Da eliminare','pz');`)
  await race(asUser+`delete from public.materials where id='${disposable}';`,asUser+move(disposable,1),false,'foreign key')
  sql(`insert into public.materials(id,user_id,name,unit) values ('${disposable}','81000000-0000-4000-8000-000000000099','Da conservare','pz');`)
  await race(asUser+move(disposable,1),asUser+`delete from public.materials where id='${disposable}';`,false,'giacenza diversa da zero')
  assert.equal(sql(`select count(*) from public.materials where not is_active and quantity_available<>0`),'0')
  console.log('008 PostgreSQL: preflight senza riscritture, RLS/GRANT invariati, anon, eliminazione/FK, archivio, ripristino, storni, assenza residui e otto gare reali: OK')
} finally {
  if(started) exec('pg_ctl',['-D',dir+'/data','-m','fast','-w','stop'])
  assert.ok(path.basename(dir).startsWith('lulab-lifecycle-')); fs.rmSync(dir,{recursive:true})
  console.log('Cluster temporaneo arrestato e rimosso.')
}
