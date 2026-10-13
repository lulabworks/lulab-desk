import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths } from 'date-fns'
import { it } from 'date-fns/locale'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, List, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button, EmptyState, Field, Input, Modal, ModalPresence, Notice, PageHeader, Panel, Select, Textarea } from '../components/ui'
import { isPhase2Unavailable } from '../lib/phase2'
import { readableError, supabase } from '../lib/supabase'
import { EVENT_TYPES, type AgendaEvent, type AgendaEventType, type Job } from '../lib/types'

type EventForm = { title: string; event_type: AgendaEventType; job_id: string; date: string; start_time: string; end_time: string; all_day: boolean; location: string; notes: string }
const emptyForm = (): EventForm => ({ title: '', event_type: 'appuntamento', job_id: '', date: format(new Date(), 'yyyy-MM-dd'), start_time: '09:00', end_time: '10:00', all_day: false, location: '', notes: '' })

export function AgendaPage() {
  const [events, setEvents] = useState<AgendaEvent[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const [view, setView] = useState<'calendar' | 'list'>('calendar')
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [editing, setEditing] = useState<AgendaEvent | 'new' | null>(null)
  const [form, setForm] = useState<EventForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    async function load() {
      if (!supabase) return
      const [eventResult, jobResult] = await Promise.all([
        supabase.from('agenda_events').select('*, job:jobs(id, title, code)').order('starts_at'),
        supabase.from('jobs').select('*').order('created_at', { ascending: false })
      ])
      if (eventResult.error) {
        setUnavailable(isPhase2Unavailable(eventResult.error))
        if (!isPhase2Unavailable(eventResult.error)) setError(readableError(eventResult.error))
      } else setEvents((eventResult.data ?? []) as AgendaEvent[])
      if (jobResult.error) setError(readableError(jobResult.error))
      else setJobs((jobResult.data ?? []) as Job[])
    }
    load()
  }, [])

  const calendarDays = useMemo(() => eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) }), [month])
  const visibleEvents = useMemo(() => selectedDay ? events.filter((event) => isSameDay(parseISO(event.starts_at), selectedDay)) : events, [events, selectedDay])

  function openNew(day?: Date) {
    const next = emptyForm()
    if (day) next.date = format(day, 'yyyy-MM-dd')
    setForm(next)
    setEditing('new')
  }

  function openEdit(event: AgendaEvent) {
    const start = parseISO(event.starts_at)
    const end = event.ends_at ? parseISO(event.ends_at) : null
    setForm({ title: event.title, event_type: event.event_type, job_id: event.job_id ?? '', date: format(start, 'yyyy-MM-dd'), start_time: format(start, 'HH:mm'), end_time: end ? format(end, 'HH:mm') : '', all_day: event.all_day, location: event.location ?? '', notes: event.notes ?? '' })
    setEditing(event)
  }

  async function saveEvent(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !editing) return
    const start = form.all_day ? new Date(`${form.date}T00:00:00`) : new Date(`${form.date}T${form.start_time}:00`)
    const end = form.all_day || !form.end_time ? null : new Date(`${form.date}T${form.end_time}:00`)
    if (end && end < start) return setError('L’orario di fine deve essere successivo a quello di inizio.')
    const payload = { title: form.title.trim(), event_type: form.event_type, job_id: form.job_id || null, starts_at: start.toISOString(), ends_at: end?.toISOString() ?? null, all_day: form.all_day, location: form.location.trim() || null, notes: form.notes.trim() || null }
    setSaving(true)
    const result = editing === 'new' ? await supabase.from('agenda_events').insert(payload).select('*, job:jobs(id, title, code)').single() : await supabase.from('agenda_events').update(payload).eq('id', editing.id).select('*, job:jobs(id, title, code)').single()
    setSaving(false)
    if (result.error) return setError(readableError(result.error))
    const saved = result.data as AgendaEvent
    setEvents((current) => (editing === 'new' ? [...current, saved] : current.map((item) => item.id === saved.id ? saved : item)).sort((a, b) => a.starts_at.localeCompare(b.starts_at)))
    setEditing(null)
  }

  async function toggleComplete(event: AgendaEvent) {
    if (!supabase) return
    const completed = !event.is_completed
    const { error: updateError } = await supabase.from('agenda_events').update({ is_completed: completed }).eq('id', event.id)
    if (updateError) return setError(readableError(updateError))
    setEvents((current) => current.map((item) => item.id === event.id ? { ...item, is_completed: completed } : item))
  }

  async function deleteEvent(event: AgendaEvent) {
    if (!supabase || !window.confirm(`Eliminare “${event.title}”?`)) return
    const { error: deleteError } = await supabase.from('agenda_events').delete().eq('id', event.id)
    if (deleteError) return setError(readableError(deleteError))
    setEvents((current) => current.filter((item) => item.id !== event.id))
    setEditing(null)
  }

  return <div>
    <PageHeader eyebrow="Pianificazione" title="Agenda" description="Appuntamenti, sopralluoghi, ritiri e consegne collegati alle commesse." action={!unavailable ? <Button onClick={() => openNew()}><Plus size={17} /> Nuovo evento</Button> : undefined} />
    {error && <div className="mb-5"><Notice tone="error">{error}</Notice></div>}
    {unavailable ? <Notice>Per attivare l’agenda applica su Supabase la migrazione <strong>002_phase2_operations.sql</strong>. Nessuna modifica al database remoto è stata eseguita dall’app.</Notice> : <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="inline-flex rounded-xl bg-white p-1 shadow-sm"><button onClick={() => setView('calendar')} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${view === 'calendar' ? 'bg-brand text-white' : 'text-muted'}`}><CalendarDays size={16} /> Calendario</button><button onClick={() => setView('list')} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${view === 'list' ? 'bg-brand text-white' : 'text-muted'}`}><List size={16} /> Elenco</button></div>{selectedDay && <button className="text-sm font-semibold text-brand" onClick={() => setSelectedDay(null)}>Mostra tutti gli eventi</button>}</div>
      {view === 'calendar' ? <CalendarGrid month={month} days={calendarDays} events={events} onPrevious={() => setMonth(subMonths(month, 1))} onNext={() => setMonth(addMonths(month, 1))} onSelect={(day) => { setSelectedDay(day); if (window.innerWidth < 640) setView('list') }} onCreate={openNew} /> : <EventList events={visibleEvents} onEdit={openEdit} onToggle={toggleComplete} onNew={() => openNew(selectedDay ?? undefined)} />}
      {view === 'calendar' && selectedDay && <div className="mt-5"><EventList events={visibleEvents} onEdit={openEdit} onToggle={toggleComplete} onNew={() => openNew(selectedDay)} title={format(selectedDay, 'EEEE d MMMM', { locale: it })} /></div>}
    </>}
    <ModalPresence>{editing && <Modal title={editing === 'new' ? 'Nuovo evento' : 'Modifica evento'} onClose={() => setEditing(null)}><form className="grid gap-4" onSubmit={saveEvent}><Field label="Titolo"><Input required minLength={2} value={form.title} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Tipo"><Select value={form.event_type} onChange={(e) => setForm((current) => ({ ...current, event_type: e.target.value as AgendaEventType }))}>{EVENT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field><Field label="Commessa"><Select value={form.job_id} onChange={(e) => setForm((current) => ({ ...current, job_id: e.target.value }))}><option value="">Nessuna commessa</option>{jobs.map((job) => <option key={job.id} value={job.id}>{job.code} · {job.title}</option>)}</Select></Field></div><Field label="Data"><Input required type="date" value={form.date} onChange={(e) => setForm((current) => ({ ...current, date: e.target.value }))} /></Field><label className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-white px-3.5 text-sm font-medium"><input type="checkbox" checked={form.all_day} onChange={(e) => setForm((current) => ({ ...current, all_day: e.target.checked }))} /> Tutto il giorno</label>{!form.all_day && <div className="grid grid-cols-2 gap-3"><Field label="Inizio"><Input required type="time" value={form.start_time} onChange={(e) => setForm((current) => ({ ...current, start_time: e.target.value }))} /></Field><Field label="Fine"><Input type="time" value={form.end_time} onChange={(e) => setForm((current) => ({ ...current, end_time: e.target.value }))} /></Field></div>}<Field label="Luogo"><Input value={form.location} onChange={(e) => setForm((current) => ({ ...current, location: e.target.value }))} /></Field><Field label="Note"><Textarea value={form.notes} onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))} /></Field><div className="flex flex-wrap justify-between gap-2">{editing !== 'new' ? <Button type="button" variant="danger" onClick={() => deleteEvent(editing)}><Trash2 size={16} /> Elimina</Button> : <span />}<div className="flex gap-2"><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Annulla</Button><Button type="submit" loading={saving}>Salva evento</Button></div></div></form></Modal>}</ModalPresence>
  </div>
}

