import { createClient } from '@supabase/supabase-js'
import { createUsageBatcher } from './batch'
import { USAGE_FEATURES, type UsageFeatureKey } from './catalog'
import { createSectionVisitDeduper } from './visits'
import { supabase } from '../supabase'

const enabled = import.meta.env.PROD
const visitDeduper = createSectionVisitDeduper<UsageFeatureKey>()

async function isActiveAccount(userId: string) {
  if (!supabase) return false
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session?.user.id === userId
}

const batcher = createUsageBatcher(async (userId, batch) => {
  if (!supabase) return
  const { data, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  const session = data.session
  if (session?.user.id !== userId) throw new Error('Sessione diversa: batch mantenuto in coda per il proprietario corretto.')

  const projectUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!projectUrl || !publishableKey || !session) throw new Error('Sessione Supabase non disponibile.')

  // Il client effimero usa il token già verificato di A: anche se l'account
  // cambia prima che parta fetch, non può sostituirlo con il token di B.
  const requestClient = createClient(projectUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => session.access_token
  })
  const abort = new AbortController()
  const authWatch = supabase.auth.onAuthStateChange((_event, currentSession) => {
    if (currentSession?.user.id !== userId) abort.abort()
  })
  try {
    if (!(await isActiveAccount(userId))) throw new Error('Sessione cambiata: batch mantenuto in coda.')
    const { error } = await requestClient.rpc('record_usage_batch', {
      p_batch_id: batch.batch_id,
      p_events: batch.events
    }).abortSignal(abort.signal)
    if (error) throw error
  } finally {
    authWatch.data.subscription.unsubscribe()
  }
}, 2_000, 60_000, { canSend: isActiveAccount })

async function flushCurrentAccount() {
  if (!supabase) return
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    if (data.session?.user.id) await batcher.flush(data.session.user.id)
  } catch {
    // La coda persistente resta intatta e sarà ripresa al prossimo accesso valido.
  }
}

export function recordSuccessfulOperation(userId: string | undefined, featureKey: UsageFeatureKey) {
  if (!enabled || !userId || !supabase || USAGE_FEATURES[featureKey].type !== 'operation') return
  void batcher.record(userId, featureKey).catch(() => undefined)
}

export function recordSectionVisit(userId: string | undefined, featureKey: UsageFeatureKey | null, navigationKey: string) {
  if (!enabled || !userId || !supabase || !featureKey || USAGE_FEATURES[featureKey].type !== 'section_visit') return
  if (!visitDeduper.shouldRecord(userId, featureKey, navigationKey)) return
  void batcher.record(userId, featureKey).catch(() => undefined)
}

if (enabled && typeof window !== 'undefined') {
  // Riprende batch IndexedDB anche se la PWA è stata chiusa completamente e
  // l'utente non ha ancora generato una nuova operazione.
  void flushCurrentAccount()
  const authSubscription = supabase?.auth.onAuthStateChange((event, session) => {
    if (session?.user.id && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) {
      // Non chiamare getSession dentro il callback Auth: può condividere il lock
      // interno di Supabase. La callback termina prima del flush.
      window.setTimeout(() => { void batcher.flush(session.user.id).catch(() => undefined) }, 0)
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushCurrentAccount()
  })
  window.addEventListener('pagehide', () => { void flushCurrentAccount() })
  window.addEventListener('beforeunload', () => { authSubscription?.data.subscription.unsubscribe() })
}
