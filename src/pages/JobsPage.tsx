import { ArrowRight, Hammer, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { addDays, format } from 'date-fns'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Button, EmptyState, Field, Input, Modal, ModalPresence, Notice, PageHeader, Select } from '../components/ui'
import { listSpring, sharedElementSpring, tapSpring } from '../lib/animations'
import { formatDate } from '../lib/format'
import { readableError, supabase } from '../lib/supabase'
import { JOB_STATUSES, JOB_TYPES, jobStatusMeta, jobTypeLabel, type Job, type JobType } from '../lib/types'

const jobSchema = z.object({
  title: z.string().trim().min(2, 'Inserisci un titolo di almeno 2 caratteri.').max(120),
  type: z.enum(['restauro', 'su_misura', 'recupero', 'antitarlo'])
})

export function JobsPage() {
  const reduceMotion = useReducedMotion()
  const [searchParams, setSearchParams] = useSearchParams()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState(searchParams.get('stato') ?? '')
  const [newOpen, setNewOpen] = useState(searchParams.get('nuovo') === '1')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<JobType>('restauro')
  const [formError, setFormError] = useState('')

  async function load() {
    if (!supabase) return
    setLoading(true)
    const { data, error: loadError } = await supabase.from('jobs').select('*, customer:customers(id, display_name, phone)').order('updated_at', { ascending: false })
    setError(loadError ? readableError(loadError) : '')
    setJobs((data ?? []) as Job[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('it')
    const today = format(new Date(), 'yyyy-MM-dd')
    const soon = format(addDays(new Date(), 14), 'yyyy-MM-dd')
    return jobs.filter((job) => {
      const filter = searchParams.get('filtro')
      const matchesStatus = status
        ? job.status === status
        : filter === 'aperti'
          ? !['concluso', 'annullato', 'non_confermato'].includes(job.status)
          : filter === 'scadenze'
            ? Boolean(job.due_date && job.due_date >= today && job.due_date <= soon && !['concluso', 'annullato', 'non_confermato'].includes(job.status))
            : true
      const haystack = `${job.title} ${job.code} ${job.customer?.display_name ?? ''} ${jobTypeLabel(job.type)}`.toLocaleLowerCase('it')
      return matchesStatus && (!needle || haystack.includes(needle))
    })
  }, [jobs, query, status, searchParams])

  async function createJob(event: FormEvent) {
    event.preventDefault()
    setFormError('')
    const parsed = jobSchema.safeParse({ title, type })
    if (!parsed.success) return setFormError(parsed.error.issues[0].message)
    if (!supabase) return
    setCreating(true)
    const { data, error: createError } = await supabase.from('jobs').insert(parsed.data).select('*, customer:customers(id, display_name, phone)').single()
    setCreating(false)
    if (createError) return setFormError(readableError(createError))
    setJobs((current) => [data as Job, ...current])
    closeModal()
  }

  function closeModal() {
    setNewOpen(false)
    setTitle('')
    setType('restauro')
    setFormError('')
    const next = new URLSearchParams(searchParams)
    next.delete('nuovo')
    setSearchParams(next, { replace: true })
  }

  return (
    <div>
      <PageHeader eyebrow="Commesse" title="Lavori" description="Tutte le richieste e i lavori del laboratorio, dal primo contatto alla consegna." action={<Button onClick={() => setNewOpen(true)}><Plus size={18} /> Nuova commessa</Button>} />
      {error && <div className="mb-5"><Notice tone="error">{error}</Notice></div>}
      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_260px]">
        <div className="relative"><Search className="absolute left-3.5 top-3.5 text-stone-400" size={18} /><Input className="pl-10" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca per titolo, codice, cliente…" aria-label="Cerca lavori" /></div>
        <div className="relative"><SlidersHorizontal className="pointer-events-none absolute left-3.5 top-3.5 text-stone-400" size={17} /><Select className="pl-10" value={status} onChange={(e) => { setStatus(e.target.value); const next = new URLSearchParams(searchParams); e.target.value ? next.set('stato', e.target.value) : next.delete('stato'); next.delete('filtro'); setSearchParams(next, { replace: true }) }} aria-label="Filtra per stato"><option value="">Tutti gli stati</option>{JOB_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></div>
      </div>

      {!loading && filtered.length === 0 ? <EmptyState icon={<Hammer size={23} />} title={jobs.length ? 'Nessun risultato' : 'Nessuna commessa'} description={jobs.length ? 'Prova a cambiare ricerca o filtro.' : 'Crea la prima commessa: bastano un titolo e una tipologia.'} action={!jobs.length ? <Button onClick={() => setNewOpen(true)}><Plus size={17} /> Nuova commessa</Button> : undefined} /> : (
        <motion.div layout={!reduceMotion} className="grid gap-3">
          {loading ? Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl bg-white" />) : <AnimatePresence initial={false}>{filtered.map((job) => {
            const meta = jobStatusMeta(job.status)
            return <motion.div layout={!reduceMotion} key={job.id} initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }} transition={listSpring}><Link to={`/lavori/${job.id}`} state={{ sharedTitle: job.title }} className="block"><motion.article whileTap={reduceMotion ? undefined : { scale: 0.98 }} transition={tapSpring} className="group grid gap-4 rounded-2xl border border-line bg-white p-4 shadow-card transition-shadow hover:shadow-md sm:grid-cols-[1fr_auto] sm:items-center sm:p-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="type-meta tabular-nums text-muted">{job.code}</span><span className={`rounded-full px-2.5 py-1 text-[13px] font-medium ${meta.tone}`}>{meta.label}</span></div><motion.h2 layoutId={reduceMotion ? undefined : `job-title-${job.id}`} transition={sharedElementSpring} className="mt-2 truncate type-card-title">{job.title}</motion.h2><p className="mt-1 truncate text-sm text-muted">{jobTypeLabel(job.type)}{job.customer?.display_name ? ` · ${job.customer.display_name}` : ' · Nessun cliente associato'}</p></div><div className="flex items-center justify-between gap-8 border-t border-line pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0"><div><p className="text-[13px] font-medium text-muted">Scadenza</p><p className="mt-1 text-sm font-medium">{formatDate(job.due_date, 'Da definire')}</p></div><ArrowRight size={19} className="text-stone-300 transition group-hover:translate-x-1 group-hover:text-brand" /></div></motion.article></Link></motion.div>
          })}</AnimatePresence>}
        </motion.div>
      )}

      <ModalPresence>{newOpen && <Modal title="Nuova commessa" onClose={closeModal}><form className="grid gap-5" onSubmit={createJob}><p className="-mt-2 text-sm leading-6 text-muted">Parti subito con le informazioni essenziali. Potrai completare tutto il resto nella scheda lavoro.</p><Field label="Titolo"><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Es. Restauro credenza anni ’50" maxLength={120} /></Field><Field label="Tipologia"><Select value={type} onChange={(e) => setType(e.target.value as JobType)}>{JOB_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>{formError && <Notice tone="error">{formError}</Notice>}<div className="grid grid-cols-2 gap-3"><Button type="button" variant="secondary" onClick={closeModal}>Annulla</Button><Button type="submit" loading={creating}>Crea commessa</Button></div></form></Modal>}</ModalPresence>
    </div>
  )
}
