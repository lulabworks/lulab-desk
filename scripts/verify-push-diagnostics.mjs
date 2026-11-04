import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const read = p => readFile(new URL(`../${p}`, import.meta.url), 'utf8')
const url = s => `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`
function compile(s) {
  const result = ts.transpileModule(s, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  assert.equal(result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length ?? 0, 0)
  return result.outputText
}
const diagUrl = url(compile(await read('supabase/functions/dispatch-push-notifications/diagnostics.ts')))
const { checked, diagnosticRecord } = await import(diagUrl)
const secret = 'PRIVATE-VAPID-TOKEN endpoint=https://push.invalid/secret cliente@example.test'
for (const err of [{ code: '42501', message: secret, details: secret, hint: secret }, new Error(secret), { statusCode: 410, body: secret }, secret, null]) {
  assert(!JSON.stringify(diagnosticRecord(err, { dispatch_id: 'test' })).includes(secret))
}
const raw = { code: '42703', message: secret }
await assert.rejects(() => checked('preferences.read', { dispatch_id: 'x' }, async () => ({ error: raw })), err => diagnosticRecord(err, { dispatch_id: 'fallback' }).error_code === '42703')
let handler, fail, invalid, previous, sendCount, log, seen, claims, mutations, jobs, onlyFirst, noSubscriptions = false
const job = { id: 'job-uuid', category: 'site_inquiry', attempts: 1, dispatch_attempts: 1, lease_token: 'synthetic-token', title: secret, body: secret, target_path: '/sito?richiesta=private' }
const subscription = { id: 'sub-uuid', user_id: 'private-user', endpoint: secret, auth_key: secret, p256dh: secret }
const dbError = { code: '42501', message: secret, details: secret, hint: secret }
const result = (stage, data = null) => { seen.push(stage); return stage === fail && (!onlyFirst || claims === 1) ? { data: null, error: dbError } : { data, error: null } }
const admin = {
  async rpc(name, p) {
    if (name === 'enqueue_due_push_reminders') return result('reminders.enqueue')
    if (name === 'claim_push_notification_job_v2') return result('queue.claim', claims++ < jobs ? [{ ...job, id: `job-${claims}` }] : [])
    if (name === 'mutate_push_job_v2') {
      mutations.push(p)
      const stage = p.p_action === 'heartbeat' ? 'job.heartbeat' : p.p_action !== 'delivery' ? (invalid ? 'job.finalize_invalid' : 'job.finalize')
        : p.p_outcome === 'retry' ? seen.includes('deliveries.insert_attempt') || seen.includes('deliveries.update_attempt') ? 'deliveries.mark_retry' : previous ? 'deliveries.update_attempt' : 'deliveries.insert_attempt'
        : `deliveries.mark_${p.p_outcome}`
      return result(stage, true)
    }
    return result('notification.validate', !invalid)
  },
  from(table) {
    let method = 'read', payload
    const q = { select() { return q }, eq() { return q }, maybeSingle() { return q },
      insert(p) { method = 'insert'; payload = p; return q }, update(p) { method = 'update'; payload = p; return q }, delete() { method = 'delete'; return q },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (table === 'site_editors') return result('editors.read', [{ user_id: 'private-user' }])
        if (table === 'push_notification_preferences') return result('preferences.read', {})
        if (table === 'push_subscriptions') return result(method === 'delete' ? 'subscriptions.delete_expired' : 'subscriptions.read', noSubscriptions ? [] : [subscription])
        if (table === 'push_notification_jobs') return result(invalid ? 'job.finalize_invalid' : 'job.finalize')
        if (method === 'read') return result('deliveries.read', previous ? { outcome: previous === 'sent' ? 'sent' : 'retry', attempted_at: '2020-01-01T00:00:00Z' } : null)
        return result(payload.outcome === 'retry' && !('job_id' in payload) ? 'deliveries.mark_retry' : payload.outcome === 'retry' ? previous ? 'deliveries.update_attempt' : 'deliveries.insert_attempt' : `deliveries.mark_${payload.outcome}`)
      }).then(resolve, reject) }
    }; return q
  }
}
globalThis.__pushTest = { admin, webpush: { setVapidDetails() {}, async sendNotification() { sendCount++; if (fail === 'web_push.send') throw { statusCode: 503, message: secret }; if (['web_push.expired', 'deliveries.mark_expired', 'subscriptions.delete_expired'].includes(fail)) throw { statusCode: 410, body: secret }; if (fail === 'deliveries.mark_retry') throw new Error(secret) } } }
globalThis.Deno = { env: { get: () => secret }, serve: fn => { handler = fn } }
let source = compile(await read('supabase/functions/dispatch-push-notifications/index.ts'))
source = source.replace(/import .* from ['"]npm:@supabase[^'"\n]+['"];?/, 'const createClient=()=>globalThis.__pushTest.admin;')
source = source.replace(/import .* from ['"]npm:web-push[^'"\n]+['"];?/, 'const webpush=globalThis.__pushTest.webpush;')
source = source.replace("'./diagnostics.ts'", JSON.stringify(diagUrl))
await import(url(source))
const run = async (stage, count = 1, first = false) => {
  fail = stage; sendCount = 0; log = []; seen = []; claims = 0; mutations = []; jobs = count; onlyFirst = first
  const originalError = console.error, originalWarn = console.warn
  console.error = console.warn = value => log.push(JSON.parse(value))
  try { return await handler(new Request('https://local.invalid', { method: 'POST', headers: { 'x-push-cron-secret': secret } })) }
  finally { console.error = originalError; console.warn = originalWarn }
}
for (const stage of ['reminders.enqueue', 'queue.claim', 'notification.validate', 'editors.read', 'preferences.read', 'subscriptions.read', 'deliveries.read', 'deliveries.insert_attempt', 'deliveries.update_attempt', 'deliveries.mark_sent', 'deliveries.mark_expired', 'subscriptions.delete_expired', 'deliveries.mark_retry', 'job.finalize', 'job.finalize_invalid']) {
  invalid = stage === 'job.finalize_invalid'; previous = stage === 'deliveries.update_attempt'
  const response = await run(stage)
  assert.equal(response.status, ['reminders.enqueue', 'queue.claim'].includes(stage) ? 500 : 200, stage)
  assert(log.some(l => l.operation === stage && l.error_code === '42501'), stage)
  assert(!JSON.stringify(log).includes(secret))
  if (stage === 'deliveries.mark_sent') assert.equal(log.some(l => l.operation === 'web_push.send'), false)
}
invalid = false; previous = false
assert.equal((await run('web_push.send')).status, 200)
assert.equal(log[0].operation, 'web_push.send'); assert.equal(log[0].http_status, 503)
assert.equal((await run('none')).status, 200); assert.equal(log.length, 0); assert.equal(sendCount, 1)
assert.equal(mutations.at(-1).p_action, 'sent')
await run('preferences.read', 2)
assert.equal(claims, 3, 'Un errore del primo job non deve impedire il prelievo successivo')
assert.equal(mutations.filter(p => p.p_action === 'retry').length, 2)
await run('web_push.send')
assert.equal(mutations.at(-1).p_action, 'retry')
await run('preferences.read', 2, true)
assert.equal(sendCount, 1, 'Il job sano successivo deve essere inviato anche dopo un errore SQL')
previous = 'sent'; await run('none'); assert.equal(sendCount, 0); assert.equal(mutations.at(-1).p_action, 'sent')
previous = false
await run('web_push.expired'); assert.equal(mutations.at(-1).p_action, 'skipped'); assert(seen.includes('subscriptions.delete_expired'))
noSubscriptions = true; await run('none'); assert.equal(sendCount, 0); assert.equal(mutations.at(-1).p_action, 'skipped'); noSubscriptions = false
invalid = true; await run('none'); assert.equal(mutations.at(-1).p_action, 'skipped'); assert.equal(sendCount, 0)
assert.equal((await handler(new Request('https://local.invalid', { method: 'POST' }))).status, 404)
assert.equal((await handler(new Request('https://local.invalid', { method: 'POST', headers: { 'x-push-cron-secret': 'wrong' } }))).status, 404)
console.log('Diagnostica push: oggetti Supabase, codici e fasi, invio Web Push separato dalle scritture DB, errore finalizzazione notifica invalida e redazione dati sensibili: OK (runtime simulato)')
