const KEY = 'lulab-adaptive-assistance:v1'
type State = { enabled: boolean; available: boolean; error: string }
type LocalStore = Pick<Storage, 'getItem' | 'setItem'>

export function createAssistancePreference(storage: () => LocalStore) {
  const listeners = new Set<() => void>()
  function read(): State {
    try {
      const value = storage().getItem(KEY)
      if (value !== null && value !== 'true' && value !== 'false') throw new Error('Valore non valido')
      return { enabled: value === 'true', available: true, error: '' }
    } catch {
      return { enabled: false, available: false, error: 'Memoria locale non disponibile: la preferenza non è verificabile. Le nuove attività Adaptive sono sospese su questo browser.' }
    }
  }
  let state = read()
  function update(next: State) { state = next; listeners.forEach(listener => listener()) }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    refresh() { update(read()) },
    // Re-read before each event, including changes from other tabs before storage events arrive.
    canRecord() { const current = read(); return current.available && !current.enabled },
    set(enabled: boolean) {
      try {
        storage().setItem(KEY, String(enabled))
        const saved = read()
        if (!saved.available || saved.enabled !== enabled) throw new Error('Scrittura non confermata')
        update(saved)
      } catch {
        update({ ...read(), error: 'Impossibile salvare la modalità assistenza su questo browser. La modifica non è confermata; riprova.' })
      }
    }
  }
}

export const assistancePreference = createAssistancePreference(() => window.localStorage)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => { if (event.key === KEY || event.key === null) assistancePreference.refresh() })
  window.addEventListener('pageshow', () => assistancePreference.refresh())
}
