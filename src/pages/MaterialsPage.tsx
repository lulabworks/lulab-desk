import { AlertTriangle, ArrowDown, ArrowUp, Barcode, Boxes, History, PackagePlus, Pencil, Plus, RotateCcw, Search, Truck } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, EmptyState, Field, Input, Modal, ModalPresence, Notice, PageHeader, Panel, Select, Textarea } from '../components/ui'
import { MaterialLifecycleActions } from '../components/MaterialLifecycleActions'
import { MaterialBarcodeScanner } from '../components/MaterialBarcodeScanner'
import { MaterialMovementDialog } from '../components/MaterialMovementDialog'
import { normalizeBarcode } from '../lib/barcode'
import type { MaterialMovementInsert } from '../lib/materialMovement'
import { formatDate, money, todayIso } from '../lib/format'
import { isMaterialMovementReversed, isPhase3Unavailable, movementCost } from '../lib/phase3'
import { readableError, supabase } from '../lib/supabase'
import { MATERIAL_UNITS, MOVEMENT_TYPES, type Job, type Material, type MaterialCategory, type MaterialMovement, type MaterialMovementType, type RecoveredItem, type Supplier } from '../lib/types'
import { useAuth } from '../contexts/AuthContext'
import { recordSuccessfulOperation } from '../lib/adaptive/usage'

const blankMaterial = () => ({ name: '', code: '', barcode: '', category_id: '', supplier_id: '', unit: 'pz', unit_price: 0 as number | '', minimum_stock: 0, notes: '' })
const blankMovement = () => ({ material_id: '', movement_type: 'carico' as MaterialMovementType, quantity: 1, unit_cost: 0, occurred_on: todayIso(), job_id: '', recovered_item_id: '', supplier_id: '', notes: '' })

