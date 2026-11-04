import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import webpush from 'npm:web-push@3.6.7'
import { checked, diagnosticRecord, type Context } from './diagnostics.ts'

type Job = { id: string; category: 'site_inquiry' | 'appointment' | 'job_delivery' | 'quote_follow_up'; recipient_user_id: string | null; title: string; body: string; target_path: string; attempts: number }
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
    const { data: claimed, error: claimError } = await checked('queue.claim', context, () => admin.rpc('claim_push_notification_jobs', { p_limit: 40 }))
    if (claimError) throw claimError
    for (const job of (claimed ?? []) as Job[]) await deliverJob(admin, job, context)
    return Response.json({ processed: (claimed ?? []).length })
  } catch (error) {
    console.error(JSON.stringify(diagnosticRecord(error, context)))
    return new Response('Push dispatch failed', { status: 500 })
  }
})

async function deliverJob(admin: ReturnType<typeof createClient>, job: Job, dispatchContext: Context) {
  const context: Context = { ...dispatchContext, job_id: job.id, category: job.category, attempts: job.attempts }
  const { data: stillValid, error: validationError } = await checked('notification.validate', context, () => admin.rpc('is_push_notification_job_valid', { p_job_id: job.id }))
  if (validationError) throw validationError
  if (!stillValid) {
    await checked('job.finalize_invalid', context, () => admin.from('push_notification_jobs').update({ status: 'sent', sent_at: new Date().toISOString(), locked_at: null }).eq('id', job.id))
    return
  }
  let recipients: string[] = []
  if (job.category === 'site_inquiry') {
    const { data, error } = await checked('editors.read', context, () => admin.from('site_editors').select('user_id').eq('is_active', true))
    if (error) throw error
    recipients = (data ?? []).map((row: { user_id: string }) => row.user_id)
  } else if (job.recipient_user_id) recipients = [job.recipient_user_id]

  let hasRetry = false
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
      if (previous?.outcome === 'sent' || previous?.outcome === 'expired' || previous?.outcome === 'disabled') continue
      if (previous?.outcome === 'retry' && Date.now() - Date.parse(previous.attempted_at) < 4 * 60_000) { hasRetry = true; continue }
      const delivery = { job_id: job.id, subscription_id: subscription.id, attempted_at: new Date().toISOString(), outcome: 'retry' }
      const { error: deliveryError } = await checked(previous ? 'deliveries.update_attempt' : 'deliveries.insert_attempt', deliveryContext, () => previous
        ? admin.from('push_notification_deliveries').update(delivery).eq('job_id', job.id).eq('subscription_id', subscription.id)
        : admin.from('push_notification_deliveries').insert(delivery))
      if (deliveryError) throw deliveryError
      const payload = JSON.stringify({ title: job.title, body: job.body, path: job.target_path, tag: job.id })
      let sent = false
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth_key } }, payload, { TTL: 3600, urgency: 'normal' })
        sent = true
      } catch (error) {
        console.warn(JSON.stringify(diagnosticRecord(error, deliveryContext, 'web_push.send')))
        const status = Number((error as { statusCode?: number })?.statusCode)
        if (status === 404 || status === 410) {
          const { error: expiredError } = await checked('deliveries.mark_expired', deliveryContext, () => admin.from('push_notification_deliveries').update({ outcome: 'expired', attempted_at: new Date().toISOString() }).eq('job_id', job.id).eq('subscription_id', subscription.id))
          if (expiredError) throw expiredError
          const { error: deleteError } = await checked('subscriptions.delete_expired', deliveryContext, () => admin.from('push_subscriptions').delete().eq('id', subscription.id))
          if (deleteError) throw deleteError
        } else {
          hasRetry = true
          const { error: retryError } = await checked('deliveries.mark_retry', deliveryContext, () => admin.from('push_notification_deliveries').update({ outcome: 'retry', attempted_at: new Date().toISOString() }).eq('job_id', job.id).eq('subscription_id', subscription.id))
          if (retryError) throw retryError
        }
      }
      if (sent) await checked('deliveries.mark_sent', deliveryContext, () => admin.from('push_notification_deliveries').update({ outcome: 'sent', attempted_at: new Date().toISOString() }).eq('job_id', job.id).eq('subscription_id', subscription.id))
    }
  }

  const exhausted = job.attempts >= 8
  const { error } = await checked('job.finalize', context, () => admin.from('push_notification_jobs').update(hasRetry && !exhausted
    ? { status: 'pending', scheduled_for: new Date(Date.now() + 5 * 60_000).toISOString(), locked_at: null }
    : { status: 'sent', sent_at: new Date().toISOString(), locked_at: null }).eq('id', job.id))
  if (error) throw error
}
