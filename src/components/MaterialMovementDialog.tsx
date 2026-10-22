import { ArrowDown, ArrowUp } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { buildMaterialMovement, type MaterialMovementDraft, type MaterialMovementInsert } from '../lib/materialMovement'
import { readableError, supabase } from '../lib/supabase'
import { MOVEMENT_TYPES, type Job, type Material, type MaterialMovementType, type RecoveredItem, type Supplier } from '../lib/types'
import { Button, Field, Input, Modal, Notice, Select, Textarea } from './ui'

const unitMoney = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 })

export function MaterialMovementDialog({ initial, scanned, materials, jobs, recoveries, suppliers, onSave, onClose }: {
  initial: MaterialMovementDraft
  scanned: boolean
  materials: Material[]
  jobs: Job[]
  recoveries: RecoveredItem[]
  suppliers: Supplier[]
  onSave: (payload: MaterialMovementInsert) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState(initial)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [review, setReview] = useState<{ material: Material; movement: ReturnType<typeof buildMaterialMovement> } | null>(null)
  const pending = useRef(false)
  const material = materials.find((item) => item.id === form.material_id)
  const outgoing = form.movement_type !== 'carico'
  const setType = (type: MaterialMovementType) => setForm((current) => ({ ...current, movement_type: type, job_id: '', recovered_item_id: '' }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!material || pending.current) return
    pending.current = true; setSaving(true); setError('')
    try {
      if (!supabase) throw new Error('Supabase non è disponibile.')
      // Refresh for both manual and scanned entries; SQL remains authoritative
      // if archiving or another movement occurs after this read.
      const { data, error: fetchError } = await supabase.from('materials').select('*').eq('id', material.id).single()
      if (fetchError) throw fetchError
      if (!data.is_active) throw new Error('Materiale archiviato: ripristinalo in Materiali prima di registrare movimenti o storni.')
      const currentMaterial = data as Material
      if (scanned) setReview({ material: currentMaterial, movement: buildMaterialMovement(form, currentMaterial, recoveries) })
      else await onSave(buildMaterialMovement(form, currentMaterial, recoveries).payload)
    } catch (failure) { setError(readableError(failure)) }
    finally { pending.current = false; setSaving(false) }
  }
  async function confirm() {
    if (!review || pending.current) return
    pending.current = true; setSaving(true); setError('')
    try { await onSave(review.movement.payload) }
    catch (failure) { setReview(null); setError(readableError(failure)) }
    finally { pending.current = false; setSaving(false) }
  }

  const target = review?.movement.payload.recovered_item_id
    ? recoveries.find((item) => item.id === review.movement.payload.recovered_item_id)?.name
    : jobs.find((job) => job.id === review?.movement.payload.job_id)?.title
  return <Modal title={review ? 'Conferma movimento' : scanned ? 'Materiale riconosciuto' : 'Nuovo movimento'} onClose={() => { if (!pending.current) onClose() }}>
    {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
    {review ? <div className="grid gap-4">
      <p className="break-words type-card-title">{review.material.name}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-white p-4 text-sm">
        <dt className="text-muted">Operazione</dt><dd className="text-right font-semibold">{review.movement.payload.quantity_delta > 0 ? 'Carico' : 'Scarico'}</dd>
        <dt className="text-muted">Quantità</dt><dd className="text-right">{Math.abs(review.movement.payload.quantity_delta)} {review.material.unit}</dd>
        <dt className="text-muted">Costo storico unitario</dt><dd className="text-right tabular-nums">{unitMoney.format(review.movement.payload.unit_cost_snapshot)}</dd>
        <dt className="text-muted">Giacenza attuale</dt><dd className="text-right">{Number(review.material.quantity_available)} {review.material.unit}</dd>
        <dt className="font-semibold">Giacenza risultante</dt><dd className="text-right font-semibold text-brand">{review.movement.resultingStock} {review.material.unit}</dd>
        {target && <><dt className="text-muted">Destinazione</dt><dd className="break-words text-right">{target}</dd></>}
      </dl>
      <p className="text-sm text-muted">Confermando registri un movimento nello storico. Eventuali errori potranno essere corretti con uno storno.</p>
      <div className="grid grid-cols-2 gap-3"><Button variant="secondary" disabled={saving} onClick={() => setReview(null)}>Modifica</Button><Button onClick={() => void confirm()} loading={saving}>Conferma</Button></div>
    </div> : <form className="grid gap-4" onSubmit={submit}>
      {scanned && material ? <div className="rounded-xl border border-line bg-white p-4">
        <p className="break-words type-card-title">{material.name}</p>
        <p className="mt-1 break-words text-xs text-muted">{material.barcode}</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted">Giacenza</dt><dd className="font-semibold">{Number(material.quantity_available)} {material.unit}</dd></div><div><dt className="text-muted">Prezzo unitario</dt><dd className="font-semibold tabular-nums">{unitMoney.format(Number(material.unit_price))}</dd></div></dl>
      </div> : <Field label="Materiale"><Select required value={form.material_id} onChange={(event) => {
        const selected = materials.find((item) => item.id === event.target.value)
        setForm((current) => ({ ...current, material_id: event.target.value, unit_cost: Number(selected?.unit_price ?? 0), supplier_id: selected?.supplier_id ?? '' }))
      }}>{materials.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name} · {Number(item.quantity_available)} {item.unit}</option>)}</Select></Field>}
      {scanned ? <>
        <div className="grid grid-cols-2 gap-3"><Button type="button" variant={!outgoing ? 'primary' : 'secondary'} aria-pressed={!outgoing} onClick={() => setType('carico')}><ArrowUp size={17} /> Carico</Button><Button type="button" variant={outgoing ? 'primary' : 'secondary'} aria-pressed={outgoing} onClick={() => setType('scarico')}><ArrowDown size={17} /> Scarico</Button></div>
        {outgoing && <Field label="Collega il consumo (facoltativo)"><Select value={form.movement_type} onChange={(event) => setType(event.target.value as MaterialMovementType)}><option value="scarico">Nessun collegamento</option><option value="consumo_commessa">Commessa</option><option value="consumo_recupero">Recupero</option></Select></Field>}
      </> : <Field label="Tipo"><Select value={form.movement_type} onChange={(event) => setType(event.target.value as MaterialMovementType)}>{MOVEMENT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>}
      <div className="grid grid-cols-2 gap-3">
        <Field label={`${form.movement_type === 'rettifica' ? 'Variazione (+/−)' : 'Quantità'} (${material?.unit ?? ''})`}><Input required type="number" inputMode="decimal" min={form.movement_type === 'rettifica' ? undefined : '0.001'} step="0.001" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: Number(event.target.value) }))} /></Field>
        <Field label="Costo unitario storico"><Input required type="number" inputMode="decimal" min="0" step="0.0001" value={form.unit_cost} onChange={(event) => setForm((current) => ({ ...current, unit_cost: Number(event.target.value) }))} /></Field>
      </div>
      {form.movement_type === 'consumo_commessa' && <Field label="Commessa"><Select required value={form.job_id} onChange={(event) => setForm((current) => ({ ...current, job_id: event.target.value }))}><option value="">Seleziona…</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.code} · {job.title}</option>)}</Select></Field>}
      {form.movement_type === 'consumo_recupero' && <Field label="Mobile recuperato"><Select required value={form.recovered_item_id} onChange={(event) => setForm((current) => ({ ...current, recovered_item_id: event.target.value }))}><option value="">Seleziona…</option>{recoveries.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}{item.job_id ? ' · Commessa collegata' : ''}</option>)}</Select><span className="text-xs font-normal text-muted">Se collegato a una commessa, il costo viene attribuito a quella commessa una sola volta.</span></Field>}
      {form.movement_type === 'carico' && <Field label="Fornitore"><Select value={form.supplier_id} onChange={(event) => setForm((current) => ({ ...current, supplier_id: event.target.value }))}><option value="">Nessuno</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>}
      <Field label="Data"><Input required type="date" value={form.occurred_on} onChange={(event) => setForm((current) => ({ ...current, occurred_on: event.target.value }))} /></Field>
      <Field label="Note"><Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></Field>
      <Notice>Il costo viene conservato nel movimento. I consumi collegati entrano nel consuntivo: non registrarli anche come spesa materiali.</Notice>
      <Button type="submit" loading={saving}>{scanned ? 'Verifica movimento' : 'Registra movimento'}</Button>
    </form>}
  </Modal>
}
