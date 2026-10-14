import { Archive, ArrowRight, Armchair, Plus, Search } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, EmptyState, Field, Input, Modal, ModalPresence, Notice, PageHeader, Select } from '../components/ui'
import { sharedElementSpring, tapSpring } from '../lib/animations'
import { formatDate, money, todayIso } from '../lib/format'
import { isPhase3Unavailable } from '../lib/phase3'
import { readableError, supabase } from '../lib/supabase'
import { RECOVERY_STATUSES, type Job, type RecoveredItem } from '../lib/types'
import { useAuth } from '../contexts/AuthContext'
import { recordSuccessfulOperation } from '../lib/adaptive/usage'

export function RecoveriesPage() {
  const { user } = useAuth()
  const reduceMotion = useReducedMotion()
  const navigate = useNavigate()
  const [items, setItems] = useState<RecoveredItem[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', acquired_on: todayIso(), acquisition_cost: 0, job_id: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => { (async () => {
    if (!supabase) return
    const [itemResult, jobResult] = await Promise.all([supabase.from('recovered_items').select('*, job:jobs(id,code,title,agreed_revenue)').order('updated_at', { ascending: false }), supabase.from('jobs').select('*').order('created_at', { ascending: false })])
    if (itemResult.error) { setUnavailable(isPhase3Unavailable(itemResult.error)); if (!isPhase3Unavailable(itemResult.error)) setError(readableError(itemResult.error)) } else setItems((itemResult.data ?? []) as RecoveredItem[])
    if (!jobResult.error) setJobs((jobResult.data ?? []) as Job[])
  })() }, [])
  const filtered = useMemo(() => items.filter((item) => `${item.name} ${item.code} ${item.origin ?? ''} ${item.location ?? ''}`.toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it')) && (showArchived ? item.is_archived : !item.is_archived)), [items, query, showArchived])
  async function create(event: FormEvent) {
    event.preventDefault(); if (!supabase) return
    setSaving(true)
    const { data, error: createError } = await supabase.from('recovered_items').insert({ name: form.name.trim(), acquired_on: form.acquired_on, acquisition_cost: Number(form.acquisition_cost), job_id: form.job_id || null }).select().single()
    setSaving(false)
    if (createError) return setError(readableError(createError))
    recordSuccessfulOperation(user?.id, 'recovery.created')
    navigate(`/recuperi/${data.id}`)
  }
  return <div><PageHeader eyebrow="Recupero e rivendita" title="Mobili recuperati" description="Inventario, restauro, costi e margini dei mobili destinati alla rivendita." action={!unavailable ? <Button onClick={() => setOpen(true)}><Plus size={17} /> Nuovo recupero</Button> : undefined} />{unavailable ? <Notice>Applica la migrazione <strong>003_phase3_management.sql</strong> per attivare l’inventario recuperi.</Notice> : <>{error && <div className="mb-5"><Notice tone="error">{error}</Notice></div>}<div className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto]"><div className="relative"><Search className="absolute left-3.5 top-3.5 text-stone-400" size={18} /><Input className="pl-10" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca per nome, codice, provenienza o posizione…" /></div><Button variant="secondary" onClick={() => setShowArchived((value) => !value)}><Archive size={16} /> {showArchived ? 'Mostra attivi' : 'Mostra archiviati'}</Button></div>{filtered.length === 0 ? <EmptyState icon={<Armchair size={23} />} title={showArchived ? 'Nessun recupero archiviato' : 'Nessun mobile recuperato'} description={showArchived ? 'Le schede archiviate restano disponibili senza perdere lo storico.' : 'Crea una scheda per seguire acquisizione, restauro e vendita.'} /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map((item) => { const status = RECOVERY_STATUSES.find((entry) => entry.value === item.status)!; const sale = item.status === 'venduto' ? Number(item.actual_sale_price || 0) : Number(item.expected_sale_price || 0); return <Link key={item.id} to={`/recuperi/${item.id}`} state={{ sharedTitle: item.name }} className="block"><motion.article layout={!reduceMotion} whileTap={reduceMotion ? undefined : { scale: 0.98 }} transition={tapSpring} className="group rounded-2xl border border-line bg-white p-5 shadow-card transition-shadow hover:shadow-md"><div className="flex items-start justify-between"><span className="type-meta tabular-nums text-muted">{item.code}</span><span className={`rounded-full px-2.5 py-1 text-[13px] font-medium ${status.tone}`}>{status.label}</span></div><motion.h2 layoutId={reduceMotion ? undefined : `recovery-title-${item.id}`} transition={sharedElementSpring} className="mt-4 type-card-title">{item.name}</motion.h2><p className="mt-1 truncate text-sm text-muted">{item.origin || 'Provenienza non indicata'} · {formatDate(item.acquired_on)}</p><div className="mt-5 flex items-end justify-between border-t border-line pt-4"><div><p className="text-[13px] font-medium text-muted">{item.status === 'venduto' ? 'Venduto a' : 'Prezzo previsto'}</p><p className="mt-1 text-lg font-semibold text-brand">{money.format(sale)}</p></div><ArrowRight size={18} className="text-stone-300 group-hover:text-brand" /></div></motion.article></Link>})}</div>}</>}<ModalPresence>{open && <Modal title="Nuovo mobile recuperato" onClose={() => setOpen(false)}><form className="grid gap-4" onSubmit={create}><Field label="Nome"><Input required minLength={2} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Es. Credenza anni ’50" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Data acquisizione"><Input required type="date" value={form.acquired_on} onChange={(e) => setForm((f) => ({ ...f, acquired_on: e.target.value }))} /></Field><Field label="Costo acquisizione"><Input type="number" min="0" step="0.01" value={form.acquisition_cost} onChange={(e) => setForm((f) => ({ ...f, acquisition_cost: Number(e.target.value) }))} /></Field></div><Field label="Commessa collegata (facoltativa)"><Select value={form.job_id} onChange={(e) => setForm((f) => ({ ...f, job_id: e.target.value }))}><option value="">Gestione autonoma</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.code} · {job.title}</option>)}</Select></Field><Notice>Se colleghi una commessa, ore e spese verranno lette dalla Fase 2 per evitare duplicazioni.</Notice><Button type="submit" loading={saving}>Crea scheda</Button></form></Modal>}</ModalPresence></div>
}
