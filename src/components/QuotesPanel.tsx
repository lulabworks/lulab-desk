import { FileText, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState, Notice, Panel } from './ui'
import { formatDate, money } from '../lib/format'
import { isPhase2Unavailable } from '../lib/phase2'
import { readableError, supabase } from '../lib/supabase'
import { QUOTE_STATUSES, type Job, type Quote } from '../lib/types'

export function QuotesPanel({ job }: { job: Job }) {
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    async function load() {
      if (!supabase) return
      const { data, error: loadError } = await supabase.from('quotes').select('*').eq('job_id', job.id).order('created_at', { ascending: false })
      if (loadError) {
        setUnavailable(isPhase2Unavailable(loadError))
        setError(isPhase2Unavailable(loadError) ? '' : readableError(loadError))
      } else {
        setQuotes((data ?? []) as Quote[])
      }
      setLoading(false)
    }
    load()
  }, [job.id])

  async function createQuote() {
    if (!supabase) return
    setCreating(true)
    setError('')
    const { data: settings } = await supabase.from('user_settings').select('hourly_rate').single()
    const { data, error: createError } = await supabase.from('quotes').insert({
      job_id: job.id,
      title: `Preventivo · ${job.title}`,
      hourly_rate: Number(settings?.hourly_rate ?? 35)
    }).select().single()
    setCreating(false)
    if (createError) return setError(readableError(createError))
    navigate(`/lavori/${job.id}/preventivi/${data.id}`)
  }

  return (
    <Panel>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><p className="section-kicker">Offerte</p><h2 className="font-display text-2xl font-semibold">Preventivi</h2></div>
        {!unavailable && <Button onClick={createQuote} loading={creating}><Plus size={17} /> Nuovo preventivo</Button>}
      </div>
      {unavailable ? <Notice>Applica la migrazione <strong>002_phase2_operations.sql</strong> per attivare i preventivi.</Notice> : error ? <Notice tone="error">{error}</Notice> : !loading && quotes.length === 0 ? <EmptyState icon={<FileText size={22} />} title="Nessun preventivo" description="Crea un preventivo modificabile con materiali, manodopera, spese e margine." action={<Button onClick={createQuote}><Plus size={17} /> Crea preventivo</Button>} /> : <div className="grid gap-2">{quotes.map((quote) => {
        const status = QUOTE_STATUSES.find((item) => item.value === quote.status) ?? QUOTE_STATUSES[0]
        return <button key={quote.id} onClick={() => navigate(`/lavori/${job.id}/preventivi/${quote.id}`)} className="flex w-full items-center gap-3 rounded-xl border border-line p-3.5 text-left transition hover:border-brand/30 hover:bg-brand-soft/40"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-stone-100 text-brand"><FileText size={19} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold">{quote.title}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${status.tone}`}>{status.label}</span></div><p className="mt-1 text-xs text-muted">{quote.code} · {formatDate(quote.quote_date)}</p></div><p className="font-display text-lg font-semibold text-brand">{money.format(Number(quote.total))}</p></button>
      })}</div>}
    </Panel>
  )
}
