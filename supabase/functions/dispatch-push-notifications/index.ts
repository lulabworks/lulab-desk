import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import webpush from 'npm:web-push@3.6.7'
import { checked, diagnosticRecord, type Context } from './diagnostics.ts'

type Job = { id: string; category: 'site_inquiry' | 'appointment' | 'job_delivery' | 'quote_follow_up'; recipient_user_id: string | null; title: string; body: string; target_path: string; attempts: number; dispatch_attempts: number; lease_token: string }
type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth_key: string }
const preferenceByCategory = { site_inquiry: 'site_inquiries_enabled', appointment: 'appointments_enabled', job_delivery: 'job_deliveries_enabled', quote_follow_up: 'quotes_enabled' } as const

Deno.serve(async (request) => {
  const cronSecret = Deno.env.get('PUSH_CRON_SECRET')
  if (request.method !== 'POST' || !cronSecret || request.headers.get('x-push-cron-secret') !== cronSecret) return new Response('Not found', { status: 404 })
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT')
  if (!url || !serviceKey || !vapidPublic || !vapidPrivate || !vapidSubject) return new Response('Push service not configured', { status: 503 })
  const context: Context = { dispatch_id: crypto.randomUUID() }

  try {
    await checked('vapid.configure', context, async () => webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate))
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error: scheduleError } = await checked('reminders.enqueue', context, () => admin.rpc('enqueue_due_push_reminders'))
    if (scheduleError) throw scheduleError
    let processed = 0, failed = 0
    const deadline = Date.now() + 50_000
    // Claim only work we can start immediately. A failed job never aborts its siblings.
    while (processed < 10 && Date.now() < deadline) {
      const { data } = await checked('queue.claim', context, () => admin.rpc('claim_push_notification_job_v2'))
      const job = (data as Job[] | null)?.[0]
      if (!job) break
      const jobContext = { ...context, job_id: job.id, category: job.category, attempts: job.attempts }
      try { await deliverJob(admin, job, context) }
      catch (error) {
        failed++
        console.error(JSON.stringify(diagnosticRecord(error, jobContext)))
        try { await mutate(admin, job, jobContext, 'job.recover', 'retry') }
        catch (recoveryError) { console.error(JSON.stringify(diagnosticRecord(recoveryError, jobContext))) }
      }
      processed++
    }
    return Response.json({ processed, failed })
  } catch (error) {
    console.error(JSON.stringify(diagnosticRecord(error, context)))
    return new Response('Push dispatch failed', { status: 500 })
  }
})

async function mutate(admin: ReturnType<typeof createClient>, job: Job, context: Context, operation: string,
  action: string, subscriptionId: string | null = null, outcome: string | null = null) {
  await checked(operation, context, () => admin.rpc('mutate_push_job_v2', {
    p_job_id: job.id, p_token: job.lease_token, p_action: action,
    p_subscription_id: subscriptionId, p_outcome: outcome
  }))
}

async function deliverJob(admin: ReturnType<typeof createClient>, job: Job, dispatchContext: Context) {
  const context: Context = { ...dispatchContext, job_id: job.id, category: job.category, attempts: job.attempts }
  const { data: stillValid, error: validationError } = await checked('notification.validate', context, () => admin.rpc('is_push_notification_job_valid', { p_job_id: job.id }))
  if (validationError) throw validationError
  if (!stillValid) {
    await mutate(admin, job, context, 'job.finalize_invalid', 'skipped')
    return
  }
  let recipients: string[] = []
  if (job.category === 'site_inquiry') {
    const { data, error } = await checked('editors.read', context, () => admin.from('site_editors').select('user_id').eq('is_active', true))
    if (error) throw error
    recipients = (data ?? []).map((row: { user_id: string }) => row.user_id)
  } else if (job.recipient_user_id) recipients = [job.recipient_user_id]

  let hasRetry = false, hasSent = false
  for (const userId of recipients) {
    const { data: preference, error: prefError } = await checked('preferences.read', context, () => admin.from('push_notification_preferences').select(preferenceByCategory[job.category]).eq('user_id', userId).maybeSingle())
    if (prefError) throw prefError
    if (preference && preference[preferenceByCategory[job.category]] === false) continue
    const { data: subscriptions, error: subscriptionError } = await checked('subscriptions.read', context, () => admin.from('push_subscriptions').select('*').eq('user_id', userId))
    if (subscriptionError) throw subscriptionError
    for (const subscription of (subscriptions ?? []) as Subscription[]) {
      const deliveryContext: Context = { ...context, subscription_id: subscription.id }
      const { data: previous, error: previousError } = await checked('deliveries.read', deliveryContext, () => admin.from('push_notification_deliveries').select('outcome,attempted_at').eq('job_id', job.id).eq('subscription_id', subscription.id).maybeSingle())
      if (previousError) throw previousError
      if (previous?.outcome === 'sent') { hasSent = true; continue }
      if (previous?.outcome === 'expired' || previous?.outcome === 'disabled') continue
      if (previous?.outcome === 'retry' && Date.now() - Date.parse(previous.attempted_at) < 4 * 60_000) { hasRetry = true; continue }
      await mutate(admin, job, deliveryContext, 'job.heartbeat', 'heartbeat')
      await mutate(admin, job, deliveryContext, previous ? 'deliveries.update_attempt' : 'deliveries.insert_attempt', 'delivery', subscription.id, 'retry')
      const payload = JSON.stringify({ title: job.title, body: job.body, path: job.target_path, tag: job.id })
      let sent = false
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth_key } }, payload, { TTL: 3600, urgency: 'normal', timeout: 20_000 })
        sent = true
      } catch (error) {
        console.warn(JSON.stringify(diagnosticRecord(error, deliveryContext, 'web_push.send')))
        const status = Number((error as { statusCode?: number })?.statusCode)
        if (status === 404 || status === 410) {
          await mutate(admin, job, deliveryContext, 'deliveries.mark_expired', 'delivery', subscription.id, 'expired')
          const { error: deleteError } = await checked('subscriptions.delete_expired', deliveryContext, () => admin.from('push_subscriptions').delete().eq('id', subscription.id))
          if (deleteError) throw deleteError
        } else {
          hasRetry = true
          await mutate(admin, job, deliveryContext, 'deliveries.mark_retry', 'delivery', subscription.id, 'retry')
        }
      }
      if (sent) {
        hasSent = true
        await mutate(admin, job, deliveryContext, 'deliveries.mark_sent', 'delivery', subscription.id, 'sent')
      }
    }
  }

  await mutate(admin, job, context, 'job.finalize', hasRetry ? 'retry' : hasSent ? 'sent' : 'skipped')
}
