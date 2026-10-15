import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const origins = new Set(['https://lulabworks.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'])
function response(origin: string | null, body: Record<string, unknown>, status = 200) {
  const allowed = origin && origins.has(origin) ? origin : 'https://lulabworks.github.io'
  return new Response(JSON.stringify(body), { status, headers: { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json; charset=utf-8', Vary: 'Origin' } })
}
function validPushHost(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'fcm.googleapis.com' || url.hostname.endsWith('.fcm.googleapis.com') || url.hostname.endsWith('.push.services.mozilla.com') || url.hostname.endsWith('.push.apple.com'))
  } catch { return false }
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': origin && origins.has(origin) ? origin : 'https://lulabworks.github.io', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' } })
  if (request.method !== 'POST' || !origin || !origins.has(origin)) return response(origin, { error: 'Richiesta non autorizzata.' }, 403)

  try {
    const authorization = request.headers.get('authorization') ?? ''
    const token = authorization.replace(/^Bearer\s+/i, '')
    if (!token || token === authorization) return response(origin, { error: 'Sessione non valida.' }, 401)
    const url = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anonKey || !serviceKey) return response(origin, { error: 'Servizio temporaneamente non disponibile.' }, 503)
    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: authData, error: authError } = await authClient.auth.getUser(token)
    if (authError || !authData.user) return response(origin, { error: 'Sessione non valida.' }, 401)
    const userId = authData.user.id
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const body = await request.json()
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
    if (!validPushHost(endpoint)) return response(origin, { error: 'Endpoint push non valido.' }, 400)

    if (body.action === 'status') {
      const { data, error } = await admin.from('push_subscriptions').select('user_id').eq('endpoint', endpoint).maybeSingle()
      if (error) throw error
      return response(origin, { registered: data?.user_id === userId, registered_elsewhere: Boolean(data && data.user_id !== userId) })
    }

    if (body.action === 'remove') {
      // Possedere l'endpoint locale autorizza a rimuovere la registrazione del
      // dispositivo anche se l'account è stato cambiato nel frattempo.
      const { error } = await admin.from('push_subscriptions').delete().eq('endpoint', endpoint)
      if (error) throw error
      return response(origin, { ok: true })
    }
    if (body.action !== 'register' || typeof body.keys?.p256dh !== 'string' || typeof body.keys?.auth !== 'string' ||
      !/^[A-Za-z0-9_-]{80,100}$/.test(body.keys.p256dh) || !/^[A-Za-z0-9_-]{20,32}$/.test(body.keys.auth)) {
      return response(origin, { error: 'Sottoscrizione push non valida.' }, 400)
    }

    const { data: existing, error: lookupError } = await admin.from('push_subscriptions').select('id,user_id').eq('endpoint', endpoint).maybeSingle()
    if (lookupError) throw lookupError
    if (existing && existing.user_id !== userId) {
      return response(origin, { error: 'Questo dispositivo è registrato con un altro account. Rimuovi la registrazione precedente prima di cambiarlo.' }, 409)
    }
    const subscription = {
      user_id: userId, endpoint,
      p256dh: body.keys.p256dh, auth_key: body.keys.auth, last_seen_at: new Date().toISOString()
    }
    if (existing) {
      const { data: updated, error } = await admin.from('push_subscriptions').update(subscription)
        .eq('endpoint', endpoint).eq('user_id', userId).select('id').maybeSingle()
      if (error) throw error
      if (!updated) return response(origin, { error: 'La registrazione di questo dispositivo è cambiata. Riprova.' }, 409)
    } else {
      const { error } = await admin.from('push_subscriptions').insert(subscription)
      // Due sessioni/account possono registrare lo stesso endpoint nello stesso
      // momento: il vincolo UNIQUE decide il vincitore, senza trasferire ownership.
      if (error?.code === '23505') {
        const { data: raceOwner, error: raceLookupError } = await admin.from('push_subscriptions').select('user_id').eq('endpoint', endpoint).maybeSingle()
        if (raceLookupError) throw raceLookupError
        if (raceOwner?.user_id !== userId) return response(origin, { error: 'Questo dispositivo è stato appena registrato con un altro account.' }, 409)
        const { data: racedUpdate, error: racedUpdateError } = await admin.from('push_subscriptions').update(subscription)
          .eq('endpoint', endpoint).eq('user_id', userId).select('id').maybeSingle()
        if (racedUpdateError) throw racedUpdateError
        if (!racedUpdate) return response(origin, { error: 'La registrazione di questo dispositivo è cambiata. Riprova.' }, 409)
        return response(origin, { ok: true })
      }
      if (error) throw error
    }
    return response(origin, { ok: true })
  } catch (error) {
    console.error('manage-push-subscription failed', error instanceof Error ? error.message : 'unknown error')
    return response(origin, { error: 'Non è stato possibile aggiornare questo dispositivo.' }, 500)
  }
})
