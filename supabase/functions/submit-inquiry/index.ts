import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const allowedOrigins = new Set(
  (Deno.env.get('PUBLIC_SITE_ORIGINS') ?? 'https://lulabworks.github.io,http://localhost:4321,http://127.0.0.1:4321')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
)
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const MAX_FILE_SIZE = 15 * 1024 * 1024
const MAX_FILES = 3
const WINDOW_MS = 10 * 60 * 1000
const MAX_REQUESTS_PER_WINDOW = 5
const attempts = new Map<string, number[]>()

function corsHeaders(origin: string | null) {
  const allowed = origin && allowedOrigins.has(origin) ? origin : 'https://lulabworks.github.io'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  }
}

function json(origin: string | null, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' }
  })
}

function text(form: FormData, name: string, maxLength: number) {
  const value = form.get(name)
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function safeFileName(name: string) {
  const normalized = name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (normalized || 'fotografia').slice(-160)
}

async function hasValidSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  if (file.type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (file.type === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    return bytes.slice(0, 8).every((value, index) => value === signature[index])
  }
  if (file.type === 'image/webp') {
    const decoder = new TextDecoder()
    return decoder.decode(bytes.slice(0, 4)) === 'RIFF' && decoder.decode(bytes.slice(8, 12)) === 'WEBP'
  }
  if (file.type === 'image/heic' || file.type === 'image/heif') {
    const header = new TextDecoder().decode(bytes.slice(4, 16))
    return header.startsWith('ftyp') && ['heic', 'heix', 'hevc', 'hevx', 'heif', 'mif1'].some((brand) => header.includes(brand))
  }
  return false
}

function rateLimited(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('cf-connecting-ip') || 'unknown'
  const now = Date.now()
  const recent = (attempts.get(ip) ?? []).filter((timestamp) => now - timestamp < WINDOW_MS)
  recent.push(now)
  attempts.set(ip, recent)
  return recent.length > MAX_REQUESTS_PER_WINDOW
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (request.method !== 'POST') return json(origin, { error: 'Metodo non consentito.' }, 405)
  if (!origin || !allowedOrigins.has(origin)) return json(origin, { error: 'Origine non autorizzata.' }, 403)
  if (rateLimited(request)) return json(origin, { error: 'Troppe richieste. Riprova tra qualche minuto.' }, 429)

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > 48 * 1024 * 1024) return json(origin, { error: 'Richiesta troppo grande.' }, 413)

  try {
    const form = await request.formData()
    if (text(form, 'website', 200)) return json(origin, { ok: true, reference_code: 'in-verifica' }, 202)

    const startedAt = Number(text(form, 'form_started_at', 20))
    const elapsed = Date.now() - startedAt
    if (!Number.isFinite(startedAt) || elapsed < 2500 || elapsed > 2 * 60 * 60 * 1000) {
      return json(origin, { error: 'Sessione del modulo non valida. Ricarica la pagina e riprova.' }, 400)
    }

    const requestType = text(form, 'request_type', 100)
    const subject = text(form, 'subject', 160)
    const customerName = text(form, 'customer_name', 160)
    const email = text(form, 'email', 320).toLowerCase()
    const phone = text(form, 'phone', 40)
    const rawMessage = text(form, 'message', 6000)
    const sourcePage = text(form, 'source_page', 500)
    const consent = text(form, 'privacy_consent', 10) === 'true'
    const message = subject ? `Riferimento: ${subject}\n\n${rawMessage}` : rawMessage

    if (requestType.length < 2 || customerName.length < 2 || rawMessage.length < 10 || !consent) {
      return json(origin, { error: 'Controlla i campi obbligatori e il consenso privacy.' }, 400)
    }
    if (!email && !phone) return json(origin, { error: 'Inserisci almeno un recapito tra email e telefono.' }, 400)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(origin, { error: 'Indirizzo email non valido.' }, 400)

    const files = form.getAll('files').filter((entry): entry is File => entry instanceof File && entry.size > 0)
    if (files.length > MAX_FILES) return json(origin, { error: `Puoi allegare al massimo ${MAX_FILES} fotografie.` }, 400)
    for (const file of files) {
      if (!allowedMimeTypes.has(file.type) || file.size > MAX_FILE_SIZE || !(await hasValidSignature(file))) {
        return json(origin, { error: 'Una fotografia ha formato, contenuto o dimensione non consentiti.' }, 400)
      }
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) return json(origin, { error: 'Servizio temporaneamente non disponibile.' }, 503)
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: inquiry, error: inquiryError } = await supabase.from('customer_inquiries').insert({
      request_type: requestType,
      customer_name: customerName,
      email: email || null,
      phone: phone || null,
      message,
      source_page: sourcePage || null,
      privacy_consent_at: new Date().toISOString()
    }).select('id,reference_code').single()
    if (inquiryError || !inquiry) return json(origin, { error: 'Non è stato possibile registrare la richiesta.' }, 500)

    const uploaded: string[] = []
    try {
      for (const file of files) {
        const path = `inquiries/${inquiry.id}/${crypto.randomUUID()}-${safeFileName(file.name)}`
        const { error: uploadError } = await supabase.storage.from('inquiry-uploads').upload(path, file, { contentType: file.type, upsert: false })
        if (uploadError) throw uploadError
        uploaded.push(path)
        const { error: metadataError } = await supabase.from('customer_inquiry_files').insert({
          inquiry_id: inquiry.id,
          storage_path: path,
          file_name: safeFileName(file.name),
          mime_type: file.type,
          size_bytes: file.size
        })
        if (metadataError) throw metadataError
      }
    } catch {
      if (uploaded.length) await supabase.storage.from('inquiry-uploads').remove(uploaded)
      await supabase.from('customer_inquiry_files').delete().eq('inquiry_id', inquiry.id)
      await supabase.from('customer_inquiries').delete().eq('id', inquiry.id)
      return json(origin, { error: 'Non è stato possibile salvare gli allegati. Nessun dato è stato conservato.' }, 500)
    }

    // L'outbox viene popolata soltanto dopo che richiesta, tutti gli allegati e
    // i relativi metadati sono stati salvati. La push non è critica per l'invio:
    // un errore di notifica non annulla una richiesta già registrata.
    const { error: notificationError } = await supabase.from('push_notification_jobs').insert({
      category: 'site_inquiry',
      source_kind: 'site_inquiry',
      source_id: inquiry.id,
      source_marker: 'completed',
      recipient_user_id: null,
      dedupe_key: `site-inquiry:${inquiry.id}`,
      title: 'Nuova richiesta dal sito',
      body: 'È arrivata una nuova richiesta da esaminare.',
      target_path: `/sito?richiesta=${encodeURIComponent(inquiry.id)}`,
      scheduled_for: new Date().toISOString()
    })
    if (notificationError) console.error('Could not enqueue inquiry notification', inquiry.id)

    return json(origin, { ok: true, reference_code: inquiry.reference_code }, 201)
  } catch {
    return json(origin, { error: 'Richiesta non valida.' }, 400)
  }
})
