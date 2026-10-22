import { Barcode, Camera, Plus } from 'lucide-react'
import { useIsPresent } from 'motion/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { barcodeLookupValues, normalizeBarcode } from '../lib/barcode'
import { cameraErrorMessage, startBarcodeCamera } from '../lib/barcodeCamera'
import { readableError, supabase } from '../lib/supabase'
import type { Material } from '../lib/types'
import { Button, Field, Input, Modal, Notice } from './ui'

export function MaterialBarcodeScanner({ userId, onFound, onArchived, onCreate, onClose }: {
  userId: string
  onFound: (material: Material) => void
  onArchived: (material: Material) => void
  onCreate: (barcode: string) => void
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const stopCamera = useRef<() => void>(() => {})
  const requestId = useRef(0)
  const busy = useRef(false)
  const [enabled, setEnabled] = useState(true)
  const [status, setStatus] = useState('Avvio della fotocamera…')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [searching, setSearching] = useState(false)
  const [archived, setArchived] = useState<Material | null>(null)
  const [unknown, setUnknown] = useState<string | null>(null)
  const present = useIsPresent()

  async function lookup(value: string) {
    if (busy.current || !supabase) return
    stopCamera.current(); setEnabled(false)
    setError(''); setUnknown(null); setArchived(null)
    let barcode: string
    try { barcode = normalizeBarcode(value) } catch (failure) { setError(readableError(failure)); return }
    setCode(barcode)
    busy.current = true; setSearching(true)
    const generation = ++requestId.current
    try {
      const result = await supabase.from('materials').select('*').eq('user_id', userId).in('barcode', barcodeLookupValues(barcode)).maybeSingle()
      if (generation !== requestId.current) return
      if (result.error) throw result.error
      if (!result.data) setUnknown(barcode)
      else if (!result.data.is_active) setArchived(result.data as Material)
      else onFound(result.data as Material)
    } catch (failure) {
      if (generation === requestId.current) setError(readableError(failure))
    } finally {
      if (generation === requestId.current) { busy.current = false; setSearching(false) }
    }
  }
  const lookupRef = useRef(lookup)
  lookupRef.current = lookup

  useEffect(() => {
    if (!enabled || !present || !video.current) return
    const stop = startBarcodeCamera(video.current, (value) => void lookupRef.current(value), (failure) => {
      setError(cameraErrorMessage(failure)); setEnabled(false)
    }, () => setStatus('Inquadra il codice e mantieni fermo il telefono.'))
    stopCamera.current = stop
    const pause = () => { stop(); setEnabled(false); setStatus('Fotocamera in pausa.') }
    const visibility = () => { if (document.visibilityState === 'hidden') pause() }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', pause)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', pause)
    }
  }, [enabled, present])
  useEffect(() => () => { ++requestId.current; stopCamera.current() }, [userId])
  const close = () => { ++requestId.current; stopCamera.current(); onClose() }
  const submit = (event: FormEvent) => { event.preventDefault(); void lookup(code) }

  return <Modal title="Scansiona codice a barre" onClose={close}>
    <div className="grid min-w-0 gap-4">
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video ref={video} autoPlay muted playsInline aria-label="Anteprima fotocamera posteriore" className={`h-52 w-full object-cover sm:h-64 ${!enabled ? 'invisible' : ''}`} />
        {enabled ? <div aria-hidden="true" className="pointer-events-none absolute inset-x-6 inset-y-12 rounded-xl border-2 border-white/80" /> : <div className="absolute inset-0 grid place-items-center text-white"><Barcode size={44} /></div>}
      </div>
      <p aria-live="polite" className="text-sm text-muted">{enabled ? status : searching ? 'Ricerca del materiale…' : 'Fotocamera ferma. Puoi riprendere la scansione o inserire il codice.'}</p>
      <Button type="button" variant="secondary" disabled={searching || enabled} onClick={() => {
        stopCamera.current(); setError(''); setUnknown(null); setArchived(null); setStatus('Avvio della fotocamera…'); setEnabled(true)
      }}><Camera size={17} /> {enabled ? 'Fotocamera attiva' : 'Riprendi scansione'}</Button>
      <form className="grid gap-3" onSubmit={submit}>
        <Field label="Codice a barre" hint="Puoi anche digitarlo o incollarlo. Gli zeri iniziali vengono conservati.">
          <Input value={code} maxLength={128} required autoComplete="off" autoCapitalize="off" spellCheck={false} onFocus={() => { stopCamera.current(); setEnabled(false) }} onChange={(event) => { setCode(event.target.value); setUnknown(null); setArchived(null) }} />
        </Field>
        <Button type="submit" loading={searching}>Cerca materiale</Button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      {archived && <div className="grid gap-3 rounded-xl border border-line p-4"><p className="break-words text-sm">Il codice appartiene a «{archived.name}», un materiale archiviato. Ripristinalo prima di registrare movimenti.</p><Button onClick={() => { stopCamera.current(); onArchived(archived) }}>Apri scheda e ripristina</Button></div>}
      {unknown && <div className="grid gap-3 rounded-xl border border-line bg-white p-4">
        <p className="break-words text-sm">Nessun materiale associato al codice <strong className="[overflow-wrap:anywhere]">{unknown}</strong>.</p>
        <Button onClick={() => { stopCamera.current(); onCreate(unknown) }}><Plus size={17} /> Registra nuovo materiale</Button>
      </div>}
      <p className="text-xs leading-5 text-muted">EAN-13, EAN-8, UPC e Code 128. La lettura cerca il materiale: nessun movimento viene registrato automaticamente.</p>
    </div>
  </Modal>
}