export function MaterialsPage() {
  const { user } = useAuth()
  const [materials, setMaterials] = useState<Material[]>([])
  const [categories, setCategories] = useState<MaterialCategory[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [movements, setMovements] = useState<MaterialMovement[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [recoveries, setRecoveries] = useState<RecoveredItem[]>([])
  const [query, setQuery] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [dialog, setDialog] = useState<'material' | 'movement' | 'scan' | 'category' | 'supplier' | null>(null)
  const [barcodesReady, setBarcodesReady] = useState(false)
  const [barcodeUnavailable, setBarcodeUnavailable] = useState(false)
  const [scannedMovement, setScannedMovement] = useState(false)
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
    const [materialResult, categoryResult, supplierResult, movementResult, jobResult, recoveryResult, barcodeProbe] = await Promise.all([
      supabase.from('materials').select('*, category:material_categories(id,name), supplier:suppliers(id,name)').order('name'),
      supabase.from('material_categories').select('*').order('name'),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('material_movements').select('*, material:materials(id,name,unit), job:jobs(id,code,title)').order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(200),
      supabase.from('jobs').select('*').order('created_at', { ascending: false }),
      supabase.from('recovered_items').select('*').eq('is_archived', false).order('updated_at', { ascending: false }),
      supabase.from('materials').select('barcode').limit(0)
    ])
    setBarcodesReady(!barcodeProbe.error)
    setBarcodeUnavailable(Boolean(barcodeProbe.error && isPhase3Unavailable(barcodeProbe.error)))
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

  const activeMaterials = materials.filter((item) => item.is_active)
  const archivedMaterials = materials.filter((item) => !item.is_active && `${item.name} ${item.code ?? ''} ${item.barcode ?? ''}`.toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it')))
  const filtered = useMemo(() => materials.filter((item) => {
    const matches = `${item.name} ${item.code ?? ''} ${item.barcode ?? ''} ${item.category?.name ?? ''} ${item.supplier?.name ?? ''}`.toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it'))
    return item.is_active && matches && (!lowOnly || Number(item.quantity_available) <= Number(item.minimum_stock))
  }), [lowOnly, materials, query])

  function openMaterial(item?: Material, barcode = '') {
    setError('')
    setEditing(item ?? null)
    setMaterialForm(item ? { name: item.name, code: item.code ?? '', barcode: item.barcode ?? '', category_id: item.category_id ?? '', supplier_id: item.supplier_id ?? '', unit: item.unit, unit_price: Number(item.unit_price), minimum_stock: Number(item.minimum_stock), notes: item.notes ?? '' } : { ...blankMaterial(), barcode, ...(barcode ? { unit: '', unit_price: '' as const } : {}) })
    setDialog('material')
  }
  function openMovement(item?: Material, type: MaterialMovementType = 'carico', scanned = false) {
    if (item && !item.is_active) { openMaterial(item); return }
    setScannedMovement(scanned)
    setMovementForm({ ...blankMovement(), material_id: item?.id ?? activeMaterials[0]?.id ?? '', movement_type: type, unit_cost: Number(item?.unit_price ?? 0), supplier_id: item?.supplier_id ?? '' })
    setDialog('movement')
  }

  async function saveMaterial(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    if (!materialForm.unit || materialForm.unit_price === '') { setError('Indica unità di misura e prezzo unitario.'); return }
    let barcode: string | null = null
    try { barcode = materialForm.barcode.trim() ? normalizeBarcode(materialForm.barcode) : null }
    catch (failure) { setError(readableError(failure)); return }
    setSaving(true); setError('')
    const payload = { name: materialForm.name.trim(), code: materialForm.code.trim() || null, ...(barcodesReady ? { barcode } : {}), category_id: materialForm.category_id || null, supplier_id: materialForm.supplier_id || null, unit: materialForm.unit, unit_price: Number(materialForm.unit_price), minimum_stock: Number(materialForm.minimum_stock), notes: materialForm.notes.trim() || null }
    const result = editing ? await supabase.from('materials').update(payload).eq('id', editing.id) : await supabase.from('materials').insert(payload)
    setSaving(false)
    if (result.error) return setError(result.error.code === '23505' ? 'Il codice interno o il codice a barre è già associato a un altro materiale del tuo archivio.' : readableError(result.error))
    recordSuccessfulOperation(user?.id, 'materials.saved')
    setDialog(null); setEditing(null); await load()
  }

  async function saveMovement(payload: MaterialMovementInsert) {
    if (!supabase) throw new Error('Supabase non è disponibile.')
    setError('')
    const { error: movementError } = await supabase.from('material_movements').insert(payload)
    if (!movementError && payload.movement_type === 'carico') {
      const { error: catalogError } = await supabase.from('materials').update({ unit_price: payload.unit_cost_snapshot, supplier_id: payload.supplier_id }).eq('id', payload.material_id)
      // The stock movement has already succeeded. Never invite a second insert
      // if only the optional catalog price update fails.
      if (catalogError) setError(`Movimento registrato; prezzo del catalogo non aggiornato: ${readableError(catalogError)}`)
    }
    if (movementError) throw new Error(readableError(movementError))
    recordSuccessfulOperation(user?.id, payload.movement_type === 'consumo_recupero' ? 'recovery.material_used' : 'materials.movement_created')
    setDialog(null); await load()
  }

  async function saveSimple(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !simpleName.trim() || !dialog) return
    setSaving(true)
    const result = dialog === 'category' ? await supabase.from('material_categories').insert({ name: simpleName.trim() }) : await supabase.from('suppliers').insert({ name: simpleName.trim(), phone: supplierContact.phone.trim() || null, email: supplierContact.email.trim() || null })
    setSaving(false)
    if (result.error) return setError(readableError(result.error))
    recordSuccessfulOperation(user?.id, dialog === 'category' ? 'materials.category_created' : 'materials.supplier_created')
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
    recordSuccessfulOperation(user?.id, 'materials.movement_reversed')
    await load()
  }

  return <div>
    <PageHeader eyebrow="Magazzino" title="Materiali" description="Catalogo, fornitori, giacenze e consumi con costo storico." action={!unavailable ? <div className="flex flex-wrap gap-2"><Button onClick={() => setDialog('scan')} disabled={!barcodesReady}><Barcode size={20} /> Scansiona</Button><Button variant="secondary" onClick={() => openMaterial()}><Plus size={17} /> Nuovo materiale</Button></div> : undefined} />
    {unavailable ? <Notice>Applica la migrazione <strong>003_phase3_management.sql</strong> per attivare il magazzino.</Notice> : <>
      {error && <div className="mb-5"><Notice tone="error">{error}</Notice></div>}
      {barcodeUnavailable && <div className="mb-5"><Notice>La scansione non è ancora attiva. Puoi continuare a gestire manualmente materiali e movimenti.</Notice></div>}
      <div className="mb-5 flex flex-wrap gap-2"><Button variant="secondary" onClick={() => openMovement()} disabled={!activeMaterials.length}><PackagePlus size={17} /> Movimento</Button><Button variant="secondary" onClick={() => setDialog('category')}><Boxes size={17} /> Categoria</Button><Button variant="secondary" onClick={() => setDialog('supplier')}><Truck size={17} /> Fornitore</Button></div>
      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto]"><div className="relative"><Search className="absolute left-3.5 top-3.5 text-stone-400" size={18} /><Input className="pl-10" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca materiale, codice, categoria…" /></div><button onClick={() => setLowOnly((value) => !value)} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold ${lowOnly ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-line bg-white text-muted'}`}><AlertTriangle size={17} /> Sotto scorta</button></div>
      {filtered.length === 0 ? <EmptyState icon={<Boxes size={23} />} title={materials.length ? 'Nessun materiale trovato' : 'Magazzino vuoto'} description={materials.length ? 'Modifica la ricerca o il filtro.' : 'Aggiungi il primo materiale e registra un carico iniziale.'} /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map((item) => { const low = Number(item.quantity_available) <= Number(item.minimum_stock); return <Panel key={item.id}><div className="flex items-start justify-between gap-3"><div className={`grid size-11 place-items-center rounded-xl ${low ? 'bg-amber-100 text-amber-900' : 'bg-brand-soft text-brand'}`}><Boxes size={20} /></div><button onClick={() => openMaterial(item)} className="grid size-9 place-items-center rounded-xl text-muted hover:bg-stone-100" aria-label="Modifica materiale"><Pencil size={16} /></button></div><p className="mt-4 text-xs font-semibold text-muted">{item.code || item.category?.name || 'Senza categoria'}</p><h2 className="mt-1 type-card-title">{item.name}</h2><div className="mt-4 grid grid-cols-2 gap-3"><div><p className="text-[13px] font-medium text-muted">Disponibile</p><p className={`mt-1 text-xl font-semibold ${low ? 'text-amber-800' : ''}`}>{Number(item.quantity_available)} {item.unit}</p></div><div><p className="text-[13px] font-medium text-muted">Prezzo unitario</p><p className="mt-1 text-xl font-semibold">{money.format(Number(item.unit_price))}</p></div></div><p className="mt-3 text-xs text-muted">Minimo {Number(item.minimum_stock)} {item.unit}{item.supplier?.name ? ` · ${item.supplier.name}` : ''}</p><div className="mt-4 grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => openMovement(item, 'carico')}><ArrowUp size={16} /> Carico</Button><Button variant="secondary" onClick={() => openMovement(item, 'scarico')}><ArrowDown size={16} /> Scarico</Button></div></Panel>})}</div>}
      <div className="mt-6"><Button variant="secondary" aria-expanded={showArchived} onClick={() => setShowArchived((value) => !value)}>{showArchived ? 'Nascondi archiviati' : 'Mostra archiviati'} ({materials.filter((item) => !item.is_active).length})</Button>{showArchived && <Panel className="mt-3"><h2 className="type-panel-title">Materiali archiviati</h2>{archivedMaterials.length === 0 ? <p className="mt-3 text-sm text-muted">Nessun materiale archiviato corrisponde alla ricerca.</p> : archivedMaterials.map((item) => <div key={item.id} className="flex min-w-0 items-center justify-between gap-3 border-b border-line py-3"><div className="min-w-0"><p className="break-words font-semibold">{item.name}</p><p className="text-sm text-muted">Archiviato · {Number(item.quantity_available)} {item.unit}</p></div><Button variant="secondary" onClick={() => openMaterial(item)}>Scheda e ripristino</Button></div>)}</Panel>}</div>
      <Panel className="mt-6"><div className="mb-4 flex items-center gap-3"><History className="text-brand" size={21} /><div><p className="section-kicker">Tracciabilità</p><h2 className="type-panel-title">Movimenti recenti</h2></div></div><Notice>Lo storico è permanente. Per correggere un errore registra uno storno: il movimento originale non viene eliminato.</Notice>{movements.length === 0 ? <EmptyState icon={<History size={22} />} title="Nessun movimento" description="I carichi, gli scarichi e i consumi compariranno qui." /> : <div className="mt-4 divide-y divide-line">{movements.map((item) => { const reversed = isMaterialMovementReversed(item, movements); return <div key={item.id} className={`flex items-center gap-3 py-3 ${item.reversal_of_id || reversed ? 'opacity-60' : ''}`}><div className={`grid size-9 place-items-center rounded-xl ${Number(item.quantity_delta) > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-800'}`}>{Number(item.quantity_delta) > 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.material?.name}</p><p className="truncate text-xs text-muted">{item.reversal_of_id ? 'Storno' : reversed ? 'Stornato' : MOVEMENT_TYPES.find((type) => type.value === item.movement_type)?.label} · {formatDate(item.occurred_on)}{item.job ? ` · ${item.job.code}` : ''}</p></div><div className="text-right"><p className="text-sm font-semibold">{Number(item.quantity_delta) > 0 ? '+' : ''}{Number(item.quantity_delta)} {item.material?.unit}</p><p className="text-xs text-muted">{money.format(movementCost(item))}</p></div>{!item.reversal_of_id && !reversed && <button onClick={() => void reverseMovement(item)} className="grid size-8 place-items-center rounded-lg text-stone-400 hover:bg-amber-50 hover:text-amber-800" aria-label="Storna movimento"><RotateCcw size={15} /></button>}</div>})}</div>}</Panel>
    </>}
    <ModalPresence>{dialog === 'material' && <Modal title={editing ? 'Modifica materiale' : 'Nuovo materiale'} onClose={() => setDialog(null)}><form className="grid gap-4" onSubmit={saveMaterial}>{error && <Notice tone="error">{error}</Notice>}<Field label="Nome"><Input required minLength={2} value={materialForm.name} onChange={(e) => setMaterialForm((f) => ({ ...f, name: e.target.value }))} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Codice interno"><Input value={materialForm.code} onChange={(e) => setMaterialForm((f) => ({ ...f, code: e.target.value }))} /></Field><Field label="Unità"><Select required value={materialForm.unit} onChange={(e) => setMaterialForm((f) => ({ ...f, unit: e.target.value }))}><option value="" disabled>Seleziona…</option>{MATERIAL_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</Select></Field></div>{barcodesReady && <Field label="Codice a barre commerciale" hint="Facoltativo. È distinto dal codice interno; conserva gli zeri iniziali."><Input maxLength={128} autoCapitalize="off" autoComplete="off" spellCheck={false} value={materialForm.barcode} onChange={(e) => setMaterialForm((f) => ({ ...f, barcode: e.target.value }))} /></Field>}<div className="grid grid-cols-2 gap-3"><Field label="Categoria"><Select value={materialForm.category_id} onChange={(e) => setMaterialForm((f) => ({ ...f, category_id: e.target.value }))}><option value="">Nessuna</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field><Field label="Fornitore"><Select value={materialForm.supplier_id} onChange={(e) => setMaterialForm((f) => ({ ...f, supplier_id: e.target.value }))}><option value="">Nessuno</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field></div><div className="grid grid-cols-2 gap-3"><Field label="Prezzo unitario"><Input required type="number" min="0" step="0.0001" value={materialForm.unit_price} onChange={(e) => setMaterialForm((f) => ({ ...f, unit_price: e.target.value === '' ? '' : Number(e.target.value) }))} /></Field><Field label="Scorta minima"><Input type="number" min="0" step="0.001" value={materialForm.minimum_stock} onChange={(e) => setMaterialForm((f) => ({ ...f, minimum_stock: Number(e.target.value) }))} /></Field></div><Field label="Note"><Textarea value={materialForm.notes} onChange={(e) => setMaterialForm((f) => ({ ...f, notes: e.target.value }))} /></Field><Button type="submit" loading={saving}>Salva materiale</Button></form>{editing && <MaterialLifecycleActions material={editing} onDone={async () => { setDialog(null); setEditing(null); await load() }} />}</Modal>}</ModalPresence>
    <ModalPresence>{dialog === 'scan' && user && <MaterialBarcodeScanner key={user.id} userId={user.id} onFound={(item) => { setMaterials((current) => [...current.filter((entry) => entry.id !== item.id), item]); openMovement(item, 'carico', true) }} onArchived={(item) => openMaterial(item)} onCreate={(barcode) => openMaterial(undefined, barcode)} onClose={() => setDialog(null)} />}</ModalPresence>
    <ModalPresence>{dialog === 'movement' && <MaterialMovementDialog initial={movementForm} scanned={scannedMovement} materials={activeMaterials} jobs={jobs} recoveries={recoveries} suppliers={suppliers} onSave={saveMovement} onClose={() => setDialog(null)} />}</ModalPresence>
    <ModalPresence>{(dialog === 'category' || dialog === 'supplier') && <Modal title={dialog === 'category' ? 'Nuova categoria' : 'Nuovo fornitore'} onClose={() => setDialog(null)}><form className="grid gap-4" onSubmit={saveSimple}><Field label="Nome"><Input required minLength={2} value={simpleName} onChange={(e) => setSimpleName(e.target.value)} /></Field>{dialog === 'supplier' && <><Field label="Telefono"><Input value={supplierContact.phone} onChange={(e) => setSupplierContact((f) => ({ ...f, phone: e.target.value }))} /></Field><Field label="Email"><Input type="email" value={supplierContact.email} onChange={(e) => setSupplierContact((f) => ({ ...f, email: e.target.value }))} /></Field></>}<Button type="submit" loading={saving}>Salva</Button></form></Modal>}</ModalPresence>
  </div>
}
