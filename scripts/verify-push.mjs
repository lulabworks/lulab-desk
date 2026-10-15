import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [migration, worker, client, component, inquiry, dispatch, subscription, viteConfig, entrypoint, sitePage, agendaPage, antitarloPage] = await Promise.all([
  read('supabase/migrations/006_web_push_notifications.sql'),
  read('src/sw.ts'),
  read('src/lib/pushNotifications.ts'),
  read('src/components/PushNotificationSettings.tsx'),
  read('supabase/functions/submit-inquiry/index.ts'),
  read('supabase/functions/dispatch-push-notifications/index.ts'),
  read('supabase/functions/manage-push-subscription/index.ts'),
  read('vite.config.ts'),
  read('src/main.tsx'),
  read('src/pages/SitePage.tsx'),
  read('src/pages/AgendaPage.tsx'),
  read('src/pages/AntitarloPage.tsx')
])

assert.match(migration, /push_notification_preferences[\s\S]+enable row level security/i)
assert.match(migration, /revoke all on public\.push_subscriptions[\s\S]+from public, anon/i)
assert.match(migration, /claim_push_notification_jobs[\s\S]+for update skip locked/i)
assert.match(migration, /is_push_notification_job_valid/)
assert.match(migration, /source_marker::timestamptz = start_time/)
assert.match(migration, /send_cycle_id uuid/)
assert.match(migration, /if new\.status = 'inviato'[\s\S]+clock_timestamp/)
assert.match(migration, /at time zone 'Europe\/Rome'/i)
assert.match(migration, /coalesce\(p\.appointments_enabled, true\)/)

assert.match(worker, /precacheAndRoute\(self\.__WB_MANIFEST\)/)
assert.match(worker, /createHandlerBoundToURL\('index\.html'\)/)
assert.match(worker, /self\.addEventListener\('push'/)
assert.match(worker, /self\.addEventListener\('notificationclick'/)
assert.match(worker, /target\.pathname\.startsWith\(scopeUrl\.pathname\)/)
assert.match(worker, /renotify: false/)
assert.match(viteConfig, /strategies: 'injectManifest'/)
assert.match(viteConfig, /registerType: 'autoUpdate'/)

assert.match(client, /Notification\.requestPermission\(\)/)
assert.match(client, /navigator\.serviceWorker\.ready/)
assert.match(client, /VITE_VAPID_PUBLIC_KEY/)
assert.match(client, /manage-push-subscription/)
assert.match(client, /display-mode: standalone/)
assert.doesNotMatch(client, /VITE_SUPABASE_SERVICE_ROLE_KEY|VAPID_PRIVATE_KEY/)
assert.doesNotMatch(entrypoint, /Notification\.requestPermission/)
assert.match(component, /Nuove richieste dal sito/)
assert.match(component, /Appuntamenti e ritiri/)
assert.match(component, /Consegne imminenti/)
assert.match(component, /Preventivi in attesa/)

const uploadedFiles = inquiry.indexOf("for (const file of files)")
const metadataSaved = inquiry.indexOf('if (metadataError) throw metadataError')
const enqueue = inquiry.indexOf("dedupe_key: `site-inquiry:${inquiry.id}`")
const successfulResponse = inquiry.indexOf("return json(origin, { ok: true, reference_code: inquiry.reference_code }, 201)")
assert.ok(uploadedFiles >= 0 && metadataSaved > uploadedFiles && enqueue > metadataSaved && successfulResponse > enqueue, 'La richiesta push deve essere accodata dopo caricamento e metadati degli allegati e prima della risposta di successo.')
assert.match(inquiry, /Nuova richiesta dal sito/)
assert.match(inquiry, /push non è critica/i)

assert.match(dispatch, /enqueue_due_push_reminders/)
assert.match(dispatch, /claim_push_notification_jobs/)
assert.match(dispatch, /site_editors/)
assert.match(dispatch, /is_push_notification_job_valid/)
assert.match(dispatch, /status === 404 \|\| status === 410/)
assert.match(dispatch, /tag: job\.id/)
assert.match(subscription, /auth\.getUser\(token\)/)
assert.match(subscription, /existing\.user_id !== userId/)
assert.match(subscription, /error\?\.code === '23505'/)
assert.doesNotMatch(subscription, /\.upsert\(/)
assert.match(subscription, /registered_elsewhere/)
assert.match(subscription, /fcm\.googleapis\.com/)
assert.match(subscription, /push\.apple\.com/)
assert.match(sitePage, /searchParams\.get\('richiesta'\)/)
assert.match(agendaPage, /searchParams\.get\('evento'\)/)
assert.match(antitarloPage, /searchParams\.get\('trattamento'\)/)

console.log('Verifiche statiche Web Push superate. I test runtime delle Edge Functions e il collaudo push reale richiedono un progetto Supabase isolato e credenziali VAPID.')
