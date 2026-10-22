import { Archive, RotateCcw, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { supabase, readableError } from '../lib/supabase'
import type { Material } from '../lib/types'
import { changeMaterialLifecycle, type MaterialLifecycleAction } from '../lib/materialLifecycle'
import { Button, Notice } from './ui'

export function MaterialLifecycleActions({ material, onDone }: { material: Material; onDone: () => Promise<void> }) {
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function act(action: MaterialLifecycleAction) {
    if (!supabase || pending.current) return
    const name = material.name
    const question = action === 'delete'
      ? `Eliminare definitivamente «${name}»? L'operazione non è reversibile. Materiali con movimenti o riferimenti non possono essere eliminati.`
      : action === 'archive' ? `Archiviare «${name}»? Storico, prezzi e codice a barre saranno conservati. Potrai ripristinarlo.` : `Ripristinare «${name}» nell'elenco operativo?`
    if (!window.confirm(question)) return
    pending.current = true; setBusy(true); setError('')
    try {
      await changeMaterialLifecycle(supabase, material.id, action)
      await onDone()
    } catch (failure) { setError(readableError(failure)) }
    finally { pending.current = false; setBusy(false) }
  }
  const zero = Number(material.quantity_available) === 0
  return <div className="mt-5 grid gap-3 border-t border-line pt-5">
    {error && <Notice tone="error">{error}</Notice>}
    {!zero && <p className="text-sm text-muted">Per archiviare o eliminare il materiale, porta prima la giacenza a zero tramite i normali movimenti.</p>}
    {material.is_active ? <Button type="button" variant="secondary" disabled={busy || !zero} onClick={() => void act('archive')}><Archive size={17} /> Archivia materiale</Button>
      : <Button type="button" variant="secondary" disabled={busy} onClick={() => void act('restore')}><RotateCcw size={17} /> Ripristina</Button>}
    <Button type="button" variant="secondary" className="text-red-700" disabled={busy || !zero} onClick={() => void act('delete')}><Trash2 size={17} /> Elimina materiale definitivamente</Button>
    <p className="text-xs text-muted">L’archiviazione conserva tutti i dati. L’eliminazione è definitiva ed è consentita solo senza storico o riferimenti.</p>
  </div>
}
