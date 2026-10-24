export type SiteSyncStatus = 'idle' | 'pending' | 'sending' | 'requested' | 'error'

export function createSiteSyncQueue(send: () => Promise<void>, persist: (pending: boolean) => void, delay = 2000) {
  let status: SiteSyncStatus = 'idle', revision = 0, timer: ReturnType<typeof setTimeout> | undefined, running = false
  const listeners = new Set<() => void>()
  function update(value: SiteSyncStatus) { status = value; listeners.forEach(listener => listener()) }
  async function flush() {
    if (timer) clearTimeout(timer)
    if (running) return
    running = true
    const current = revision
    update('sending')
    try {
      await send()
      if (revision === current) { persist(false); update('requested') }
      else { update('pending'); timer = setTimeout(() => void flush(), delay) }
    } catch { update('error') }
    finally { running = false }
  }
  return {
    schedule() { revision++; persist(true); update('pending'); if (timer) clearTimeout(timer); timer = setTimeout(() => void flush(), delay) },
    retry: flush,
    getSnapshot: () => status,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
  }
}
