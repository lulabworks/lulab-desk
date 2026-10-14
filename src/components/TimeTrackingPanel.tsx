import { Clock3, Play, Plus, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { formatDate, money, todayIso } from '../lib/format'
import { isPhase2Unavailable, minutesLabel } from '../lib/phase2'
import { readableError, supabase } from '../lib/supabase'
import type { TimeEntry } from '../lib/types'
import { useAuth } from '../contexts/AuthContext'
import { recordSuccessfulOperation } from '../lib/adaptive/usage'
import { Button, EmptyState, Field, Input, Modal, ModalPresence, Notice, Panel, Textarea } from './ui'

export function TimeTrackingPanel({ jobId }: { jobId: string }) {
  const { user } = useAuth()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [hourlyRate, setHourlyRate] = useState(35)
  const [now, setNow] = useState(Date.now())
  const [showManual, setShowManual] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [manual, setManual] = useState({ work_date: todayIso(), hours: 1, minutes: 0, notes: '' })

  useEffect(() => {
    async function load() {
      if (!supabase) return
      const [entryResult, settingsResult] = await Promise.all([
        supabase.from('time_entries').select('*').eq('job_id', jobId).order('work_date', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('user_settings').select('hourly_rate').single()
      ])
      if (entryResult.error) {
        setUnavailable(isPhase2Unavailable(entryResult.error))
        if (!isPhase2Unavailable(entryResult.error)) setError(readableError(entryResult.error))
      } else {
        setEntries((entryResult.data ?? []) as TimeEntry[])
      }
      if (settingsResult.data) setHourlyRate(Number(settingsResult.data.hourly_rate || 0))
    }
    load()
  }, [jobId])

  const running = entries.find((entry) => entry.is_running)
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  const runningMinutes = running?.started_at ? Math.max(0, Math.floor((now - new Date(running.started_at).getTime()) / 60000)) : 0
  const totalMinutes = useMemo(() => entries.reduce((sum, entry) => sum + (entry.is_running ? runningMinutes : Number(entry.duration_minutes)), 0), [entries, runningMinutes])
  const totalValue = useMemo(() => entries.reduce((sum, entry) => {
    const minutes = entry.is_running ? runningMinutes : Number(entry.duration_minutes)
    return sum + (minutes / 60) * Number(entry.hourly_rate)
  }, 0), [entries, runningMinutes])

  async function startTimer() {
    if (!supabase) return
    setWorking(true)
    setError('')
    const { data, error: startError } = await supabase.from('time_entries').insert({
      job_id: jobId,
      work_date: todayIso(),
      started_at: new Date().toISOString(),
      hourly_rate: hourlyRate,
      is_running: true
    }).select().single()
    setWorking(false)
    if (startError) return setError(startError.code === '23505' ? 'C’è già un cronometro attivo in un’altra commessa.' : readableError(startError))
    recordSuccessfulOperation(user?.id, 'time.timer_started')
    setEntries((current) => [data as TimeEntry, ...current])
    setNow(Date.now())
  }

  async function stopTimer() {
    if (!supabase || !running || !running.started_at) return
    setWorking(true)
    setError('')
    const endedAt = new Date()
    const minutes = Math.max(1, Math.ceil((endedAt.getTime() - new Date(running.started_at).getTime()) / 60000))
    const { data, error: stopError } = await supabase.from('time_entries').update({
      ended_at: endedAt.toISOString(),
      duration_minutes: minutes,
      is_running: false
    }).eq('id', running.id).select().single()
    setWorking(false)
    if (stopError) return setError(readableError(stopError))
    recordSuccessfulOperation(user?.id, 'time.timer_stopped')
    setEntries((current) => current.map((entry) => entry.id === running.id ? data as TimeEntry : entry))
  }

  async function addManual(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const duration = Number(manual.hours) * 60 + Number(manual.minutes)
    if (duration <= 0) return setError('Inserisci una durata maggiore di zero.')
    setWorking(true)
    const { data, error: addError } = await supabase.from('time_entries').insert({
      job_id: jobId,
      work_date: manual.work_date,
      duration_minutes: duration,
      hourly_rate: hourlyRate,
      notes: manual.notes.trim() || null
    }).select().single()
    setWorking(false)
    if (addError) return setError(readableError(addError))
    recordSuccessfulOperation(user?.id, 'time.manual_created')
    setEntries((current) => [data as TimeEntry, ...current])
    setManual({ work_date: todayIso(), hours: 1, minutes: 0, notes: '' })
    setShowManual(false)
  }

  async function removeEntry(entry: TimeEntry) {
    if (!supabase || !window.confirm('Eliminare questa registrazione oraria?')) return
    const { error: removeError } = await supabase.from('time_entries').delete().eq('id', entry.id)
    if (removeError) return setError(readableError(removeError))
    recordSuccessfulOperation(user?.id, 'time.deleted')
    setEntries((current) => current.filter((item) => item.id !== entry.id))
  }

  return (
    <Panel>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><p className="section-kicker">Consuntivo</p><h2 className="type-panel-title">Ore lavorate</h2></div>
        {!unavailable && <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setShowManual(true)}><Plus size={17} /> Manuale</Button>{running ? <Button onClick={stopTimer} loading={working}><Square size={16} /> Ferma</Button> : <Button onClick={startTimer} loading={working}><Play size={17} /> Avvia</Button>}</div>}
      </div>
      {unavailable ? <Notice>Applica la migrazione <strong>002_phase2_operations.sql</strong> per attivare ore e cronometro.</Notice> : <>
        {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
        {running && <div className="mb-4 flex min-w-0 items-center justify-between gap-3 rounded-xl bg-brand p-4 text-white"><div className="min-w-0"><p className="type-meta text-white/70">Cronometro attivo</p><p className="mt-1 text-sm">Avviato alle {new Date(running.started_at!).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</p></div><p className="shrink-0 text-2xl type-amount">{formatElapsed(now - new Date(running.started_at!).getTime())}</p></div>}
        <div className="mb-5 grid min-w-0 grid-cols-2 gap-3"><div className="min-w-0 rounded-xl bg-stone-50 p-4"><p className="type-meta text-muted">Tempo totale</p><p className="mt-1 break-words text-2xl type-amount [overflow-wrap:anywhere]">{minutesLabel(totalMinutes)}</p></div><div className="min-w-0 rounded-xl bg-stone-50 p-4"><p className="type-meta text-muted">Valore lavoro</p><p className="mt-1 break-words text-2xl type-amount text-brand [overflow-wrap:anywhere]">{money.format(totalValue)}</p></div></div>
        {entries.length === 0 ? <EmptyState icon={<Clock3 size={22} />} title="Nessuna ora registrata" description="Avvia il cronometro o inserisci manualmente il tempo già lavorato." /> : <div className="min-w-0 divide-y divide-line">{entries.map((entry) => <div key={entry.id} className="flex min-w-0 items-center gap-3 py-3"><div className={`grid size-10 shrink-0 place-items-center rounded-xl ${entry.is_running ? 'bg-brand text-white' : 'bg-stone-100 text-brand'}`}><Clock3 size={18} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{entry.is_running ? `In corso · ${minutesLabel(runningMinutes)}` : minutesLabel(Number(entry.duration_minutes))}</p><p className="mt-0.5 truncate text-xs text-muted">{formatDate(entry.work_date)} · {money.format(Number(entry.hourly_rate))}/ora{entry.notes ? ` · ${entry.notes}` : ''}</p></div><p className="hidden shrink-0 text-sm font-semibold sm:block">{money.format(((entry.is_running ? runningMinutes : Number(entry.duration_minutes)) / 60) * Number(entry.hourly_rate))}</p><button onClick={() => removeEntry(entry)} className="grid size-9 shrink-0 place-items-center rounded-xl text-stone-400 hover:bg-red-50 hover:text-red-700" aria-label="Elimina registrazione"><Trash2 size={16} /></button></div>)}</div>}
      </>}
      <ModalPresence>{showManual && <Modal title="Registra ore lavorate" onClose={() => setShowManual(false)}><form className="grid gap-4" onSubmit={addManual}><Field label="Data"><Input required type="date" value={manual.work_date} onChange={(e) => setManual((current) => ({ ...current, work_date: e.target.value }))} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Ore"><Input required type="number" min="0" step="1" value={manual.hours} onChange={(e) => setManual((current) => ({ ...current, hours: Number(e.target.value) }))} /></Field><Field label="Minuti"><Input required type="number" min="0" max="59" step="1" value={manual.minutes} onChange={(e) => setManual((current) => ({ ...current, minutes: Number(e.target.value) }))} /></Field></div><Field label="Tariffa applicata"><Input type="number" min="0" step="0.5" value={hourlyRate} onChange={(e) => setHourlyRate(Number(e.target.value))} /></Field><Field label="Nota"><Textarea value={manual.notes} onChange={(e) => setManual((current) => ({ ...current, notes: e.target.value }))} placeholder="Lavorazione svolta…" /></Field><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setShowManual(false)}>Annulla</Button><Button type="submit" loading={working}>Registra</Button></div></form></Modal>}</ModalPresence>
    </Panel>
  )
}

function formatElapsed(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}
