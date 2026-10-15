import { Bell, BellOff, CalendarClock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Field, Input, Notice, Panel, Select } from './ui'
import { useAuth } from '../contexts/AuthContext'
import { defaultPushPreferences, disablePushNotifications, enablePushNotifications, readPushDeviceStatus, type PushDeviceStatus, type PushPreferences } from '../lib/pushNotifications'
import { readableError, supabase } from '../lib/supabase'

const statusLabels: Record<PushDeviceStatus, string> = {
  active: 'Attive su questo dispositivo',
  disabled: 'Disattivate su questo dispositivo',
  blocked: 'Bloccate nelle impostazioni del browser',
  unsupported: 'Dispositivo o browser non compatibile',
  install_required: 'Su iPhone è necessario installare la PWA nella schermata Home',
  other_account: 'Registrato con un altro account su questo dispositivo'
}

export function PushNotificationSettings() {
  const { user } = useAuth()
  const [status, setStatus] = useState<PushDeviceStatus>('unsupported')
  const [preferences, setPreferences] = useState<PushPreferences>(defaultPushPreferences)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  async function refreshStatus() { setStatus(await readPushDeviceStatus()) }
  useEffect(() => { void refreshStatus() }, [])

  useEffect(() => {
    let cancelled = false
    async function loadPreferences() {
      if (!supabase || !user) return
      const { data, error } = await supabase.from('push_notification_preferences').select('*').eq('user_id', user.id).maybeSingle()
      if (cancelled) return
      if (error) { setMessage({ tone: 'error', text: readableError(error) }); return }
      if (data) setPreferences({ ...defaultPushPreferences, ...data })
    }
    void loadPreferences()
    return () => { cancelled = true }
  }, [user?.id])

  async function toggleDevice() {
    setBusy(true); setMessage(null)
    try {
      if (status === 'active' || status === 'other_account') await disablePushNotifications()
      else await enablePushNotifications()
      await refreshStatus()
      setMessage({ tone: 'success', text: status === 'active' || status === 'other_account' ? 'Notifiche rimosse da questo dispositivo.' : 'Notifiche attivate su questo dispositivo.' })
    } catch (error) {
      setMessage({ tone: 'error', text: readableError(error) })
      await refreshStatus()
    } finally { setBusy(false) }
  }

  async function savePreferences() {
    if (!supabase || !user) return
    setSaving(true); setMessage(null)
    const { error } = await supabase.from('push_notification_preferences').upsert({ user_id: user.id, ...preferences })
    setSaving(false)
    setMessage(error ? { tone: 'error', text: readableError(error) } : { tone: 'success', text: 'Preferenze di notifica salvate.' })
  }

  function setPreference<K extends keyof PushPreferences>(key: K, value: PushPreferences[K]) {
    setPreferences((current) => ({ ...current, [key]: value }))
  }

  return <Panel>
    <div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-brand-soft text-brand"><Bell size={21} /></div><div><p className="section-kicker">Promemoria</p><h2 className="type-panel-title">Notifiche</h2></div></div>
    <p className="mt-4 text-sm leading-6 text-muted">Le notifiche arrivano solo sui dispositivi che abiliti. I messaggi non includono recapiti o contenuti privati dei clienti.</p>
    <div className="mt-4 flex flex-wrap items-center gap-3"><Button variant={status === 'active' || status === 'other_account' ? 'secondary' : 'primary'} onClick={() => void toggleDevice()} loading={busy} disabled={status === 'unsupported' || status === 'install_required'}>{status === 'active' || status === 'other_account' ? <><BellOff size={17} /> Rimuovi dispositivo</> : <><Bell size={17} /> Attiva notifiche su questo dispositivo</>}</Button><span className="text-sm text-muted" role="status">{statusLabels[status]}</span></div>
    {message && <div className="mt-4"><Notice tone={message.tone}>{message.text}</Notice></div>}

    <div className="mt-6 grid gap-3">
      <CategoryToggle label="Nuove richieste dal sito" description="Solo per gli editor autorizzati nella sezione Sito." checked={preferences.site_inquiries_enabled} onChange={(value) => setPreference('site_inquiries_enabled', value)} />
      <CategoryToggle label="Appuntamenti e ritiri" description="Agenda e ritiri antitarlo non duplicati." checked={preferences.appointments_enabled} onChange={(value) => setPreference('appointments_enabled', value)} />
      <CategoryToggle label="Consegne imminenti" description="Commesse confermate con una consegna prevista." checked={preferences.job_deliveries_enabled} onChange={(value) => setPreference('job_deliveries_enabled', value)} />
      <CategoryToggle label="Preventivi in attesa" description="Un solo promemoria per ciascun nuovo invio." checked={preferences.quotes_enabled} onChange={(value) => setPreference('quotes_enabled', value)} />
    </div>

    <div className="mt-5 grid gap-4 rounded-2xl bg-stone-50 p-4 sm:grid-cols-3">
      <ReminderTiming label="Appuntamenti" days={preferences.appointment_days_before} hour={preferences.appointment_hour} dayKey="appointment_days_before" hourKey="appointment_hour" onChange={setPreference} />
      <ReminderTiming label="Consegne" days={preferences.delivery_days_before} hour={preferences.delivery_hour} dayKey="delivery_days_before" hourKey="delivery_hour" onChange={setPreference} />
      <ReminderTiming label="Preventivi" days={preferences.quote_days_after} hour={preferences.quote_hour} dayKey="quote_days_after" hourKey="quote_hour" onChange={setPreference} />
    </div>
    <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><CalendarClock size={14} /> Orari calcolati nel fuso Europe/Rome; l'ora segue automaticamente il cambio stagionale.</p>
    <Button variant="secondary" className="mt-4" onClick={() => void savePreferences()} loading={saving}>Salva preferenze notifiche</Button>
  </Panel>
}

function CategoryToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-line bg-white p-3.5">
    <span className="min-w-0"><span className="block text-sm font-semibold">{label}</span><span className="mt-0.5 block text-xs leading-5 text-muted">{description}</span></span>
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className="flex h-11 w-12 shrink-0 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"><span data-switch-track className={`relative block h-7 w-12 rounded-full transition-colors ${checked ? 'bg-brand' : 'bg-stone-300'}`}><span data-switch-thumb className={`absolute left-1 top-1 size-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} /></span></button>
  </div>
}

function ReminderTiming({ label, days, hour, dayKey, hourKey, onChange }: {
  label: string; days: number; hour: number; dayKey: 'appointment_days_before' | 'delivery_days_before' | 'quote_days_after'; hourKey: 'appointment_hour' | 'delivery_hour' | 'quote_hour';
  onChange: <K extends keyof PushPreferences>(key: K, value: PushPreferences[K]) => void
}) {
  const options = dayKey === 'quote_days_after' ? [3, 5, 7, 10, 14, 30] : [1, 2, 3, 5, 7, 14]
  return <div className="grid grid-cols-2 gap-3"><div className="col-span-2 text-sm font-semibold">{label}</div><Field label={dayKey === 'quote_days_after' ? 'Dopo (giorni)' : 'Prima (giorni)'}><Select value={days} onChange={(event) => onChange(dayKey, Number(event.target.value))}>{options.map((value) => <option key={value} value={value}>{value}</option>)}</Select></Field><Field label="Ora"><Input type="time" value={`${String(hour).padStart(2, '0')}:00`} onChange={(event) => onChange(hourKey, Number(event.target.value.split(':')[0]))} /></Field></div>
}
