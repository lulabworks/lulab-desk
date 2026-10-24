import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { createSiteSyncQueue } from './siteSyncQueue'

const queues = new Map<string, ReturnType<typeof createSiteSyncQueue>>()
export function useSiteSync(userId: string | undefined) {
  const owner = userId ?? ''
  if (!queues.has(owner)) queues.set(owner, createSiteSyncQueue(async () => {
    if (!supabase || !owner) throw new Error('Sessione non disponibile')
    const { data } = await supabase.auth.getSession()
    if (!data.session || data.session.user.id !== owner) throw new Error('Account cambiato')
    const { data: result, error } = await supabase.functions.invoke('request-site-rebuild', { headers: { Authorization: `Bearer ${data.session.access_token}` } })
    if (error || result?.requested !== true) throw new Error('Aggiornamento non richiesto')
  }, pending => { try { if (owner) { if (pending) localStorage.setItem(`lulab-site-sync:${owner}`, 'pending'); else localStorage.removeItem(`lulab-site-sync:${owner}`) } } catch { /* Keep in-memory retry when storage is unavailable. */ } }))
  const queue = queues.get(owner)!
  const status = useSyncExternalStore(queue.subscribe, queue.getSnapshot)
  useEffect(() => { try { if (owner && localStorage.getItem(`lulab-site-sync:${owner}`) && queue.getSnapshot() === 'idle') queue.schedule() } catch { /* Storage unavailable. */ } }, [owner, queue])
  return { status, request: queue.schedule, retry: queue.retry }
}
