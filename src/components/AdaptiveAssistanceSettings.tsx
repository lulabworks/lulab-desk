import { useState, useSyncExternalStore } from 'react'
import { assistancePreference } from '../lib/adaptive/assistance'
import { Button, Modal, ModalPresence, Notice, Panel } from './ui'

export function AdaptiveAssistanceSettings() {
  const state = useSyncExternalStore(assistancePreference.subscribe, assistancePreference.getSnapshot)
  const [confirmExclusion, setConfirmExclusion] = useState(false)
  return <Panel>
    <details>
      <summary className="min-h-11 cursor-pointer rounded-lg py-2 text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">Strumenti tecnici e assistenza<span className={`mt-2 block text-sm font-medium ${state.enabled ? 'text-amber-800' : 'text-muted'}`} role="status">{!state.available ? 'Stato della preferenza non verificabile' : state.enabled ? 'Dispositivo escluso dalle statistiche' : 'Esclusione dalle statistiche disattivata'}</span></summary>
      <div className="mt-4 flex items-center justify-between gap-4"><h2 className="type-card-title">Escludi questo dispositivo dalle statistiche</h2>
        <button type="button" role="switch" aria-checked={state.enabled} aria-label="Escludi questo dispositivo dalle statistiche" aria-describedby="assistance-description" onClick={() => { if (state.enabled) assistancePreference.set(false); else setConfirmExclusion(true) }} className="flex h-11 w-12 shrink-0 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"><span className={`relative block h-7 w-12 rounded-full ${state.enabled ? 'bg-brand' : 'bg-stone-300'}`}><span className={`absolute left-1 top-1 size-5 rounded-full bg-white shadow-sm ${state.enabled ? 'translate-x-5' : 'translate-x-0'}`} /></span></button>
      </div>
      <p id="assistance-description" className="mt-4 text-sm leading-6 text-muted">Riservato a test, verifiche e assistenza tecnica. Durante il normale lavoro quotidiano lascia questa impostazione disattivata, così LuLab Desk può utilizzare le nuove attività per capire come personalizzare l’interfaccia. Non modifica i dati del gestionale.</p>
      <p className="mt-2 text-sm leading-6 text-muted">Le statistiche sono contatori aggregati di utilizzo: non comprendono i contenuti delle commesse o i dati dei clienti.</p>
      <p className="mt-2 text-sm leading-6 text-muted">Vale solo per questo browser o installazione. Le attività già in coda prima dell’attivazione restano conservate e vengono inviate normalmente.</p>
    </details>
    {state.error && <div className="mt-3"><Notice tone="error">{state.error}</Notice></div>}
    <ModalPresence>{confirmExclusion && <Modal title="Escludere questo dispositivo?" onClose={() => setConfirmExclusion(false)}><div className="grid gap-4"><Notice>L’attivazione è riservata a test, verifiche e assistenza tecnica.</Notice><p className="text-base leading-6">Questo dispositivo smetterà di contribuire alle statistiche di utilizzo. LuLab Desk non potrà utilizzare le nuove attività svolte qui per capire come personalizzare l’interfaccia.</p><p className="text-base font-semibold leading-6">Per il normale lavoro quotidiano, lascia questa impostazione disattivata.</p><p className="text-sm leading-6 text-muted">Le statistiche sono contatori aggregati, senza contenuti delle commesse o dati dei clienti. Le attività già accodate restano conservate.</p><div className="flex flex-wrap justify-end gap-3"><Button variant="secondary" onClick={() => setConfirmExclusion(false)}>Annulla</Button><Button onClick={() => { assistancePreference.set(true); setConfirmExclusion(false) }}>Conferma esclusione</Button></div></div></Modal>}</ModalPresence>
  </Panel>
}
