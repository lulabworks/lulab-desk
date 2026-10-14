import { Boxes, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { formatDate, money, todayIso } from '../lib/format'
import { effectiveMaterialMovements, isMaterialMovementReversed, isPhase3Unavailable, movementCost } from '../lib/phase3'
import { readableError, supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { recordSuccessfulOperation } from '../lib/adaptive/usage'
import type { Material, MaterialMovement } from '../lib/types'
import { Button, EmptyState, Field, Input, Modal, ModalPresence, Notice, Panel, Select, Textarea } from './ui'

export function JobMaterialsPanel({ jobId }: { jobId: string }) {
  const { user } = useAuth()
  const [materials, setMaterials] = useState<Material[]>([])
  const [movements, setMovements] = useState<MaterialMovement[]>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ material_id: '', quantity: 1, occurred_on: todayIso(), notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)

  async function load() {
    if (!supabase) return
    const [materialResult, movementResult] = await Promise.all([
      supabase.from('materials').select('*').eq('is_active', true).order('name'),
      supabase.from('material_movements').select('*, material:materials(id,name,unit)').eq('job_id', jobId).order('occurred_on', { ascending: false }).order('created_at', { ascending: false })
    ])
    const firstError = materialResult.error || movementResult.error
    if (firstError) {
      setUnavailable(isPhase3Unavailable(firstError))
      if (!isPhase3Unavailable(firstError)) setError(readableError(firstError))
      return
    }
    setMaterials((materialResult.data ?? []) as Material[])
    setMovements((movementResult.data ?? []) as MaterialMovement[])
  }

  useEffect(() => { load() }, [jobId])

  const total = useMemo(
    () => effectiveMaterialMovements(movements)
      .filter((item) => item.movement_type === 'consumo_commessa')
      .reduce((sum, item) => sum + movementCost(item), 0),
    [movements]
  )

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const material = materials.find((item) => item.id === form.material_id)
    if (!material) return
    setSaving(true)
    const { error: addError } = await supabase.from('material_movements').insert({ material_id: material.id, movement_type: 'consumo_commessa', quantity_delta: -Math.abs(Number(form.quantity)), unit_cost_snapshot: Number(material.unit_price), occurred_on: form.occurred_on, job_id: jobId, notes: form.notes.trim() || null })
    setSaving(false)
    if (addError) return setError(readableError(addError))
    recordSuccessfulOperation(user?.id, 'materials.movement_created')
    setOpen(false)
    setForm({ material_id: '', quantity: 1, occurred_on: todayIso(), notes: '' })
    await load()
  }

  async function reverse(item: MaterialMovement) {
    if (!supabase || item.reversal_of_id || isMaterialMovementReversed(item, movements) || !window.confirm('Stornare questo consumo? Il record originale resterà nello storico.')) return
    const { error: reverseError } = await supabase.from('material_movements').insert({ material_id: item.material_id, movement_type: 'rettifica', quantity_delta: -Number(item.quantity_delta), unit_cost_snapshot: Number(item.unit_cost_snapshot), occurred_on: todayIso(), job_id: item.job_id, recovered_item_id: item.recovered_item_id, supplier_id: item.supplier_id, reversal_of_id: item.id, notes: `Storno consumo del ${formatDate(item.occurred_on)}` })
    if (reverseError) return setError(readableError(reverseError))
    recordSuccessfulOperation(user?.id, 'materials.movement_reversed')
    await load()
  }

  return (
    <Panel>
      <div className="mb-5 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="section-kicker">Magazzino</p>
          <h2 className="break-words type-panel-title">Materiali utilizzati</h2>
        </div>
        {!unavailable && <Button className="shrink-0" onClick={() => { setForm((current) => ({ ...current, material_id: materials[0]?.id ?? '' })); setOpen(true) }} disabled={!materials.length}><Plus size={17} /> Registra consumo</Button>}
      </div>

      {unavailable ? <Notice>Applica la migrazione <strong>003_phase3_management.sql</strong> per collegare i materiali.</Notice> : <>
        {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
        <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl bg-stone-50 p-4">
          <span className="min-w-0 text-sm font-semibold">Costo storico imputato</span>
          <strong className="ml-auto shrink-0 text-xl type-amount text-brand">{money.format(total)}</strong>
        </div>
        {movements.length === 0 ? <EmptyState icon={<Boxes size={22} />} title="Nessun materiale utilizzato" description="Il consumo scarica la giacenza e conserva il prezzo unitario del momento, senza creare una seconda spesa." /> : <div className="min-w-0 divide-y divide-line">
          {movements.map((item) => {
            const reversed = isMaterialMovementReversed(item, movements)
            return <div key={item.id} className={`flex min-w-0 items-center gap-3 py-3 ${item.reversal_of_id || reversed ? 'opacity-60' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{item.material?.name}{item.reversal_of_id ? ' · Storno' : reversed ? ' · Stornato' : ''}</p>
                <p className="break-words text-xs text-muted [overflow-wrap:anywhere]">{formatDate(item.occurred_on)} · {Math.abs(Number(item.quantity_delta))} {item.material?.unit} × {money.format(Number(item.unit_cost_snapshot))}</p>
              </div>
              <p className="shrink-0 text-sm font-semibold">{item.reversal_of_id ? '−' : ''}{money.format(movementCost(item))}</p>
              {!item.reversal_of_id && !reversed && <button onClick={() => void reverse(item)} className="grid size-8 shrink-0 place-items-center rounded-lg text-stone-400 hover:bg-amber-50 hover:text-amber-800" aria-label="Storna consumo"><RotateCcw size={15} /></button>}
            </div>
          })}
        </div>}
        <p className="mt-3 text-xs text-muted">I movimenti non si eliminano: gli errori vengono corretti con uno storno tracciato.</p>
      </>}

      <ModalPresence>{open && <Modal title="Registra consumo materiale" onClose={() => setOpen(false)}><form className="grid gap-4" onSubmit={add}><Field label="Materiale"><Select required value={form.material_id} onChange={(event) => setForm((current) => ({ ...current, material_id: event.target.value }))}>{materials.map((item) => <option key={item.id} value={item.id}>{item.name} · {Number(item.quantity_available)} {item.unit}</option>)}</Select></Field><Field label="Quantità"><Input required type="number" min="0.001" step="0.001" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: Number(event.target.value) }))} /></Field><Field label="Data"><Input required type="date" value={form.occurred_on} onChange={(event) => setForm((current) => ({ ...current, occurred_on: event.target.value }))} /></Field><Field label="Note"><Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></Field><Notice>Questo costo entra nel consuntivo della commessa separatamente dalle spese Fase 2, quindi non registrarlo anche come spesa materiali.</Notice><Button type="submit" loading={saving}>Registra e scarica</Button></form></Modal>}</ModalPresence>
    </Panel>
  )
}
