import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const origins = new Set(['https://lulabworks.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'])
let nextDispatch = 0
Deno.serve(async request => {
  const origin = request.headers.get('origin')
  const headers = { 'Access-Control-Allow-Origin': origin && origins.has(origin) ? origin : 'https://lulabworks.github.io', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin', 'Content-Type': 'application/json' }
  const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST' || !origin || !origins.has(origin)) return reply(403, { error: 'Richiesta non autorizzata.' })
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) return reply(401, { error: 'Sessione non valida.' })
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
    const { data: auth, error: authError } = await client.auth.getUser(token)
    if (authError || !auth.user) return reply(401, { error: 'Sessione non valida.' })
    const { data: editor, error: editorError } = await client.from('site_editors').select('user_id').eq('user_id', auth.user.id).eq('is_active', true).maybeSingle()
    if (editorError || !editor) return reply(403, { error: 'Editor non autorizzato.' })
    const secret = Deno.env.get('GITHUB_SITE_DISPATCH_TOKEN')
    if (!secret) return reply(503, { error: 'Sincronizzazione non configurata.' })
    if (Date.now() < nextDispatch) return reply(429, { error: 'Riprova tra pochi secondi.', retry_after: 10 })
    // Per-isolate backpressure only; workflow concurrency and the scheduled rebuild cover other instances.
    nextDispatch = Date.now() + 10000
    const result = await fetch('https://api.github.com/repos/lulabworks/lulabworks/actions/workflows/deploy-pages.yml/dispatches', {
      method: 'POST', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${secret}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' }, body: JSON.stringify({ ref: 'main' })
    })
    if (result.status !== 204) return reply(result.status === 429 || result.status === 403 ? 429 : 502, { error: 'GitHub non ha accettato la richiesta. Riprova più tardi.', retry_after: Math.max(10, Number(result.headers.get('retry-after')) || 60) })
    return reply(200, { requested: true })
  } catch { return reply(502, { error: 'Impossibile richiedere l’aggiornamento del sito.' }) }
})
