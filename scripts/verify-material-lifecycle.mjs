import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const read = p => readFile(new URL('../'+p, import.meta.url),'utf8')
async function load(file) {
  const js=ts.transpileModule(await read(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
  return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))
}
const { changeMaterialLifecycle }=await load('src/lib/materialLifecycle.ts')
function fake({count=0,historyError=null,error=null}={}) {
  const calls=[]
  const chain={
    select(...a){calls.push(['select',...a]);return this},
    eq(...a){calls.push(['eq',...a]);return this},
    update(...a){calls.push(['update',...a]);return this},
    delete(){calls.push(['delete']);return this},
    single:async()=>({data:error?null:{id:'m'},error}),
    then(resolve,reject){return Promise.resolve({count,error:historyError}).then(resolve,reject)}
  }
  return {calls,from(table){calls.push(['from',table]);return chain}}
}
for(const action of ['archive','restore','delete']) {
  const client=fake();await changeMaterialLifecycle(client,'m',action)
  assert.ok(client.calls.some(c=>c[0]==='eq'&&c[1]==='id'&&c[2]==='m'))
  if(action==='restore') assert.deepEqual(client.calls.find(c=>c[0]==='update'),['update',{is_active:true}])
  else assert.ok(client.calls.some(c=>c[0]==='eq'&&c[1]==='quantity_available'&&c[2]===0))
  for(const call of client.calls.filter(c=>c[0]==='update')) assert.deepEqual(Object.keys(call[1]),['is_active'])
}
const historical=fake({count:1});await assert.rejects(()=>changeMaterialLifecycle(historical,'m','delete'),/movimenti storici/)
assert.ok(!historical.calls.some(c=>c[0]==='delete'))
await assert.rejects(()=>changeMaterialLifecycle(fake({error:{code:'23503'}}),'m','delete'),/collegato/)
await assert.rejects(()=>changeMaterialLifecycle(fake({error:{code:'PGRST116'}}),'m','archive'),/giacenza/)
const denied={code:'42501',message:'Denied'}
await assert.rejects(()=>changeMaterialLifecycle(fake({historyError:denied}),'m','delete'),e=>e===denied)
const { buildMaterialMovement }=await load('src/lib/materialMovement.ts')
assert.throws(()=>buildMaterialMovement({}, {is_active:false}, []),/archiviato/)
const scanner=await read('src/components/MaterialBarcodeScanner.tsx')
assert.ok(scanner.includes('setArchived(result.data as Material)'))
assert.ok(scanner.includes('onArchived(archived)'))
assert.ok(scanner.includes("if (!result.data) setUnknown(barcode)"))
for(const file of ['src/pages/RecoveryDetailPage.tsx','src/components/JobMaterialsPanel.tsx']) assert.ok((await read(file)).includes(".eq('is_active', true)"))
console.log('Lifecycle materiali: payload minimi, condizioni giacenza, storico, FK, errori RLS, archiviati e collegamento scanner: OK')
