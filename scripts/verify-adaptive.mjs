import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')
async function readTree(directory) {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? readTree(`${directory}/${entry.name}`)
    : entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? read(`${directory}/${entry.name}`) : Promise.resolve('')))
  return files.join('\n')
}
const importTypeScript = async (path) => {
  const source = await read(path)
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

const [{ USAGE_FEATURES, sectionFeatureForPath }, { createSectionVisitDeduper }, { createUsageBatcher }] = await Promise.all([
  importTypeScript('src/lib/adaptive/catalog.ts'),
  importTypeScript('src/lib/adaptive/visits.ts'),
  importTypeScript('src/lib/adaptive/batch.ts')
])

assert.equal(sectionFeatureForPath('/'), 'section.home')
assert.equal(sectionFeatureForPath('/lavori/123'), 'section.jobs')
assert.equal(sectionFeatureForPath('/lavori/123/preventivi/456'), 'section.jobs')
assert.equal(sectionFeatureForPath('/sito/collezione/123'), 'section.site')
assert.equal(sectionFeatureForPath('/non-esistente'), null)

const visits = createSectionVisitDeduper()
assert.equal(visits.shouldRecord('user-a', 'section.home', 'route-1'), true)
assert.equal(visits.shouldRecord('user-a', 'section.home', 'route-1'), false)
assert.equal(visits.shouldRecord('user-a', 'section.home', 'route-2'), false)
assert.equal(visits.shouldRecord('user-a', 'section.jobs', 'route-3'), true)
assert.equal(visits.shouldRecord('user-a', 'section.home', 'route-4'), true)
assert.equal(visits.shouldRecord('user-b', 'section.home', 'route-1'), true)

class SharedQueueStore {
  queues = new Map()
  tails = new Map()
  async get(userId) { return structuredClone(this.queues.get(userId) ?? { userId, open: null, ready: [] }) }
  update(userId, change) {
    const previous = this.tails.get(userId) ?? Promise.resolve()
    const current = previous.then(() => {
      const next = change(structuredClone(this.queues.get(userId) ?? { userId, open: null, ready: [] }))
      this.queues.set(userId, structuredClone(next))
      return structuredClone(next)
    })
    this.tails.set(userId, current.catch(() => undefined))
    return current
  }
}
const store = new SharedQueueStore()
let nextId = 1
const id = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`
const at = new Date('2026-10-14T09:30:00.000Z')
const sent = []
const queue = createUsageBatcher(async (userId, batch) => { sent.push({ userId, batch: structuredClone(batch) }) }, 2_000, 60_000,
  { store, createId: id, now: () => at })
await queue.record('user-a', 'job.created')
await queue.record('user-a', 'job.created')
await queue.record('user-b', 'job.created')
assert.equal(await queue.pendingCount('user-a', 'job.created'), 2)
await queue.flush('user-a')
await queue.flush('user-b')
assert.deepEqual(sent, [
  { userId: 'user-a', batch: { batch_id: '00000000-0000-4000-8000-000000000001', events: [{ feature_key: 'job.created', occurred_at: at.toISOString(), count: 2 }] } },
  { userId: 'user-b', batch: { batch_id: '00000000-0000-4000-8000-000000000002', events: [{ feature_key: 'job.created', occurred_at: at.toISOString(), count: 1 }] } }
], 'eventi raggruppati con timestamp attività UTC e batch ID distinti per account')

let unblock
let firstSendStarted
const firstStarted = new Promise((resolve) => { firstSendStarted = resolve })
const delayedQueue = createUsageBatcher(async (_userId, batch) => {
  if (batch.events[0]?.feature_key === 'agenda.created' && !unblock) {
    firstSendStarted()
    await new Promise((resolve) => { unblock = resolve })
  }
  sent.push({ batch: structuredClone(batch) })
}, 2_000, 60_000, { store, createId: id, now: () => at })
await delayedQueue.record('user-c', 'agenda.created')
const firstFlush = delayedQueue.flush('user-c')
await firstStarted
await delayedQueue.record('user-c', 'agenda.created')
unblock()
await firstFlush
await delayedQueue.flush('user-c')
assert.equal(sent.at(-1).batch.events[0].count, 1, 'eventi arrivati durante un invio usano il batch seguente')
assert.notEqual(sent.at(-1).batch.batch_id, sent.at(-2).batch.batch_id, 'payload già in invio resta immutabile')

let failOnce = true
const attempts = []
const retryQueue = createUsageBatcher(async (_userId, batch) => {
  attempts.push(structuredClone(batch))
  if (failOnce) { failOnce = false; throw new Error('rete offline') }
}, 2_000, 60_000, { store, createId: id, now: () => at })
await retryQueue.record('user-d', 'finance.payment_created', '2026-10-13T23:59:59.000Z')
await retryQueue.flush('user-d')
const failedBatch = (await retryQueue.pendingBatches('user-d'))[0]
assert.equal(failedBatch.events[0].occurred_at, '2026-10-13T23:59:59.000Z', 'giorno attività non slitta al giorno di invio')
assert.deepEqual(attempts[0], failedBatch, 'il primo tentativo invia l’UUID e il payload persistiti')
assert.equal(await retryQueue.pendingCount('user-d', 'finance.payment_created'), 1, 'errore mantiene evento e payload persistito')
retryQueue.dispose()

const reloadedQueue = createUsageBatcher(async (_userId, batch) => { attempts.push(structuredClone(batch)) }, 2_000, 60_000,
  { store, createId: id, now: () => at })
await reloadedQueue.flush('user-d')
assert.deepEqual(attempts[1], failedBatch, 'reload e retry riutilizzano esattamente UUID e payload')
assert.equal(await reloadedQueue.pendingCount('user-d', 'finance.payment_created'), 0)

// Cambio account: una coda pendente di A non viene inviata mentre è attivo B;
// al ritorno di A viene ripresa con lo stesso ID e payload.
let activeAccount = 'account-b'
const accountAttempts = []
const isolatedQueue = createUsageBatcher(async (userId, batch) => {
  if (activeAccount !== userId) throw new Error('account mismatch')
  accountAttempts.push({ userId, batch: structuredClone(batch) })
}, 2_000, 60_000, { store, createId: id, now: () => at, canSend: async (userId) => activeAccount === userId })
await isolatedQueue.record('account-a', 'job.created')
const accountABatch = (await isolatedQueue.pendingBatches('account-a'))[0]
await isolatedQueue.flush('account-a')
assert.equal(accountAttempts.length, 0, 'il batch A non è inviato nella sessione B')
assert.equal(await isolatedQueue.pendingCount('account-a', 'job.created'), 1)
activeAccount = 'account-a'
await isolatedQueue.flush('account-a')
assert.equal(accountAttempts[0].userId, 'account-a')
assert.deepEqual(accountAttempts[0].batch, accountABatch, 'il ritorno all’account proprietario riprende il batch invariato')

let raceAccount = 'race-account-a'
let preflightChecks = 0
const raceSends = []
const raceQueue = createUsageBatcher(async (userId, batch) => {
  if (raceAccount !== userId) throw new Error('account changed at dispatch')
  raceSends.push(structuredClone(batch))
}, 2_000, 60_000, {
  store,
  createId: id,
  now: () => at,
  canSend: async (userId) => {
    preflightChecks += 1
    if (preflightChecks === 2) raceAccount = 'race-account-b'
    return raceAccount === userId
  }
})
await raceQueue.record('race-account-a', 'job.updated')
await raceQueue.flush('race-account-a')
assert.equal(raceSends.length, 0, 'un cambio account fra preflight e invio blocca la RPC')
raceAccount = 'race-account-a'
await raceQueue.flush('race-account-a')
assert.equal(raceSends.length, 1, 'il batch riparte quando ritorna l’account proprietario')

// Due schede condividono un backend transazionale: gli aggiornamenti non si
// sovrascrivono e i flush concorrenti dello stesso UUID incrementano una volta.
const multiTabStore = new SharedQueueStore()
const serverReceipts = new Map()
const serverTotals = new Map()
const serverSend = async (userId, batch) => {
  await new Promise((resolve) => setTimeout(resolve, 2))
  const key = `${userId}:${batch.batch_id}`
  const payload = JSON.stringify(batch.events)
  if (serverReceipts.has(key)) {
    assert.equal(serverReceipts.get(key), payload, 'retry ID identico deve conservare payload identico')
    return
  }
  serverReceipts.set(key, payload)
  serverTotals.set(userId, (serverTotals.get(userId) ?? 0) + batch.events.reduce((sum, event) => sum + event.count, 0))
}
const tabOne = createUsageBatcher(serverSend, 2_000, 60_000, { store: multiTabStore, createId: id, now: () => at })
const tabTwo = createUsageBatcher(serverSend, 2_000, 60_000, { store: multiTabStore, createId: id, now: () => at })
await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? tabOne : tabTwo).record('shared-account', 'job.updated')))
assert.equal(await tabOne.pendingCount('shared-account', 'job.updated'), 20, 'transazioni IDB logiche non perdono scritture tra schede')
await Promise.all([tabOne.flush('shared-account'), tabTwo.flush('shared-account')])
assert.equal(serverTotals.get('shared-account'), 20, 'retry simultanei fra schede non duplicano gli incrementi server')
assert.equal(await tabTwo.pendingCount('shared-account', 'job.updated'), 0)

const sql = await read('supabase/migrations/005_usage_analytics.sql')
const appShell = await read('src/components/AppShell.tsx')
const usage = await read('src/lib/adaptive/usage.ts')
const report = await read('supabase/reports/usage_analytics_30_90_days.sql')
const securityTest = await read('supabase/tests/005_usage_analytics_security.sql')
const concurrencyTest = await read('supabase/tests/005_usage_analytics_concurrency.sh')
const docs = await read('docs/LULAB-ADAPTIVE.md')
const appSources = await readTree('src')
const catalogKeys = Object.keys(USAGE_FEATURES).sort()
const sqlKeys = [...sql.matchAll(/^\s*\('([^']+)', '(?:section_visit|operation)'/gm)].map((match) => match[1]).sort()
assert.deepEqual(sqlKeys, catalogKeys, 'catalogo TypeScript e migrazione SQL devono avere gli stessi identificatori')
for (const featureKey of catalogKeys) assert.ok(sql.includes(`('${featureKey}',`), `chiave SQL mancante: ${featureKey}`)
for (const featureKey of catalogKeys.filter((key) => USAGE_FEATURES[key].type === 'operation')) {
  assert.ok(appSources.includes(`'${featureKey}'`), `operazione non collegata: ${featureKey}`)
}
assert.match(sql, /jsonb_object_keys/i)
assert.doesNotMatch(sql, /jsonb_object_length/i)
assert.match(sql, /collection_enabled boolean not null default false/i)
assert.match(sql, /values \(true, false\)/i)
assert.match(sql, /p_batch_id uuid, p_events jsonb/i)
assert.match(sql, /primary key \(user_id, batch_id\)/i)
assert.match(sql, /on conflict \(user_id, batch_id\) do nothing/i)
assert.match(sql, /create extension if not exists pgcrypto/i)
assert.match(sql, /digest\(pg_catalog\.convert_to\(\$1, ''UTF8''\), ''sha256''\)/i)
assert.match(sql, /payload_sha256 text not null check \(payload_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/i)
assert.match(sql, /existing_sha256 is distinct from payload_sha256/i)
assert.doesNotMatch(sql, /payload jsonb not null/i)
assert.match(sql, /90 days/i)
assert.match(sql, /5 minutes/i)
assert.match(sql, /at time zone 'UTC'/i)
assert.match(sql, /primary key \(user_id, usage_date, feature_key\)/i)
assert.match(sql, /alter table public\.usage_daily_aggregates enable row level security/i)
assert.match(sql, /using \(\(select auth\.uid\(\)\) = user_id\)/i)
assert.match(sql, /revoke all privileges on table public\.usage_batch_receipts from public, anon, authenticated/i)
assert.match(sql, /security definer[\s\S]+?set search_path = ''/i)
assert.match(usage, /p_batch_id: batch\.batch_id/)
assert.match(usage, /p_events: batch\.events/)
assert.match(usage, /throw new Error\('Sessione diversa/)
assert.match(usage, /session\?\.user\.id !== userId/)
assert.match(usage, /accessToken: async \(\) => session\.access_token/)
assert.match(usage, /abort\.abort\(\)/)
assert.match(usage, /SIGNED_IN.*TOKEN_REFRESHED.*USER_UPDATED/s)
assert.match(await read('src/lib/adaptive/batch.ts'), /indexedDB\.open\('lulab-adaptive-usage'/)
assert.match(await read('src/lib/adaptive/batch.ts'), /createObjectStore\('account_queues', \{ keyPath: 'userId' \}\)/)
assert.doesNotMatch(await read('src/lib/adaptive/batch.ts'), /sessionStorage/)
assert.match(appShell, /recordSectionVisit\(user\?\.id, sectionFeatureForPath\(location\.pathname\), location\.key\)/)
assert.match(usage, /import\.meta\.env\.PROD/)
assert.match(report, /nessun_dato_disponibile/)
assert.match(securityTest, /rollback;/i)
assert.match(securityTest, /collection_enabled = false/i)
assert.match(securityTest, /record_usage_batch\(batch_one, retry_payload\)/)
assert.match(securityTest, /Fingerprint SHA-256/i)
assert.match(securityTest, /payload_sha256/i)
assert.match(concurrencyTest, /Due connessioni autonome/)
assert.match(docs, /un UUID[\s\S]+payload immutabili/i)
assert.match(docs, /90 giorni/i)
assert.doesNotMatch(sql, /grant .*to anon/is)

queue.dispose(); delayedQueue.dispose(); retryQueue.dispose(); reloadedQueue.dispose(); isolatedQueue.dispose(); raceQueue.dispose(); tabOne.dispose(); tabTwo.dispose()
assert.equal(createHash('sha256').update('abc', 'utf8').digest('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 test vector')
console.log(`Catalogo eventi sincronizzato (${catalogKeys.length} identificatori): OK`)
console.log('Coda batch persistente, UUID stabile nei retry e payload immutabile: OK')
console.log('Eventi durante l’invio isolati in batch successivo; attività UTC/offline preservata: OK')
console.log('Ripristino dopo riapertura, cambio account e due schede concorrenti: OK (store transazionale simulato)')
console.log('RLS, grants, idempotenza e validazioni migrazione: OK (verifica statica)')
console.log('Test SQL sequenziale e harness PostgreSQL concorrente preparati; non sostituiscono l’esecuzione reale.')
