import { ArrowRight, CalendarClock, CheckCircle2, CircleDollarSign, ClipboardList, Hammer, Plus, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, format } from 'date-fns'
import { Button, EmptyState, Notice, PageHeader, Panel } from '../components/ui'
import { formatDate, money } from '../lib/format'
import { readableError, supabase } from '../lib/supabase'
import type { Job, JobTask } from '../lib/types'
import { jobStatusMeta, jobTypeLabel } from '../lib/types'

interface Metrics {
  open: number
  active: number
  quotesToPrepare: number
  quotesWaiting: number
  upcoming: number
  tasks: number
  outstanding: number
}

const emptyMetrics: Metrics = { open: 0, active: 0, quotesToPrepare: 0, quotesWaiting: 0, upcoming: 0, tasks: 0, outstanding: 0 }

export function DashboardPage() {
  const [metrics, setMetrics] = useState(emptyMetrics)
  const [jobs, setJobs] = useState<Job[]>([])
  const [tasks, setTasks] = useState<(JobTask & { job?: { title: string } | null })[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      if (!supabase) return
      setLoading(true)
      const today = format(new Date(), 'yyyy-MM-dd')
      const soon = format(addDays(new Date(), 14), 'yyyy-MM-dd')
      const [jobsResult, tasksResult] = await Promise.all([
        supabase.from('jobs').select('*, customer:customers(id, display_name, phone)').order('updated_at', { ascending: false }),
        supabase.from('job_tasks').select('*, job:jobs(title)').eq('is_completed', false).order('sort_order')
      ])
      if (jobsResult.error || tasksResult.error) {
        setError(readableError(jobsResult.error || tasksResult.error))
      } else {
        const allJobs = (jobsResult.data ?? []) as Job[]
        const activeStatuses = ['confermato', 'da_iniziare', 'in_lavorazione', 'in_attesa', 'pronto_consegna']
        const open = allJobs.filter((job) => !['concluso', 'annullato', 'non_confermato'].includes(job.status))
        setMetrics({
          open: open.length,
          active: allJobs.filter((job) => job.status === 'in_lavorazione').length,
          quotesToPrepare: allJobs.filter((job) => job.status === 'preventivo_da_preparare').length,
          quotesWaiting: allJobs.filter((job) => job.status === 'preventivo_inviato').length,
          upcoming: allJobs.filter((job) => job.due_date && job.due_date >= today && job.due_date <= soon && activeStatuses.includes(job.status)).length,
          tasks: (tasksResult.data ?? []).length,
          outstanding: allJobs.reduce((sum, job) => sum + Math.max(Number(job.agreed_revenue || 0) - Number(job.payments_received || 0), 0), 0)
        })
        setJobs(allJobs.slice(0, 5))
        setTasks(((tasksResult.data ?? []) as (JobTask & { job?: { title: string } | null })[]).slice(0, 6))
      }
      setLoading(false)
    }
    load()
  }, [])

  const cards = [
    { label: 'Lavori aperti', value: metrics.open, icon: ClipboardList, color: 'bg-sky-100 text-sky-800', to: '/lavori?filtro=aperti' },
    { label: 'In lavorazione', value: metrics.active, icon: Hammer, color: 'bg-orange-100 text-orange-800', to: '/lavori?stato=in_lavorazione' },
    { label: 'Preventivi da fare', value: metrics.quotesToPrepare, icon: Sparkles, color: 'bg-amber-100 text-amber-900', to: '/lavori?stato=preventivo_da_preparare' },
    { label: 'In attesa risposta', value: metrics.quotesWaiting, icon: CalendarClock, color: 'bg-violet-100 text-violet-800', to: '/lavori?stato=preventivo_inviato' },
    { label: 'Consegne entro 14 giorni', value: metrics.upcoming, icon: CheckCircle2, color: 'bg-emerald-100 text-emerald-800', to: '/lavori?filtro=scadenze' }
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Panoramica"
        title="Buon lavoro."
        description="Quello che richiede attenzione oggi, in un colpo d’occhio."
        action={<Link to="/lavori?nuovo=1"><Button className="w-full sm:w-auto"><Plus size={18} /> Nuova commessa</Button></Link>}
      />
      {error && <div className="mb-5"><Notice tone="error">Impossibile caricare la dashboard: {error}</Notice></div>}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cards.map(({ label, value, icon: Icon, color, to }) => (
          <Link key={label} to={to} className="group rounded-2xl border border-line bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-md sm:p-5">
            <div className={`grid size-10 place-items-center rounded-xl ${color}`}><Icon size={19} /></div>
            <p className="mt-5 text-3xl type-amount">{loading ? '—' : value}</p>
            <div className="mt-1 flex items-end justify-between gap-2"><p className="text-xs font-semibold leading-5 text-muted sm:text-sm">{label}</p><ArrowRight size={15} className="shrink-0 text-stone-300 transition group-hover:translate-x-0.5 group-hover:text-brand" /></div>
          </Link>
        ))}
      </section>

      <Panel className="mt-4 flex items-center justify-between gap-4 overflow-hidden bg-brand text-white">
        <div><p className="type-meta text-accent">Da incassare</p><p className="mt-1 text-3xl type-amount">{loading ? '—' : money.format(metrics.outstanding)}</p><p className="mt-1 text-xs text-white/65">Ricavi concordati meno pagamenti registrati</p></div>
        <CircleDollarSign size={42} className="shrink-0 text-white/25" />
      </Panel>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_.85fr]">
        <Panel>
          <div className="mb-4 flex items-center justify-between"><div><p className="section-kicker">Commesse</p><h2 className="type-panel-title">Aggiornate di recente</h2></div><Link className="text-sm font-semibold text-brand" to="/lavori">Vedi tutte</Link></div>
          {!loading && jobs.length === 0 ? (
            <EmptyState icon={<Hammer size={22} />} title="Il banco è libero" description="Crea la prima commessa per iniziare a organizzare il lavoro." action={<Link to="/lavori?nuovo=1"><Button><Plus size={17} /> Nuova commessa</Button></Link>} />
          ) : (
            <div className="divide-y divide-line">
              {jobs.map((job) => {
                const meta = jobStatusMeta(job.status)
                return <Link key={job.id} to={`/lavori/${job.id}`} className="group flex items-center gap-3 py-4 first:pt-1 last:pb-1"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{job.title}</p><span className={`rounded-full px-2 py-0.5 text-[13px] font-medium ${meta.tone}`}>{meta.label}</span></div><p className="mt-1 truncate text-xs text-muted">{job.code} · {jobTypeLabel(job.type)}{job.customer?.display_name ? ` · ${job.customer.display_name}` : ''}</p></div><div className="hidden text-right sm:block"><p className="text-xs font-semibold text-muted">Scadenza</p><p className="mt-0.5 text-sm">{formatDate(job.due_date, 'Non definita')}</p></div><ArrowRight size={17} className="text-stone-300 group-hover:text-brand" /></Link>
              })}
            </div>
          )}
        </Panel>

        <Panel>
          <div className="mb-4"><p className="section-kicker">Checklist</p><h2 className="type-panel-title">Da completare</h2></div>
          {!loading && tasks.length === 0 ? <EmptyState icon={<CheckCircle2 size={22} />} title="Tutto fatto" description="Non ci sono attività aperte nelle commesse." /> : <div className="grid gap-2">{tasks.map((task) => <Link key={task.id} to={`/lavori/${task.job_id}`} className="flex items-start gap-3 rounded-xl bg-stone-50 p-3.5 transition hover:bg-brand-soft"><span className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-stone-300" /><span><span className="block text-sm font-semibold leading-5">{task.title}</span><span className="mt-0.5 block text-xs text-muted">{task.job?.title ?? 'Commessa'}</span></span></Link>)}</div>}
        </Panel>
      </div>
    </div>
  )
}
