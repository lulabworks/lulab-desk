import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const file=await readFile(new URL('../src/lib/siteSyncQueue.ts',import.meta.url),'utf8')
const code=ts.transpileModule(file,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {createSiteSyncQueue}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const wait=()=>new Promise(resolve=>setTimeout(resolve,30))
let calls=0,pending=false,fail=false
const q=createSiteSyncQueue(async()=>{calls++;if(fail)throw new Error('GitHub offline')},value=>pending=value,5)
q.schedule();q.schedule();q.schedule();await wait()
assert.equal(calls,1);assert.equal(pending,false);assert.equal(q.getSnapshot(),'requested')
fail=true;q.schedule();await wait();assert.equal(q.getSnapshot(),'error');assert.equal(pending,true)
fail=false;await q.retry();assert.equal(pending,false);assert.equal(q.getSnapshot(),'requested')
let release,started=0
const concurrent=createSiteSyncQueue(async()=>{started++;if(started===1)await new Promise(resolve=>{release=resolve})},()=>{},5)
concurrent.schedule();await wait();concurrent.schedule();release();await wait()
assert.equal(started,2,'A change made during dispatch must trigger a final rebuild')
const edge=await readFile(new URL('../supabase/functions/request-site-rebuild/index.ts',import.meta.url),'utf8')
assert.match(edge,/auth\.getUser\(token\)/);assert.match(edge,/eq\('is_active', true\)/);assert.match(edge,/eq\('user_id', auth\.user\.id\)/)
assert.match(edge,/lulabworks\/lulabworks\/actions\/workflows\/deploy-pages.yml\/dispatches/);assert.match(edge,/ref: 'main'/)
assert.match(edge,/result.status !== 204/);assert.match(edge,/nextDispatch/)
console.log('Site sync: debounce, retry senza perdita dei dati, modifiche durante invio, controlli server e destinazione fissa: OK')
