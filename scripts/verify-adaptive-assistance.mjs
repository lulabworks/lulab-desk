import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
async function load(path) {
  const code = ts.transpileModule(await read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
const { createAssistancePreference } = await load('src/lib/adaptive/assistance.ts')
const { createUsageBatcher } = await load('src/lib/adaptive/batch.ts')
function device() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}
const a = device(), b = device()
const mode = createAssistancePreference(() => a)
assert.equal(mode.getSnapshot().enabled, false); assert.equal(mode.canRecord(), true)
mode.set(true); assert.equal(mode.getSnapshot().enabled, true); assert.equal(mode.canRecord(), false)
assert.equal(createAssistancePreference(() => a).getSnapshot().enabled, true, 'restart preserves mode')
assert.equal(createAssistancePreference(() => b).canRecord(), true, 'other device/profile remains independent')
const otherTab = createAssistancePreference(() => a)
mode.set(false); assert.equal(otherTab.canRecord(), true, 'fresh read before storage event')
otherTab.refresh(); assert.equal(otherTab.getSnapshot().enabled, false)
let queue = { userId: 'account', open: null, ready: [] }, writes = 0, beforeWrite = () => {}
const store = { async get() { return structuredClone(queue) }, async update(userId, change) { beforeWrite(); queue = structuredClone(change(structuredClone(queue))); writes++; return structuredClone(queue) } }
const sent = []
const batcher = createUsageBatcher(async (user, batch) => sent.push({ user, batch }), 10, 20, { store, debounceMs: 100000, canRecord: mode.canRecord })
await batcher.record('account', 'job.created')
const pending = await batcher.pendingBatches('account')
mode.set(true)
const writesBefore = writes
await batcher.record('account', 'job.created'); await batcher.record('account', 'section.home')
assert.equal(writes, writesBefore, 'blocked before queue write')
assert.deepEqual(await batcher.pendingBatches('account'), pending, 'existing events and batch IDs preserved')
await batcher.flush('account'); assert.equal(sent.length, 1, 'old queue still drains while assistance active')
assert.equal(sent[0].batch.events[0].count, 1)
mode.set(false); await batcher.record('account', 'job.created')
assert.equal(await batcher.pendingCount('account', 'job.created'), 1)
beforeWrite = () => mode.set(true)
await batcher.record('account', 'section.home')
assert.equal(await batcher.pendingCount('account', 'section.home'), 0, 'mode rechecked inside queued transaction')
beforeWrite = () => {}; batcher.dispose()
const unavailable = createAssistancePreference(() => { throw new Error('SecurityError') })
assert.equal(unavailable.canRecord(), false); unavailable.set(true)
assert.equal(unavailable.getSnapshot().enabled, false); assert(unavailable.getSnapshot().error)
assert.equal(unavailable.getSnapshot().available, false)
const readOnly = createAssistancePreference(() => ({ getItem: a.getItem, setItem() { throw new Error('quota') } }))
readOnly.set(false); assert.equal(readOnly.getSnapshot().enabled, true); assert(readOnly.getSnapshot().error)
const silentFailure = createAssistancePreference(() => ({ getItem: () => null, setItem() {} }))
silentFailure.set(true); assert.equal(silentFailure.getSnapshot().enabled, false); assert(silentFailure.getSnapshot().error)
const usage = await read('src/lib/adaptive/usage.ts')
for (const name of ['recordSuccessfulOperation', 'recordSectionVisit']) {
  const body = usage.slice(usage.indexOf(`export function ${name}`)).split('\n}')[0]
  assert(body.indexOf('assistancePreference.canRecord()') < body.indexOf('batcher.record'))
}
assert.match(usage, /canRecord: assistancePreference.canRecord/)
assert(!usage.includes('localStorage.removeItem'))
console.log('Modalità assistenza: default, blocco pre-coda, ripresa, persistenza, isolamento device/profili, schede, memoria indisponibile, scrittura fallita, code pregresse e attivazione concorrente: OK')
