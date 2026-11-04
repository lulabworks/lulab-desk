import { useSyncExternalStore } from 'react'
import { assistancePreference } from '../lib/adaptive/assistance'
import { Notice, Panel } from './ui'

export function AdaptiveAssistanceSettings() {
  const state = useSyncExternalStore(assistancePreference.subscribe, assistancePreference.getSnapshot)
  return <Panel>
    <div className="flex items-center justify-between gap-4"><h2 className="type-panel-title">Modalità assistenza</h2>
      <button type="button" role="switch" aria-checked={state.enabled} aria-label="Modalità assistenza" aria-describedby="assistance-description" onClick={() => assistancePreference.set(!state.enabled)} className="flex h-11 w-12 shrink-0 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"><span className={`relative block h-7 w-12 rounded-full ${state.enabled ? 'bg-brand' : 'bg-stone-300'}`}><span className={`absolute left-1 top-1 size-5 rounded-full bg-white shadow-sm ${state.enabled ? 'translate-x-5' : 'translate-x-0'}`} /></span></button>
    </div>
    <p id="assistance-description" className="mt-4 text-sm leading-6 text-muted">Esclude le attività svolte da questo dispositivo dalle statistiche di utilizzo. Non modifica i dati del gestionale</p>
    <p className="mt-2 text-sm leading-6 text-muted">Vale solo per questo browser o installazione. Le attività già in coda prima dell’attivazione restano conservate e vengono inviate normalmente.</p>
    {state.error && <div className="mt-3"><Notice tone="error">{state.error}</Notice></div>}
  </Panel>
}
