import { Archive, ArrowLeft, Camera, Clock3, ExternalLink, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Button, EmptyState, Field, Input, Modal, ModalPresence, Notice, Panel, Select, Textarea } from '../components/ui'
import { sharedElementSpring } from '../lib/animations'
import { formatDate, money, todayIso } from '../lib/format'
import { isMaterialMovementReversed, movementCost, recoveryEconomics } from '../lib/phase3'
import { readableError, supabase } from '../lib/supabase'
import { RECOVERY_STATUSES, type Job, type JobExpense, type Material, type MaterialMovement, type RecoveredItem, type RecoveredItemFile, type RecoveredItemStatus, type RecoveryExpense, type RecoveryTimeEntry, type TimeEntry } from '../lib/types'

export function RecoveryDetailPage() {
  const reduceMotion = useReducedMotion()
  const { id } = useParams(); const location = useLocation(); const navigate = useNavigate(); const { user } = useAuth()
  const [item, setItem] = useState<RecoveredItem | null>(null)
  const [jobs, setJobs] = useState<Job[]>([]); const [files, setFiles] = useState<RecoveredItemFile[]>([]); const [materials, setMaterials] = useState<Material[]>([]); const [movements, setMovements] = useState<MaterialMovement[]>([])
  const [times, setTimes] = useState<RecoveryTimeEntry[]>([]); const [expenses, setExpenses] = useState<RecoveryExpense[]>([])
  const [jobTimes, setJobTimes] = useState<TimeEntry[]>([]); const [jobExpenses, setJobExpenses] = useState<JobExpense[]>([])
  const [dialog, setDialog] = useState<'material' | 'time' | 'expense' | null>(null)
  const [materialForm, setMaterialForm] = useState({ material_id: '', quantity: 1, occurred_on: todayIso() })
  const [timeForm, setTimeForm] = useState({ work_date: todayIso(), hours: 1, minutes: 0, hourly_rate: 35, notes: '' })
  const [expenseForm, setExpenseForm] = useState({ description: '', amount: 0, incurred_on: todayIso(), supplier: '' })
  const [saving, setSaving] = useState(false); const [error, setError] = useState('')

  async function load() {
    if (!supabase || !id) return
    const [itemResult, jobsResult, filesResult, materialsResult, movementsResult, timesResult, expensesResult, settingsResult] = await Promise.all([
      supabase.from('recovered_items').select('*, job:jobs(id,code,title,agreed_revenue)').eq('id', id).single(), supabase.from('jobs').select('*').order('created_at', { ascending: false }), supabase.from('recovered_item_files').select('*').eq('recovered_item_id', id).order('created_at', { ascending: false }), supabase.from('materials').select('*').eq('is_active', true).order('name'), supabase.from('material_movements').select('*, material:materials(id,name,unit)').eq('recovered_item_id', id).order('occurred_on', { ascending: false }), supabase.from('recovery_time_entries').select('*').eq('recovered_item_id', id).order('work_date', { ascending: false }), supabase.from('recovery_expenses').select('*').eq('recovered_item_id', id).order('incurred_on', { ascending: false }), supabase.from('user_settings').select('hourly_rate').single()
    ])
    const firstError = itemResult.error || filesResult.error || materialsResult.error || movementsResult.error || timesResult.error || expensesResult.error
    if (firstError) return setError(readableError(firstError))
    const loaded = itemResult.data as RecoveredItem
    setItem(loaded); setJobs((jobsResult.data ?? []) as Job[]); setMaterials((materialsResult.data ?? []) as Material[]); setMovements((movementsResult.data ?? []) as MaterialMovement[]); setTimes((timesResult.data ?? []) as RecoveryTimeEntry[]); setExpenses((expensesResult.data ?? []) as RecoveryExpense[])
    setTimeForm((form) => ({ ...form, hourly_rate: Number(settingsResult.data?.hourly_rate ?? 35) }))
    const signed = await Promise.all(((filesResult.data ?? []) as RecoveredItemFile[]).map(async (file) => ({ ...file, signed_url: (await supabase!.storage.from('job-files').createSignedUrl(file.storage_path, 3600)).data?.signedUrl })))
    setFiles(signed)
    if (loaded.job_id) {
      const [jobTimeResult, jobExpenseResult] = await Promise.all([supabase.from('time_entries').select('*').eq('job_id', loaded.job_id), supabase.from('job_expenses').select('*').eq('job_id', loaded.job_id)])
      setJobTimes((jobTimeResult.data ?? []) as TimeEntry[]); setJobExpenses((jobExpenseResult.data ?? []) as JobExpense[])
    } else { setJobTimes([]); setJobExpenses([]) }
  }
  useEffect(() => { load() }, [id])

  const effectiveTimes = item?.job_id ? jobTimes.map((entry) => ({ ...entry, recovered_item_id: item.id })) as RecoveryTimeEntry[] : times
  const effectiveExpenses = item?.job_id ? jobExpenses.map((entry) => ({ ...entry, recovered_item_id: item.id })) as RecoveryExpense[] : expenses
  const economics = useMemo(() => item ? recoveryEconomics({ acquisitionCost: Number(item.acquisition_cost), expectedSalePrice: Number(item.expected_sale_price), actualSalePrice: item.actual_sale_price === null ? null : Number(item.actual_sale_price), sold: item.status === 'venduto', expenses: effectiveExpenses, timeEntries: effectiveTimes, materialMovements: movements }) : null, [effectiveExpenses, effectiveTimes, item, movements])
  function setField<K extends keyof RecoveredItem>(key: K, value: RecoveredItem[K]) { setItem((current) => current ? { ...current, [key]: value } : current) }

  async function save() {
    if (!supabase || !item) return
    setSaving(true); setError('')
    const { error: saveError } = await supabase.from('recovered_items').update({ job_id: item.job_id || null, name: item.name, description: item.description || null, origin: item.origin || null, acquired_on: item.acquired_on, acquisition_cost: Number(item.acquisition_cost), initial_condition: item.initial_condition || null, required_work: item.required_work || null, expected_sale_price: Number(item.expected_sale_price), actual_sale_price: item.actual_sale_price === null ? null : Number(item.actual_sale_price), sold_on: item.sold_on || null, status: item.status, location: item.location || null }).eq('id', item.id)
    setSaving(false)
    if (saveError) return setError(readableError(saveError))
    await load()
  }
  async function upload(list: FileList | null) {
    const file = list?.[0]; if (!file || !supabase || !user || !item) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) return setError('Usa una foto JPG, PNG o WebP fino a 15 MB.')
    setSaving(true); const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '-'); const path = `${user.id}/recoveries/${item.id}/${crypto.randomUUID()}-${safe}`
    const { error: storageError } = await supabase.storage.from('job-files').upload(path, file, { contentType: file.type })
    if (storageError) { setSaving(false); return setError(readableError(storageError)) }
    const { error: dbError } = await supabase.from('recovered_item_files').insert({ recovered_item_id: item.id, storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size })
    if (dbError) { await supabase.storage.from('job-files').remove([path]); setSaving(false); return setError(readableError(dbError)) }
    setSaving(false); await load()
  }
  async function addMaterial(event: FormEvent) {
    event.preventDefault(); if (!supabase || !item) return; const material = materials.find((entry) => entry.id === materialForm.material_id); if (!material) return
    setSaving(true); const { error: addError } = await supabase.from('material_movements').insert({ material_id: material.id, movement_type: item.job_id ? 'consumo_commessa' : 'consumo_recupero', quantity_delta: -Math.abs(Number(materialForm.quantity)), unit_cost_snapshot: Number(material.unit_price), occurred_on: materialForm.occurred_on, job_id: item.job_id, recovered_item_id: item.id })
    setSaving(false); if (addError) return setError(readableError(addError)); setDialog(null); await load()
  }
  async function addTime(event: FormEvent) {
    event.preventDefault(); if (!supabase || !item) return; const duration = Number(timeForm.hours) * 60 + Number(timeForm.minutes); setSaving(true)
    const { error: addError } = await supabase.from('recovery_time_entries').insert({ recovered_item_id: item.id, work_date: timeForm.work_date, duration_minutes: duration, hourly_rate: Number(timeForm.hourly_rate), notes: timeForm.notes.trim() || null })
    setSaving(false); if (addError) return setError(readableError(addError)); setDialog(null); await load()
  }
  async function addExpense(event: FormEvent) {
    event.preventDefault(); if (!supabase || !item) return; setSaving(true)
    const { error: addError } = await supabase.from('recovery_expenses').insert({ recovered_item_id: item.id, description: expenseForm.description.trim(), amount: Number(expenseForm.amount), incurred_on: expenseForm.incurred_on, supplier: expenseForm.supplier.trim() || null })
    setSaving(false); if (addError) return setError(readableError(addError)); setDialog(null); await load()
  }
  async function removePhoto(file: RecoveredItemFile) {
    if (!supabase || !window.confirm('Eliminare questa fotografia?')) return
    setSaving(true); setError('')
    const { error: dbError } = await supabase.from('recovered_item_files').delete().eq('id', file.id)
    if (!dbError) await supabase.storage.from('job-files').remove([file.storage_path])
    setSaving(false)
    if (dbError) return setError(readableError(dbError))
    await load()
  }
  async function removeRecord(table: 'recovery_time_entries' | 'recovery_expenses', recordId: string) {
    if (!supabase || !window.confirm('Eliminare questa registrazione?')) return
    setSaving(true); setError('')
    const { error: removeError } = await supabase.from(table).delete().eq('id', recordId)
    setSaving(false)
    if (removeError) return setError(readableError(removeError))
    await load()
  }
  async function reverseMovement(movement: MaterialMovement) {
    if (!supabase || movement.reversal_of_id || isMaterialMovementReversed(movement, movements) || !window.confirm('Stornare questo consumo? Il movimento originale resterà nello storico.')) return
    setSaving(true); setError('')
    const { error: reverseError } = await supabase.from('material_movements').insert({ material_id: movement.material_id, movement_type: 'rettifica', quantity_delta: -Number(movement.quantity_delta), unit_cost_snapshot: Number(movement.unit_cost_snapshot), occurred_on: todayIso(), job_id: movement.job_id, recovered_item_id: movement.recovered_item_id, supplier_id: movement.supplier_id, reversal_of_id: movement.id, notes: `Storno consumo del ${formatDate(movement.occurred_on)}` })
    setSaving(false)
    if (reverseError) return setError(readableError(reverseError))
    await load()
  }
  async function archive() { if (!supabase || !item) return; const next = !item.is_archived; if (!window.confirm(next ? 'Archiviare questa scheda? Lo storico e i movimenti resteranno conservati.' : 'Ripristinare questa scheda tra i recuperi attivi?')) return; const { error: archiveError } = await supabase.from('recovered_items').update({ is_archived: next }).eq('id', item.id); if (archiveError) return setError(readableError(archiveError)); navigate('/recuperi', { replace: true }) }

  if (!item || !economics) { const sharedTitle = (location.state as { sharedTitle?: string } | null)?.sharedTitle; return <div>{error ? <Notice tone="error">{error}</Notice> : <>{sharedTitle && <motion.h1 layoutId={reduceMotion || !id ? undefined : `recovery-title-${id}`} transition={sharedElementSpring} className="mb-5 type-page-title">{sharedTitle}</motion.h1>}<div className="h-80 animate-pulse rounded-2xl bg-white" /></>}</div> }
  return <div><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><Link to="/recuperi" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand"><ArrowLeft size={18} /> Tutti i recuperi</Link><Button onClick={save} loading={saving}><Save size={17} /> Salva</Button></div>{error && <div className="mb-5"><Notice tone="error">{error}</Notice></div>}<header className="mb-6"><p className="type-meta tabular-nums text-muted">{item.code}</p><motion.h1 layoutId={reduceMotion ? undefined : `recovery-title-${item.id}`} transition={sharedElementSpring} className="mt-2 type-page-title">{item.name}</motion.h1></header><div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]"><div className="grid gap-6"><Panel><div className="grid gap-4 sm:grid-cols-2"><Field label="Nome"><Input value={item.name} onChange={(e) => setField('name', e.target.value)} /></Field><Field label="Stato"><Select value={item.status} onChange={(e) => setField('status', e.target.value as RecoveredItemStatus)}>{RECOVERY_STATUSES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</Select></Field><Field label="Provenienza"><Input value={item.origin ?? ''} onChange={(e) => setField('origin', e.target.value || null)} /></Field><Field label="Posizione in laboratorio"><Input value={item.location ?? ''} onChange={(e) => setField('location', e.target.value || null)} /></Field><Field label="Data acquisizione"><Input type="date" value={item.acquired_on} onChange={(e) => setField('acquired_on', e.target.value)} /></Field><Field label="Costo acquisizione"><Input type="number" min="0" step="0.01" value={item.acquisition_cost} onChange={(e) => setField('acquisition_cost', Number(e.target.value))} /></Field><Field label="Prezzo previsto"><Input type="number" min="0" step="0.01" value={item.expected_sale_price} onChange={(e) => setField('expected_sale_price', Number(e.target.value))} /></Field><Field label="Commessa collegata"><Select value={item.job_id ?? ''} onChange={(e) => setField('job_id', e.target.value || null)}><option value="">Gestione autonoma</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.code} · {job.title}</option>)}</Select></Field><Field label="Prezzo effettivo"><Input type="number" min="0" step="0.01" value={item.actual_sale_price ?? ''} onChange={(e) => setField('actual_sale_price', e.target.value ? Number(e.target.value) : null)} /></Field><Field label="Data vendita"><Input type="date" value={item.sold_on ?? ''} onChange={(e) => setField('sold_on', e.target.value || null)} /></Field></div><div className="mt-4 grid gap-4"><Field label="Descrizione"><Textarea value={item.description ?? ''} onChange={(e) => setField('description', e.target.value || null)} /></Field><Field label="Condizioni iniziali"><Textarea value={item.initial_condition ?? ''} onChange={(e) => setField('initial_condition', e.target.value || null)} /></Field><Field label="Lavorazioni necessarie"><Textarea value={item.required_work ?? ''} onChange={(e) => setField('required_work', e.target.value || null)} /></Field></div></Panel><Panel><div className="mb-4 flex items-center justify-between"><div><p className="section-kicker">Immagini</p><h2 className="type-panel-title">Fotografie</h2></div><label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white"><Camera size={17} /> Carica<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => { void upload(e.target.files); e.target.value = '' }} /></label></div>{files.length === 0 ? <EmptyState icon={<Camera size={22} />} title="Nessuna fotografia" description="Carica le immagini dello stato iniziale e del mobile restaurato." /> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{files.map((file) => <div key={file.id} className="group relative aspect-square overflow-hidden rounded-xl bg-stone-100"><a href={file.signed_url} target="_blank" rel="noreferrer"><img src={file.signed_url} alt={file.file_name} className="h-full w-full object-cover" /><ExternalLink className="absolute right-2 top-2 rounded-lg bg-white/85 p-1.5 text-brand" size={28} /></a><button type="button" onClick={() => void removePhoto(file)} className="absolute bottom-2 right-2 grid size-9 place-items-center rounded-lg bg-white/90 text-red-700 shadow" aria-label={`Elimina ${file.file_name}`}><Trash2 size={16} /></button></div>)}</div>}</Panel></div><div className="grid content-start gap-6"><Panel><p className="section-kicker">Economia recupero</p><h2 className="type-panel-title">Costo e margine</h2><div className="mt-4 space-y-2 text-sm"><Row label="Acquisizione" value={Number(item.acquisition_cost)} /><Row label="Materiali" value={economics.materialsCost} /><Row label="Altre spese" value={economics.expenseCost} /><Row label="Valore ore" value={economics.laborCost} /><Row label="Costo complessivo" value={economics.totalCost} strong /><Row label={item.status === 'venduto' ? 'Ricavo vendita' : 'Ricavo previsto'} value={economics.revenue} /><Row label="Margine" value={economics.margin} strong /></div></Panel>{item.job_id ? <Panel><Notice>Ore e spese provengono dalla <Link className="font-semibold underline" to={`/lavori/${item.job_id}`}>commessa collegata</Link>. Non vengono duplicate nella scheda recupero.</Notice><p className="mt-3 text-sm text-muted">{jobTimes.length} registrazioni orarie · {jobExpenses.length} spese</p></Panel> : <Panel><div className="grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => setDialog('time')}><Clock3 size={16} /> Ore</Button><Button variant="secondary" onClick={() => setDialog('expense')}><Plus size={16} /> Spesa</Button></div><div className="mt-4 divide-y divide-line">{times.map((entry) => <MiniRecord key={entry.id} title={`${(Number(entry.duration_minutes) / 60).toFixed(1)} ore · ${money.format(Number(entry.hourly_rate))}/h`} detail={formatDate(entry.work_date)} onRemove={() => void removeRecord('recovery_time_entries', entry.id)} />)}{expenses.map((entry) => <MiniRecord key={entry.id} title={entry.description} detail={`${formatDate(entry.incurred_on)} · ${money.format(Number(entry.amount))}`} onRemove={() => void removeRecord('recovery_expenses', entry.id)} />)}{times.length + expenses.length === 0 && <p className="py-3 text-xs text-muted">Nessuna ora o spesa autonoma registrata.</p>}</div></Panel>}<Panel><Button className="w-full" variant="secondary" onClick={() => { setMaterialForm((f) => ({ ...f, material_id: materials[0]?.id ?? '' })); setDialog('material') }} disabled={!materials.length}><Plus size={16} /> Materiale utilizzato</Button><div className="mt-4 divide-y divide-line">{movements.map((entry) => { const reversed = isMaterialMovementReversed(entry, movements); return <MiniRecord key={entry.id} title={`${entry.material?.name ?? 'Materiale'} · ${Math.abs(Number(entry.quantity_delta))} ${entry.material?.unit ?? ''}${entry.reversal_of_id ? ' · Storno' : reversed ? ' · Stornato' : ''}`} detail={`${formatDate(entry.occurred_on)} · ${money.format(movementCost(entry))}`} onRemove={!entry.reversal_of_id && !reversed ? () => void reverseMovement(entry) : undefined} action="reverse" muted={Boolean(entry.reversal_of_id || reversed)} />})}{movements.length === 0 && <p className="py-3 text-xs text-muted">Nessun consumo registrato.</p>}</div><p className="mt-3 text-xs text-muted">I consumi vengono corretti con uno storno; lo storico non viene eliminato.</p></Panel><Button variant="secondary" onClick={archive}><Archive size={17} /> Archivia recupero</Button></div></div>
    <ModalPresence>{dialog === 'material' && <Modal title="Materiale utilizzato" onClose={() => setDialog(null)}><form className="grid gap-4" onSubmit={addMaterial}><Field label="Materiale"><Select required value={materialForm.material_id} onChange={(e) => setMaterialForm((f) => ({ ...f, material_id: e.target.value }))}>{materials.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {Number(entry.quantity_available)} {entry.unit}</option>)}</Select></Field><Field label="Quantità"><Input type="number" min="0.001" step="0.001" value={materialForm.quantity} onChange={(e) => setMaterialForm((f) => ({ ...f, quantity: Number(e.target.value) }))} /></Field><Field label="Data"><Input type="date" value={materialForm.occurred_on} onChange={(e) => setMaterialForm((f) => ({ ...f, occurred_on: e.target.value }))} /></Field><Button type="submit" loading={saving}>Registra consumo</Button></form></Modal>}</ModalPresence>
    <ModalPresence>{dialog === 'time' && <Modal title="Registra ore" onClose={() => setDialog(null)}><form className="grid gap-4" onSubmit={addTime}><Field label="Data"><Input type="date" value={timeForm.work_date} onChange={(e) => setTimeForm((f) => ({ ...f, work_date: e.target.value }))} /></Field><div className="grid grid-cols-3 gap-2"><Field label="Ore"><Input type="number" min="0" value={timeForm.hours} onChange={(e) => setTimeForm((f) => ({ ...f, hours: Number(e.target.value) }))} /></Field><Field label="Minuti"><Input type="number" min="0" max="59" value={timeForm.minutes} onChange={(e) => setTimeForm((f) => ({ ...f, minutes: Number(e.target.value) }))} /></Field><Field label="€/ora"><Input type="number" min="0" step="0.5" value={timeForm.hourly_rate} onChange={(e) => setTimeForm((f) => ({ ...f, hourly_rate: Number(e.target.value) }))} /></Field></div><Field label="Note"><Input value={timeForm.notes} onChange={(e) => setTimeForm((f) => ({ ...f, notes: e.target.value }))} /></Field><Button type="submit" loading={saving}>Registra</Button></form></Modal>}</ModalPresence>
    <ModalPresence>{dialog === 'expense' && <Modal title="Registra spesa" onClose={() => setDialog(null)}><form className="grid gap-4" onSubmit={addExpense}><Field label="Descrizione"><Input required minLength={2} value={expenseForm.description} onChange={(e) => setExpenseForm((f) => ({ ...f, description: e.target.value }))} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Importo"><Input type="number" min="0.01" step="0.01" value={expenseForm.amount} onChange={(e) => setExpenseForm((f) => ({ ...f, amount: Number(e.target.value) }))} /></Field><Field label="Data"><Input type="date" value={expenseForm.incurred_on} onChange={(e) => setExpenseForm((f) => ({ ...f, incurred_on: e.target.value }))} /></Field></div><Field label="Fornitore"><Input value={expenseForm.supplier} onChange={(e) => setExpenseForm((f) => ({ ...f, supplier: e.target.value }))} /></Field><Button type="submit" loading={saving}>Registra</Button></form></Modal>}</ModalPresence>
  </div>
}

function Row({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) { return <div className={`flex justify-between gap-3 ${strong ? 'border-t border-line pt-2 font-semibold' : ''}`}><span className="text-muted">{label}</span><span className={value < 0 ? 'text-red-700' : ''}>{money.format(value)}</span></div> }
function MiniRecord({ title, detail, onRemove, action = 'delete', muted = false }: { title: string; detail: string; onRemove?: () => void; action?: 'delete' | 'reverse'; muted?: boolean }) { return <div className={`flex items-center gap-3 py-2.5 ${muted ? 'opacity-60' : ''}`}><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{title}</p><p className="text-[13px] text-muted">{detail}</p></div>{onRemove && <button type="button" onClick={onRemove} className={`grid size-8 place-items-center rounded-lg text-stone-400 ${action === 'reverse' ? 'hover:bg-amber-50 hover:text-amber-800' : 'hover:bg-red-50 hover:text-red-700'}`} aria-label={action === 'reverse' ? 'Storna movimento' : 'Elimina registrazione'}>{action === 'reverse' ? <RotateCcw size={15} /> : <Trash2 size={15} />}</button>}</div> }
