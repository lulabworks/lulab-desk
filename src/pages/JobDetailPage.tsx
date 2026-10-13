import { Archive, ArrowLeft, Check, CheckCircle2, Circle, Plus, Save, Trash2, UserRound } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button, EmptyState, Field, Input, Notice, Panel, Select, Textarea } from '../components/ui'
import { FinancePanel } from '../components/FinancePanel'
import { JobFilesPanel } from '../components/JobFilesPanel'
import { JobMaterialsPanel } from '../components/JobMaterialsPanel'
import { QuotesPanel } from '../components/QuotesPanel'
import { TimeTrackingPanel } from '../components/TimeTrackingPanel'
import { formatDate } from '../lib/format'
import { listSpring, sharedElementSpring, tapSpring } from '../lib/animations'
import { readableError, supabase } from '../lib/supabase'
import { JOB_STATUSES, JOB_TYPES, jobStatusMeta, type Customer, type Job, type JobStatus, type JobTask, type JobType } from '../lib/types'

type EditableJob = Pick<Job, 'title' | 'type' | 'customer_id' | 'status' | 'description' | 'notes' | 'technical_details' | 'due_date'>

export function JobDetailPage() {
  const reduceMotion = useReducedMotion()
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [job, setJob] = useState<Job | null>(null)
  const [form, setForm] = useState<EditableJob | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [tasks, setTasks] = useState<JobTask[]>([])
  const [newTask, setNewTask] = useState('')
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [deleting, setDeleting] = useState(false)
  const formRef = useRef<EditableJob | null>(null)
  const pendingSaveRef = useRef<{ payload: EditableJob; revision: number } | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const indicatorTimerRef = useRef<number | null>(null)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const revisionRef = useRef(0)
  const activeSavesRef = useRef(0)
  const mountedRef = useRef(true)
  const currentJobIdRef = useRef(id)
  currentJobIdRef.current = id

  const persistPending = useCallback(() => {
    const pending = pendingSaveRef.current
    if (!pending || !supabase || !id) return saveQueueRef.current

    const client = supabase
    pendingSaveRef.current = null
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    activeSavesRef.current += 1
    const operation = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const { data, error: saveError } = await client
          .from('jobs')
          .update({ ...pending.payload, customer_id: pending.payload.customer_id || null, due_date: pending.payload.due_date || null })
          .eq('id', id)
          .select('*, customer:customers(id, display_name, phone)')
          .single()

        if (saveError) throw saveError
        if (!mountedRef.current || currentJobIdRef.current !== id) return

        setJob(data as Job)
        if (revisionRef.current === pending.revision && !pendingSaveRef.current) {
          setSaveState('saved')
          if (indicatorTimerRef.current !== null) window.clearTimeout(indicatorTimerRef.current)
          indicatorTimerRef.current = window.setTimeout(() => setSaveState('idle'), 1800)
        }
      })
      .catch((saveError: unknown) => {
        if (!mountedRef.current || currentJobIdRef.current !== id) return
        if (revisionRef.current === pending.revision && !pendingSaveRef.current) setSaveState('error')
        setError(readableError(saveError))
      })
      .finally(() => {
        activeSavesRef.current = Math.max(0, activeSavesRef.current - 1)
      })

    saveQueueRef.current = operation
    return operation
  }, [id])

  const scheduleSave = useCallback((payload: EditableJob) => {
    const revision = ++revisionRef.current
    pendingSaveRef.current = { payload, revision }
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    if (indicatorTimerRef.current !== null) window.clearTimeout(indicatorTimerRef.current)
    if (mountedRef.current) setSaveState('saving')
    saveTimerRef.current = window.setTimeout(() => { void persistPending() }, 700)
  }, [persistPending])

  useEffect(() => {
    let active = true
    async function load() {
      if (!supabase || !id) return
      const [jobResult, customerResult, taskResult] = await Promise.all([
        supabase.from('jobs').select('*, customer:customers(id, display_name, phone)').eq('id', id).single(),
        supabase.from('customers').select('*').order('display_name'),
        supabase.from('job_tasks').select('*').eq('job_id', id).order('sort_order').order('created_at')
      ])
      if (!active) return
      if (jobResult.error) return setError(readableError(jobResult.error))
      const loaded = jobResult.data as Job
      setJob(loaded)
      const initialForm: EditableJob = {
        title: loaded.title,
        type: loaded.type,
        customer_id: loaded.customer_id,
        status: loaded.status,
        description: loaded.description,
        notes: loaded.notes,
        technical_details: loaded.technical_details,
        due_date: loaded.due_date,
      }
      formRef.current = initialForm
      setForm(initialForm)
      setCustomers((customerResult.data ?? []) as Customer[])
      setTasks((taskResult.data ?? []) as JobTask[])
      setError(customerResult.error || taskResult.error ? readableError(customerResult.error || taskResult.error) : '')
    }
    load()
    return () => { active = false }
  }, [id])

  useEffect(() => {
    mountedRef.current = true
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingSaveRef.current && activeSavesRef.current === 0) return
      void persistPending()
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)

    return () => {
      mountedRef.current = false
      window.removeEventListener('beforeunload', warnBeforeUnload)
      if (indicatorTimerRef.current !== null) window.clearTimeout(indicatorTimerRef.current)
      void persistPending()
    }
  }, [persistPending])

  function setField<K extends keyof EditableJob>(key: K, value: EditableJob[K]) {
    if (!formRef.current) return
    const next = { ...formRef.current, [key]: value }
    formRef.current = next
    setForm(next)
    scheduleSave(next)
  }

  async function addTask(event: FormEvent) {
    event.preventDefault()
    const title = newTask.trim()
    if (!title || !supabase || !id) return
    const { data, error: taskError } = await supabase.from('job_tasks').insert({ job_id: id, title, sort_order: tasks.length }).select().single()
    if (taskError) return setError(readableError(taskError))
    setTasks((current) => [...current, data as JobTask])
    setNewTask('')
  }

  async function toggleTask(task: JobTask) {
    if (!supabase) return
    const completed = !task.is_completed
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, is_completed: completed } : item))
    const { error: taskError } = await supabase.from('job_tasks').update({ is_completed: completed, completed_at: completed ? new Date().toISOString() : null }).eq('id', task.id)
    if (taskError) {
      setTasks((current) => current.map((item) => item.id === task.id ? task : item))
      setError(readableError(taskError))
    }
  }

  async function removeTask(taskId: string) {
    if (!supabase || !window.confirm('Rimuovere questa attività?')) return
    const { error: taskError } = await supabase.from('job_tasks').delete().eq('id', taskId)
    if (taskError) return setError(readableError(taskError))
    setTasks((current) => current.filter((item) => item.id !== taskId))
  }

  async function archiveJob() {
    if (!supabase || !id || !window.confirm('Concludere e conservare questa commessa? Tutto lo storico resterà disponibile.')) return
    setDeleting(true)
    await persistPending()
    const { error: archiveError } = await supabase.from('jobs').update({ status: 'concluso' }).eq('id', id)
    if (archiveError) {
      setDeleting(false)
      setError(readableError(archiveError))
      return
    }
    navigate('/lavori', { replace: true })
  }

  if (error && !job) return <div><Link className="inline-flex items-center gap-2 text-sm font-semibold text-brand" to="/lavori"><ArrowLeft size={17} /> Torna ai lavori</Link><div className="mt-5"><Notice tone="error">{error}</Notice></div></div>
  if (!job || !form) {
    const sharedTitle = (location.state as { sharedTitle?: string } | null)?.sharedTitle
    return <div className="grid min-w-0 gap-4">{sharedTitle && <motion.h1 layoutId={reduceMotion || !id ? undefined : `job-title-${id}`} transition={sharedElementSpring} className="min-w-0 break-words type-page-title">{sharedTitle}</motion.h1>}{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-40 min-w-0 animate-pulse rounded-2xl bg-white" />)}</div>
  }

  const meta = jobStatusMeta(form.status)
  return (
    <div className="min-w-0 max-w-full">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link className="inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-semibold text-brand" to="/lavori"><ArrowLeft size={18} /> Tutti i lavori</Link>
        <div className="flex items-center gap-2 text-xs font-semibold text-muted" aria-live="polite">{saveState === 'saving' && <><Save size={15} className="animate-pulse" /> Salvataggio…</>}{saveState === 'saved' && <><Check size={16} className="text-emerald-700" /> Salvato</>}{saveState === 'error' && <span className="text-red-700">Salvataggio non riuscito</span>}</div>
      </div>
      {error && <div className="mb-5"><Notice tone="error">{error}</Notice></div>}

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2"><span className="type-meta tabular-nums text-muted">{job.code}</span><span className={`rounded-full px-2.5 py-1 text-[13px] font-medium ${meta.tone}`}>{meta.label}</span></div>
        <motion.div layoutId={reduceMotion ? undefined : `job-title-${job.id}`} transition={sharedElementSpring} className="mt-3 min-w-0"><Input className="border-0 bg-transparent p-0 type-page-title shadow-none focus:ring-0" value={form.title} onChange={(e) => setField('title', e.target.value)} aria-label="Titolo commessa" /></motion.div>
        <p className="mt-2 text-xs text-muted">Aperta il {formatDate(job.opened_at)} · modifiche salvate automaticamente</p>
      </header>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,.8fr)]">
        <div className="grid min-w-0 gap-6">
          <Panel>
            <div className="mb-5"><p className="section-kicker">Dettagli</p><h2 className="type-panel-title">Scheda lavoro</h2></div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Tipologia"><Select value={form.type} onChange={(e) => setField('type', e.target.value as JobType)}>{JOB_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
              <Field label="Stato"><Select value={form.status} onChange={(e) => setField('status', e.target.value as JobStatus)}>{JOB_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
              <Field label="Cliente"><Select value={form.customer_id ?? ''} onChange={(e) => setField('customer_id', e.target.value || null)}><option value="">Nessun cliente associato</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.display_name}</option>)}</Select></Field>
              <Field label="Scadenza prevista"><Input type="date" value={form.due_date ?? ''} onChange={(e) => setField('due_date', e.target.value || null)} /></Field>
            </div>
            <div className="mt-5 grid gap-5">
              <Field label="Descrizione"><Textarea value={form.description ?? ''} onChange={(e) => setField('description', e.target.value || null)} placeholder="Obiettivo del lavoro, stato iniziale, richieste del cliente…" /></Field>
              <Field label="Misure e dettagli tecnici"><Textarea value={form.technical_details ?? ''} onChange={(e) => setField('technical_details', e.target.value || null)} placeholder="Misure, essenze, finiture, ferramenta, lavorazioni…" /></Field>
              <Field label="Note interne"><Textarea value={form.notes ?? ''} onChange={(e) => setField('notes', e.target.value || null)} placeholder="Promemoria e informazioni utili…" /></Field>
            </div>
          </Panel>

          <Panel>
            <div className="mb-5"><p className="section-kicker">Attività</p><h2 className="type-panel-title">Checklist</h2><p className="mt-1 text-sm text-muted">{tasks.filter((task) => task.is_completed).length} di {tasks.length} completate</p></div>
            <form className="mb-4 flex gap-2" onSubmit={addTask}><Input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Aggiungi un’attività…" aria-label="Nuova attività" /><Button type="submit" className="shrink-0 px-3 sm:px-4"><Plus size={18} /><span className="hidden sm:inline">Aggiungi</span></Button></form>
            {tasks.length === 0 ? <EmptyState icon={<CheckCircle2 size={22} />} title="Checklist vuota" description="Aggiungi i passaggi necessari per portare a termine questa commessa." /> : <motion.div layout={!reduceMotion} className="min-w-0 divide-y divide-line"><AnimatePresence initial={false}>{tasks.map((task) => <motion.div layout={!reduceMotion} key={task.id} initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }} transition={listSpring} className="group flex min-w-0 items-center gap-3 py-3"><motion.button whileTap={reduceMotion ? undefined : { scale: 0.94 }} transition={tapSpring} className="grid size-9 shrink-0 place-items-center rounded-full text-brand hover:bg-brand-soft" onClick={() => toggleTask(task)} aria-label={task.is_completed ? 'Segna come da fare' : 'Segna come completata'}>{task.is_completed ? <CheckCircle2 size={22} className="fill-brand text-white" /> : <Circle size={22} />}</motion.button><span className={`min-w-0 flex-1 break-words text-sm font-medium [overflow-wrap:anywhere] ${task.is_completed ? 'text-muted line-through' : ''}`}>{task.title}</span><motion.button whileTap={reduceMotion ? undefined : { scale: 0.94 }} transition={tapSpring} className="grid size-9 shrink-0 place-items-center rounded-xl text-stone-300 opacity-100 hover:bg-red-50 hover:text-red-700 sm:opacity-0 sm:group-hover:opacity-100" onClick={() => removeTask(task.id)} aria-label="Rimuovi attività"><Trash2 size={17} /></motion.button></motion.div>)}</AnimatePresence></motion.div>}
          </Panel>
        </div>

        <div className="grid min-w-0 content-start gap-6">
          <Panel>
            <div className="flex min-w-0 items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><UserRound size={19} /></div><div className="min-w-0"><p className="text-xs font-medium text-muted">Cliente</p><p className="break-words font-semibold [overflow-wrap:anywhere]">{job.customer?.display_name ?? 'Non associato'}</p></div></div>
            {!job.customer && <Link to="/clienti" className="mt-4 inline-flex text-sm font-semibold text-brand">Apri anagrafica clienti →</Link>}
          </Panel>
          <Panel>
            <p className="section-kicker">Gestione</p><h2 className="type-card-title">Azioni commessa</h2>
            <Button variant="secondary" className="mt-4 w-full" loading={deleting} onClick={archiveJob}><Archive size={17} /> Concludi e conserva</Button>
          </Panel>
        </div>
      </div>
      <div className="mt-6 grid min-w-0 gap-6">
        <JobFilesPanel jobId={job.id} />
        <JobMaterialsPanel jobId={job.id} />
        <QuotesPanel job={job} />
        <TimeTrackingPanel jobId={job.id} />
        <FinancePanel job={job} />
      </div>
    </div>
  )
}
