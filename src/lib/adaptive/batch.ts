export type UsageEvent = { feature_key: string; occurred_at: string; count: number }
export type UsageBatch = { batch_id: string; events: UsageEvent[] }
export type UsageBatchSender = (userId: string, batch: UsageBatch) => Promise<void>
export type UsageQueue = { userId: string; open: UsageBatch | null; ready: UsageBatch[] }
export type UsageQueueStore = {
  get(userId: string): Promise<UsageQueue>
  update(userId: string, change: (queue: UsageQueue) => UsageQueue): Promise<UsageQueue>
}

const emptyQueue = (userId: string): UsageQueue => ({ userId, open: null, ready: [] })
const copy = <T,>(value: T): T => structuredClone(value)
const uuid = () => crypto.randomUUID()

function createIndexedDbStore(): UsageQueueStore | null {
  if (typeof indexedDB === 'undefined') return null
  let database: Promise<IDBDatabase> | null = null
  const openDatabase = () => {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('lulab-adaptive-usage', 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('account_queues')) {
          request.result.createObjectStore('account_queues', { keyPath: 'userId' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB non disponibile.'))
      request.onblocked = () => reject(new Error('Database locale bloccato da un’altra scheda.'))
    })
    return database
  }
  return {
    async get(userId) {
      const db = await openDatabase()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('account_queues', 'readonly')
        const request = transaction.objectStore('account_queues').get(userId)
        request.onsuccess = () => resolve(request.result ? copy(request.result as UsageQueue) : emptyQueue(userId))
        request.onerror = () => reject(request.error ?? new Error('Lettura coda locale non riuscita.'))
      })
    },
    async update(userId, change) {
      const db = await openDatabase()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('account_queues', 'readwrite')
        const store = transaction.objectStore('account_queues')
        let next = emptyQueue(userId)
        const request = store.get(userId)
        request.onsuccess = () => {
          try {
            next = change(request.result ? copy(request.result as UsageQueue) : emptyQueue(userId))
            store.put(next)
          } catch (error) {
            transaction.abort()
            reject(error)
          }
        }
        request.onerror = () => reject(request.error ?? new Error('Lettura coda locale non riuscita.'))
        transaction.oncomplete = () => resolve(copy(next))
        transaction.onerror = () => reject(transaction.error ?? new Error('Scrittura coda locale non riuscita.'))
        transaction.onabort = () => reject(transaction.error ?? new Error('Transazione coda locale annullata.'))
      })
    }
  }
}

function createMemoryStore(): UsageQueueStore {
  const queues = new Map<string, UsageQueue>()
  const tails = new Map<string, Promise<unknown>>()
  return {
    async get(userId) { return copy(queues.get(userId) ?? emptyQueue(userId)) },
    update(userId, change) {
      const previous = tails.get(userId) ?? Promise.resolve()
      const current = previous.then(() => {
        const next = change(copy(queues.get(userId) ?? emptyQueue(userId)))
        queues.set(userId, copy(next))
        return copy(next)
      })
      tails.set(userId, current.catch(() => undefined))
      return current
    }
  }
}

function createLockedLocalStorageStore(): UsageQueueStore | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.locks) return null
  let storage: Storage
  try { storage = window.localStorage } catch { return null }
  const keyFor = (userId: string) => `lulab-adaptive-queue:${userId}`
  const read = (userId: string): UsageQueue => {
    try {
      const value = storage.getItem(keyFor(userId))
      return value ? { ...emptyQueue(userId), ...JSON.parse(value) as UsageQueue } : emptyQueue(userId)
    } catch { return emptyQueue(userId) }
  }
  return {
    async get(userId) { return copy(read(userId)) },
    update(userId, change) {
      return navigator.locks.request(`lulab-adaptive-queue:${userId}`, { mode: 'exclusive' }, async () => {
        const next = change(read(userId))
        storage.setItem(keyFor(userId), JSON.stringify(next))
        return copy(next)
      })
    }
  }
}

export function createUsageBatcher(
  send: UsageBatchSender,
  retryBaseMs = 2_000,
  retryMaxMs = 60_000,
  options: { store?: UsageQueueStore; createId?: () => string; now?: () => Date; debounceMs?: number; canSend?: (userId: string) => Promise<boolean> } = {}
) {
  const store = options.store ?? createIndexedDbStore() ?? createLockedLocalStorageStore() ?? createMemoryStore()
  const createId = options.createId ?? uuid
  const now = options.now ?? (() => new Date())
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const inFlight = new Map<string, Promise<void>>()
  let disposed = false

  const schedule = (userId: string, delay = options.debounceMs ?? 1_500) => {
    if (disposed || timers.has(userId)) return
    const timer = setTimeout(() => {
      timers.delete(userId)
      void flush(userId).catch(() => schedule(userId, retryBaseMs))
    }, delay)
    timers.set(userId, timer)
  }

  async function record(userId: string, featureKey: string, occurredAt = now().toISOString()) {
    if (disposed) return
    const timestamp = new Date(occurredAt)
    if (!Number.isFinite(timestamp.getTime())) return
    await store.update(userId, (queue) => {
      if (!queue.open) queue.open = { batch_id: createId(), events: [] }
      const day = timestamp.toISOString().slice(0, 10)
      const existing = queue.open.events.find((event) => event.feature_key === featureKey && event.occurred_at.slice(0, 10) === day)
      if (existing) {
        existing.count += 1
        if (timestamp.getTime() > Date.parse(existing.occurred_at)) existing.occurred_at = timestamp.toISOString()
      } else {
        queue.open.events.push({ feature_key: featureKey, occurred_at: timestamp.toISOString(), count: 1 })
      }
      return queue
    })
    schedule(userId)
  }

  async function flush(userId: string) {
    if (disposed) return
    const active = inFlight.get(userId)
    if (active) return active
    const timer = timers.get(userId)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(userId)

    // La transazione IndexedDB serializza l'aggiornamento fra schede. Dopo la
    // congelazione, nuovi eventi ricevono un UUID diverso; retry e flush doppi
    // possono reinviare lo stesso batch, che l'RPC deduplica transazionalmente.
    await store.update(userId, (queue) => {
      if (queue.open) { queue.ready.push(queue.open); queue.open = null }
      return queue
    })
    if (options.canSend && !(await options.canSend(userId))) return

    const task = (async () => {
      let failed = false
      const snapshot = await store.get(userId)
      for (const batch of snapshot.ready) {
        try {
          // Secondo controllo appena prima dell'RPC: mai inviare la coda A con
          // una sessione attiva B. Se la sessione cambia, il batch resta pronto.
          if (options.canSend && !(await options.canSend(userId))) break
          await send(userId, batch)
          await store.update(userId, (queue) => {
            queue.ready = queue.ready.filter((pending) => pending.batch_id !== batch.batch_id)
            return queue
          })
        } catch {
          failed = true
          break
        }
      }
      if (failed) schedule(userId, retryBaseMs)
    })().finally(() => inFlight.delete(userId))
    inFlight.set(userId, task)
    return task
  }

  function dispose() {
    disposed = true
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  }

  return {
    record,
    flush,
    dispose,
    async pendingCount(userId: string, featureKey: string) {
      const queue = await store.get(userId)
      return [...queue.ready, ...(queue.open ? [queue.open] : [])]
        .flatMap((batch) => batch.events)
        .filter((event) => event.feature_key === featureKey)
        .reduce((sum, event) => sum + event.count, 0)
    },
    async pendingBatches(userId: string) {
      const queue = await store.get(userId)
      return [...queue.ready, ...(queue.open ? [queue.open] : [])].map(copy)
    }
  }
}
