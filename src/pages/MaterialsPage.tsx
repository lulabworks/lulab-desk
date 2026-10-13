import { AlertTriangle, ArrowDown, ArrowUp, Boxes, History, PackagePlus, Pencil, Plus, RotateCcw, Search, Truck } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, EmptyState, Field, Input, Modal, ModalPresence, Notice, PageHeader, Panel, Select, Textarea } from '../components/ui'
import { formatDate, money, todayIso } from '../lib/format'
import { isMaterialMovementReversed, isPhase3Unavailable, movementCost } from '../lib/phase3'
import { readableError, supabase } from '../lib/supabase'
import { MATERIAL_UNITS, MOVEMENT_TYPES, type Job, type Material, type MaterialCategory, type MaterialMovement, type MaterialMovementType, type RecoveredItem, type Supplier } from '../lib/types'

const blankMaterial = () => ({ name: '', code: '', category_id: '', supplier_id: '', unit: 'pz', unit_price: 0, minimum_stock: 0, notes: '' })
const blankMovement = () => ({ material_id: '', movement_type: 'carico' as MaterialMovementType, quantity: 1, unit_cost: 0, occurred_on: todayIso(), job_id: '', recovered_item_id: '', supplier_id: '', notes: '' })

export function MaterialsPage() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [categories, setCategories] = useState<MaterialCategory[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [movements, setMovements] = useState<MaterialMovement[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [recoveries, setRecoveries] = useState<RecoveredItem[]>([])
  const [query, setQuery] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [dialog, setDialog] = useState<'material' | 'movement' | 'category' | 'supplier' | null>(null)
  const [editing, setEditing] = useState<Material | null>(null)
  const [materialForm, setMaterialForm] = useState(blankMaterial)
  const [movementForm, setMovementForm] = useState(blankMovement)
  const [simpleName, setSimpleName] = useState('')
  const [supplierContact, setSupplierContact] = useState({ phone: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)

  async function load() {
    if (!supabase) return
    const [materialResult, categoryResult, supplierResult, movementResult, jobResult, recoveryResult] = await Promise.all([
      supabase.from('materials').select('*, category:material_categories(id,name), supplier:suppliers(id,name)').order('name'),
      supabase.from('material_categories').select('*').order('name'),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('material_movements').select('*, material:materials(id,name,unit), job:jobs(id,code,title)').order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(200),
      supabase.from('jobs').select('*').order('created_at', { ascending: false }),
      supabase.from('recovered_items').select('*').eq('is_archived', false).order('updated_at', { ascending: false })
    ])
    const firstError = materialResult.error || categoryResult.error || supplierResult.error || movementResult.error || recoveryResult.error
    if (firstError) {
      setUnavailable(isPhase3Unavailable(firstError))
      if (!isPhase3Unavailable(firstError)) setError(readableError(firstError))
    } else {
      setMaterials((materialResult.data ?? []) as Material[])
      setCategories((categoryResult.data ?? []) as MaterialCategory[])
      setSuppliers((supplierResult.data ?? []) as Supplier[])
      setMovements((movementResult.data ?? []) as MaterialMovement[])
      setRecoveries((recoveryResult.data ?? []) as RecoveredItem[])
    }
    if (!jobResult.error) setJobs((jobResult.data ?? []) as Job[])
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => materials.filter((item) => {
    const matches = `${item.name} ${item.code ?? ''} ${item.category?.name ?? ''} ${item.supplier?.name ?? ''}`.toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it'))
    return matches && (!lowOnly || Number(item.quantity_available) <= Number(item.minimum_stock))
  }), [lowOnly, materials, query])

  function openMaterial(item?: Material) {
    setEditing(item ?? null)
    setMaterialForm(item ? { name: item.name, code: item.code ?? '', category_id: item.category_id ?? '', supplier_id: item.supplier_id ?? '', unit: item.unit, unit_price: Number(item.unit_price), minimum_stock: Number(item.minimum_stock), notes: item.notes ?? '' } : blankMaterial())
    setDialog('material')
  }
  function openMovement(item?: Material, type: MaterialMovementType = 'carico') {
    setMovementForm({ ...blankMovement(), material_id: item?.id ?? materials[0]?.id ?? '', movement_type: type, unit_cost: Number(item?.unit_price ?? 0), supplier_id: item?.supplier_id ?? '' })
    setDialog('movement')
  }

  async function saveMaterial(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setSaving(true); setError('')
    const payload = { name: materialForm.name.trim(), code: materialForm.code.trim() || null, category_id: materialForm.category_id || null, supplier_id: materialForm.supplier_id || null, unit: materialForm.unit, unit_price: Number(materialForm.unit_price), minimum_stock: Number(materialForm.minimum_stock), notes: materialForm.notes.trim() || null }
    const result = editing ? await supabase.from('materials').update(payload).eq('id', editing.id) : await supabase.from('materials').insert(payload)
    setSaving(false)
    if (result.error) return setError(readableError(result.error))
    setDialog(null); setEditing(null); await load()
  }

  async function saveMovement(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const negative = ['scarico', 'consumo_commessa', 'consumo_recupero'].includes(movementForm.movement_type)
    const delta = movementForm.movement_type === 'rettifica' ? Number(movementForm.quantity) : Math.abs(Number(movementForm.quantity)) * (negative ? -1 : 1)
    setSaving(true); setError('')
    const { error: movementError } = await supabase.from('material_movements').insert({ material_id: movementForm.material_id, movement_type: movementForm.movement_type, quantity_delta: delta, unit_cost_snapshot: Number(movementForm.unit_cost), occurred_on: movementForm.occurred_on, job_id: movementForm.movement_type === 'consumo_commessa' ? movementForm.job_id || null : null, recovered_item_id: movementForm.movement_type === 'consumo_recupero' ? movementForm.recovered_item_id || null : null, supplier_id: movementForm.movement_type === 'carico' ? movementForm.supplier_id || null : null, notes: movementForm.notes.trim() || null })
    if (!movementError && movementForm.movement_type === 'carico') await supabase.from('materials').update({ unit_price: Number(movementForm.unit_cost), supplier_id: movementForm.supplier_id || null }).eq('id', movementForm.material_id)
    setSaving(false)
    if (movementError) return setError(readableError(movementError))
    setDialog(null); await load()
  }

  async function saveSimple(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !simpleName.trim() || !dialog) return
    setSaving(true)
    const result = dialog === 'category' ? await supabase.from('material_categories').insert({ name: simpleName.trim() }) : await supabase.from('suppliers').insert({ name: simpleName.trim(), phone: supplierContact.phone.trim() || null, email: supplierContact.email.trim() || null })
    setSaving(false)
    if (result.error) return setError(readableError(result.error))
    setSimpleName(''); setSupplierContact({ phone: '', email: '' }); setDialog(null); await load()
  }

  async function reverseMovement(item: MaterialMovement) {
    if (!supabase || item.reversal_of_id || isMaterialMovementReversed(item, movements) || !window.confirm('Registrare uno storno? Il movimento originale resterà nello storico.')) return
    const { error: reverseError } = await supabase.from('material_movements').insert({
      material_id: item.material_id,
      movement_type: 'rettifica',
      quantity_delta: -Number(item.quantity_delta),
      unit_cost_snapshot: Number(item.unit_cost_snapshot),
      occurred_on: todayIso(),
      job_id: item.job_id,
      recovered_item_id: item.recovered_item_id,
      supplier_id: item.supplier_id,
      reversal_of_id: item.id,
      notes: `Storno del movimento del ${formatDate(item.occurred_on)}`
    })
    if (reverseError) return setError(readableError(reverseError))
    await load()
  }

  return <div>
    <PageHeader eyebrow="Magazzino" title="Materiali" description="Catalogo, fornitori, giacenze e consumi con costo storico." action={!unavailable ? <Button onClick={() => openMaterial()}><Plus size={17} /> Nuovo materiale</Button> : undefined} />
    {unavailable ? <Notice>Applica la migrazione <strong>003_phase3_management.sql</strong> per attivare il magazzino.</Notice> : <>
      {error && <div className="mb-5"><Notice tone="error">{error}</Notice></div>}
      <div className="mb-5 flex flex-wrap gap-2"><Button variant="secondary" onClick={() => openMovement()} disabled={!materials.length}><PackagePlus size={17} /> Movimento</Button><Button variant="secondary" onClick={() => setDialog('category')}><Boxes size={17} /> Categoria</Button><Button variant="secondary" onClick={() => setDialog('supplier')}><Truck size={17} /> Fornitore</Button></div>
      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto]"><div className="relative"><Search className="absolute left-3.5 top-3.5 text-stone-400" size={18} /><Input className="pl-10" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca materiale, codice, categoria…" /></div><button onClick={() => setLowOnly((value) => !value)} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold ${lowOnly ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-line bg-white text-muted'}`}><AlertTriangle size={17} /> Sotto scorta</button></div>
      {filtered.length === 0 ? <EmptyState icon={<Boxes size={23} />} title={materials.length ? 'Nessun materiale trovato' : 'Magazzino vuoto'} description={materials.length ? 'Modifica la ricerca o il filtro.' : 'Aggiungi il primo materiale e registra un carico iniziale.'} /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map((item) => { const low = Number(item.quantity_available) <= Number(item.minimum_stock); return <Panel key={item.id}><div className="flex items-start justify-between gap-3"><div className={`grid size-11 place-items-center rounded-xl ${low ? 'bg-amber-100 text-amber-900' : 'bg-brand-soft text-brand'}`}><Boxes size={20} /></div><button onClick={() => openMaterial(item)} className="grid size-9 place-items-center rounded-xl text-muted hover:bg-stone-100" aria-label="Modifica materiale"><Pencil size={16} /></button></div><p className="mt-4 text-xs font-semibold text-muted">{item.code || item.category?.name || 'Senza categoria'}</p><h2 className="mt-1 type-card-title">{item.name}</h2><div className="mt-4 grid grid-cols-2 gap-3"><div><p className="text-[13px] font-medium text-muted">Disponibile</p><p className={`mt-1 text-xl font-semibold ${low ? 'text-amber-800' : ''}`}>{Number(item.quantity_available)} {item.unit}</p></div><div><p className="text-[13px] font-medium text-muted">Prezzo unitario</p><p className="mt-1 text-xl font-semibold">{money.format(Number(item.unit_price))}</p></div></div><p className="mt-3 text-xs text-muted">Minimo {Number(item.minimum_stock)} {item.unit}{item.supplier?.name ? ` · ${item.supplier.name}` : ''}</p><div className="mt-4 grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => openMovement(item, 'carico')}><ArrowUp size={16} /> Carico</Button><Button variant="secondary" onClick={() => openMovement(item, 'scarico')}><ArrowDown size={16} /> Scarico</Button></div></Panel>})}</div>}
      <Panel className="mt-6"><div className="mb-4 flex items-center gap-3"><History className="text-brand" size={21} /><div><p className="section-kicker">Tracciabilità</p><h2 className="type-panel-title">Movimenti recenti</h2></div></div><Notice>Lo storico è permanente. Per correggere un errore registra uno storno: il movimento originale non viene eliminato.</Notice>{movements.length === 0 ? <EmptyState icon={<History size={22} />} title="Nessun movimento" description="I carichi, gli scarichi e i consumi compariranno qui." /> : <div className="mt-4 divide-y divide-line">{movements.map((item) => { const reversed = isMaterialMovementReversed(item, movements); return <div key={item.id} className={`flex items-center gap-3 py-3 ${item.reversal_of_id || reversed ? 'opacity-60' : ''}`}><div className={`grid size-9 place-items-center rounded-xl ${Number(item.quantity_delta) > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-800'}`}>{Number(item.quantity_delta) > 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.material?.name}</p><p className="truncate text-xs text-muted">{item.reversal_of_id ? 'Storno' : reversed ? 'Stornato' : MOVEMENT_TYPES.find((type) => type.value === item.movement_type)?.label} · {formatDate(item.occurred_on)}{item.job ? ` · ${item.job.code}` : ''}</p></div><div className="text-right"><p className="text-sm font-semibold">{Number(item.quantity_delta) > 0 ? '+' : ''}{Number(item.quantity_delta)} {item.material?.unit}</p><p className="text-xs text-muted">{money.format(movementCost(item))}</p></div>{!item.reversal_of_id && !reversed && <button onClick={() => void reverseMovement(item)} className="grid size-8 place-items-center rounded-lg text-stone-400 hover:bg-amber-50 hover:text-amber-800" aria-label="Storna movimento"><RotateCcw size={15} /></button>}</div>})}</div>}</Panel>
    </>}
    <ModalPresence>{dialog === 'material' && <Modal title={editing ? 'Modifica materiale' : 'Nuovo materiale'} onClose={() => setDialog(null)}><form className="grid gap-4" onSubmit={saveMaterial}><Field label="Nome"><Input required minLength={2} value={materialForm.name} onChange={(e) => setMaterialForm((f) => ({ ...f, name: e.target.value }))} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Codice"><Input value={materialForm.code} onChange={(e) => setMaterialForm((f) => ({ ...f, code: e.target.value }))} /></Field><Field label="Unità"><Select value={materialForm.unit} onChange={(e) => setMaterialForm((f) => ({ ...f, unit: e.target.value }))}>{MATERIAL_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</Select></Field></div><div className="grid grid-cols-2 gap-3"><Field label="Categoria"><Select value={materialForm.category_id} onChange={(e) => setMaterialForm((f) => ({ ...f, category_id: e.target.value }))}><option value="">Nessuna</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field><Field label="Fornitore"><Select value={materialForm.supplier_id} onChange={(e) => setMaterialForm((f) => ({ ...f, supplier_id: e.target.value }))}><option value="">Nessuno</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field></div><div className="grid grid-cols-2 gap-3"><Field label="Prezzo unitario"><Input type="number" min="0" step="0.0001" value={materialForm.unit_price} onChange={(e) => setMaterialForm((f) => ({ ...f, unit_price: Number(e.target.value) }))} /></Field><Field label="Scorta minima"><Input type="number" min="0" step="0.001" value={materialForm.minimum_stock} onChange={(e) => setMaterialForm((f) => ({ ...f, minimum_stock: Number(e.target.value) }))} /></Field></div><Field label="Note"><Textarea value={materialForm.notes} onChange={(e) => setMaterialForm((f) => ({ ...f, notes: e.target.value }))} /></Field><Button type="submit" loading={saving}>Salva materiale</Button></form></Modal>}</ModalPresence>
    <ModalPresence>{dialog === 'movement' && <Modal title="Nuovo movimento" onClose={() => setDialog(null)}><form className="grid gap-4" onSubmit={saveMovement}><Field label="Materiale"><Select required value={movementForm.material_id} onChange={(e) => { const item = materials.find((m) => m.id === e.target.value); setMovementForm((f) => ({ ...f, material_id: e.target.value, unit_cost: Number(item?.unit_price ?? 0), supplier_id: item?.supplier_id ?? '' })) }}>{materials.map((item) => <option key={item.id} value={item.id}>{item.name} · {Number(item.quantity_available)} {item.unit}</option>)}</Select></Field><Field label="Tipo"><Select value={movementForm.movement_type} onChange={(e) => setMovementForm((f) => ({ ...f, movement_type: e.target.value as MaterialMovementType, job_id: '', recovered_item_id: '' }))}>{MOVEMENT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field><div className="grid grid-cols-2 gap-3"><Field label={movementForm.movement_type === 'rettifica' ? 'Variazione (+/−)' : 'Quantità'}><Input required type="number" min={movementForm.movement_type === 'rettifica' ? undefined : '0.001'} step="0.001" value={movementForm.quantity} onChange={(e) => setMovementForm((f) => ({ ...f, quantity: Number(e.target.value) }))} /></Field><Field label="Costo unitario storico"><Input required type="number" min="0" step="0.0001" value={movementForm.unit_cost} onChange={(e) => setMovementForm((f) => ({ ...f, unit_cost: Number(e.target.value) }))} /></Field></div>{movementForm.movement_type === 'consumo_commessa' && <Field label="Commessa"><Select required value={movementForm.job_id} onChange={(e) => setMovementForm((f) => ({ ...f, job_id: e.target.value }))}><option value="">Seleziona…</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.code} · {job.title}</option>)}</Select></Field>}{movementForm.movement_type === 'consumo_recupero' && <Field label="Mobile recuperato"><Select required value={movementForm.recovered_item_id} onChange={(e) => setMovementForm((f) => ({ ...f, recovered_item_id: e.target.value }))}><option value="">Seleziona…</option>{recoveries.filter((item) => !item.job_id).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</Select></Field>}{movementForm.movement_type === 'carico' && <Field label="Fornitore"><Select value={movementForm.supplier_id} onChange={(e) => setMovementForm((f) => ({ ...f, supplier_id: e.target.value }))}><option value="">Nessuno</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>}<Field label="Data"><Input required type="date" value={movementForm.occurred_on} onChange={(e) => setMovementForm((f) => ({ ...f, occurred_on: e.target.value }))} /></Field><Field label="Note"><Textarea value={movementForm.notes} onChange={(e) => setMovementForm((f) => ({ ...f, notes: e.target.value }))} /></Field><Notice>Il costo unitario viene copiato nel movimento: successive modifiche al catalogo non cambieranno il costo storico.</Notice><Button type="submit" loading={saving}>Registra movimento</Button></form></Modal>}</ModalPresence>
    <ModalPresence>{(dialog === 'category' || dialog === 'supplier') && <Modal title={dialog === 'category' ? 'Nuova categoria' : 'Nuovo fornitore'} onClose={() => setDialog(null)}><form className="grid gap-4" onSubmit={saveSimple}><Field label="Nome"><Input required minLength={2} value={simpleName} onChange={(e) => setSimpleName(e.target.value)} /></Field>{dialog === 'supplier' && <><Field label="Telefono"><Input value={supplierContact.phone} onChange={(e) => setSupplierContact((f) => ({ ...f, phone: e.target.value }))} /></Field><Field label="Email"><Input type="email" value={supplierContact.email} onChange={(e) => setSupplierContact((f) => ({ ...f, email: e.target.value }))} /></Field></>}<Button type="submit" loading={saving}>Salva</Button></form></Modal>}</ModalPresence>
  </div>
}