function CalendarGrid({ month, days, events, onPrevious, onNext, onSelect, onCreate }: { month: Date; days: Date[]; events: AgendaEvent[]; onPrevious: () => void; onNext: () => void; onSelect: (day: Date) => void; onCreate: (day: Date) => void }) {
  return <Panel className="overflow-hidden p-0"><div className="flex items-center justify-between border-b border-line p-4"><button className="grid size-10 place-items-center rounded-xl hover:bg-stone-100" onClick={onPrevious} aria-label="Mese precedente"><ChevronLeft size={20} /></button><h2 className="type-card-title capitalize">{format(month, 'MMMM yyyy', { locale: it })}</h2><button className="grid size-10 place-items-center rounded-xl hover:bg-stone-100" onClick={onNext} aria-label="Mese successivo"><ChevronRight size={20} /></button></div><div className="grid grid-cols-7 border-b border-line bg-stone-50">{['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map((day) => <div key={day} className="p-2 text-center text-[13px] font-medium text-muted">{day}</div>)}</div><div className="grid grid-cols-7">{days.map((day) => { const dayEvents = events.filter((event) => isSameDay(parseISO(event.starts_at), day)); return <button key={day.toISOString()} onClick={() => onSelect(day)} onDoubleClick={() => onCreate(day)} className={`min-h-24 border-b border-r border-line p-1.5 text-left align-top hover:bg-brand-soft/30 sm:min-h-32 sm:p-2 ${!isSameMonth(day, month) ? 'bg-stone-50 text-stone-400' : ''}`}><span className={`inline-grid size-7 place-items-center rounded-full text-xs font-semibold ${isSameDay(day, new Date()) ? 'bg-brand text-white' : ''}`}>{format(day, 'd')}</span><div className="mt-1 grid gap-1">{dayEvents.slice(0, 3).map((event) => { const type = EVENT_TYPES.find((item) => item.value === event.event_type)!; return <span key={event.id} className={`truncate rounded px-1.5 py-1 text-[13px] font-semibold sm:text-[13px] ${event.is_completed ? 'bg-stone-100 text-stone-400 line-through' : 'bg-brand-soft text-brand'}`}><span className={`mr-1 inline-block size-1.5 rounded-full ${type.color}`} />{event.all_day ? '' : format(parseISO(event.starts_at), 'HH:mm ')}{event.title}</span>})}{dayEvents.length > 3 && <span className="text-[13px] font-semibold text-muted">+{dayEvents.length - 3} altri</span>}</div></button>})}</div><p className="px-4 py-3 text-xs text-muted">Doppio clic su un giorno per aggiungere un evento.</p></Panel>
}

function EventList({ events, onEdit, onToggle, onNew, title = 'Tutti gli eventi' }: { events: AgendaEvent[]; onEdit: (event: AgendaEvent) => void; onToggle: (event: AgendaEvent) => void; onNew: () => void; title?: string }) {
  return <Panel><div className="mb-4 flex items-center justify-between gap-3"><h2 className="type-panel-title capitalize">{title}</h2><Button variant="secondary" onClick={onNew}><Plus size={16} /> Aggiungi</Button></div>{events.length === 0 ? <EmptyState icon={<CalendarDays size={22} />} title="Nessun evento" description="Non ci sono attività pianificate per questa selezione." /> : <div className="divide-y divide-line">{events.map((event) => { const type = EVENT_TYPES.find((item) => item.value === event.event_type)!; return <article key={event.id} className={`flex items-start gap-3 py-4 ${event.is_completed ? 'opacity-60' : ''}`}><button onClick={() => onToggle(event)} className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border ${event.is_completed ? 'border-brand bg-brand text-white' : 'border-line text-stone-400'}`} aria-label={event.is_completed ? 'Segna da fare' : 'Segna completato'}>{event.is_completed ? <Check size={17} /> : <span className={`size-2.5 rounded-full ${type.color}`} />}</button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className={`font-semibold ${event.is_completed ? 'line-through' : ''}`}>{event.title}</h3><span className="rounded-full bg-stone-100 px-2 py-0.5 text-[13px] font-medium text-muted">{type.label}</span></div><p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted"><span className="inline-flex items-center gap-1"><Clock3 size={13} /> {format(parseISO(event.starts_at), event.all_day ? 'EEEE d MMMM yyyy' : "EEEE d MMMM yyyy 'alle' HH:mm", { locale: it })}</span>{event.location && <span className="inline-flex items-center gap-1"><MapPin size={13} /> {event.location}</span>}</p>{event.job && <Link className="mt-1 inline-block text-xs font-semibold text-brand hover:underline" to={`/lavori/${event.job.id}`}>{event.job.code} · {event.job.title}</Link>}</div><button onClick={() => onEdit(event)} className="grid size-9 place-items-center rounded-xl text-stone-400 hover:bg-stone-100 hover:text-brand" aria-label="Modifica evento"><Pencil size={16} /></button></article>})}</div>}</Panel>
}
