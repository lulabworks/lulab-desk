import { DatabaseBackup, Download, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Field, Input, Notice, PageHeader, Panel } from '../components/ui'
import { readableError, supabase } from '../lib/supabase'
import { isPhase3Unavailable } from '../lib/phase3'
import { isPublicSiteUnavailable } from '../lib/site'

export function MorePage() {
  const [hourlyRate, setHourlyRate] = useState(35)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    async function load() {
      if (!supabase) return
      const { data } = await supabase.from('user_settings').select('hourly_rate').single()
      if (data) setHourlyRate(Number(data.hourly_rate))
    }
    load()
  }, [])

  async function saveSettings() {
    if (!supabase) return
    setSaving(true)
    setMessage(null)
    const { error } = await supabase.from('user_settings').upsert({ hourly_rate: hourlyRate })
    setSaving(false)
    setMessage(error ? { tone: 'error', text: readableError(error) } : { tone: 'success', text: 'Impostazioni salvate.' })
  }

  async function exportData() {
    if (!supabase) return
    setExporting(true)
    setMessage(null)
    const [customers, jobs, tasks, settings, files, quotes, quoteItems, agendaEvents, timeEntries, expenses, payments] = await Promise.all([
      supabase.from('customers').select('*'),
      supabase.from('jobs').select('*'),
      supabase.from('job_tasks').select('*'),
      supabase.from('user_settings').select('*'),
      supabase.from('job_files').select('*'),
      supabase.from('quotes').select('*'),
      supabase.from('quote_items').select('*'),
      supabase.from('agenda_events').select('*'),
      supabase.from('time_entries').select('*'),
      supabase.from('job_expenses').select('*'),
      supabase.from('job_payments').select('*')
    ])
    const phase3 = await Promise.all([supabase.from('material_categories').select('*'), supabase.from('suppliers').select('*'), supabase.from('materials').select('*'), supabase.from('material_movements').select('*'), supabase.from('recovered_items').select('*'), supabase.from('recovered_item_files').select('*'), supabase.from('recovery_time_entries').select('*'), supabase.from('recovery_expenses').select('*'), supabase.from('external_collaborators').select('*'), supabase.from('antitarlo_treatments').select('*')])
    const site = await Promise.all([supabase.from('site_collection_items').select('*'), supabase.from('site_collection_item_sources').select('*'), supabase.from('site_collection_images').select('*'), supabase.from('site_portfolio_projects').select('*'), supabase.from('site_portfolio_project_sources').select('*'), supabase.from('site_portfolio_images').select('*'), supabase.from('customer_inquiries').select('*'), supabase.from('customer_inquiry_files').select('*')])
    const baseError = customers.error || jobs.error || tasks.error || settings.error || files.error || quotes.error || quoteItems.error || agendaEvents.error || timeEntries.error || expenses.error || payments.error
    const phase3Error = phase3.find((result) => result.error)?.error
    const siteError = site.find((result) => result.error)?.error
    const firstError = baseError || (phase3Error && !isPhase3Unavailable(phase3Error) ? phase3Error : null) || (siteError && !isPublicSiteUnavailable(siteError) ? siteError : null)
    if (firstError) {
      setMessage({ tone: 'error', text: readableError(firstError) })
    } else {
      const payload = { exported_at: new Date().toISOString(), customers: customers.data, jobs: jobs.data, job_tasks: tasks.data, user_settings: settings.data, job_files: files.data, quotes: quotes.data, quote_items: quoteItems.data, agenda_events: agendaEvents.data, time_entries: timeEntries.data, job_expenses: expenses.data, job_payments: payments.data, ...(!phase3Error ? { material_categories: phase3[0].data, suppliers: phase3[1].data, materials: phase3[2].data, material_movements: phase3[3].data, recovered_items: phase3[4].data, recovered_item_files: phase3[5].data, recovery_time_entries: phase3[6].data, recovery_expenses: phase3[7].data, external_collaborators: phase3[8].data, antitarlo_treatments: phase3[9].data } : {}), ...(!siteError ? { site_collection_items: site[0].data, site_collection_item_sources: site[1].data, site_collection_images: site[2].data, site_portfolio_projects: site[3].data, site_portfolio_project_sources: site[4].data, site_portfolio_images: site[5].data, customer_inquiries: site[6].data, customer_inquiry_files: site[7].data } : {}) }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `lulab-desk-export-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      setMessage({ tone: 'success', text: 'Esportazione completata.' })
    }
    setExporting(false)
  }

  return (
    <div>
      <PageHeader eyebrow="Configurazione" title="Impostazioni" description="Gestisci le preferenze generali e l’esportazione dei dati di LuLab Desk." />
      {message && <div className="mb-5"><Notice tone={message.tone}>{message.text}</Notice></div>}
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel>
          <div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-brand-soft text-brand"><Settings size={21} /></div><div><p className="section-kicker">Configurazione</p><h2 className="type-panel-title">Tariffe e costi</h2></div></div>
          <p className="mt-4 text-sm leading-6 text-muted">È usata nei preventivi, nel cronometro e per distinguere le spese vive dal valore del tempo lavorato.</p>
          <div className="mt-5 max-w-xs"><Field label="Tariffa oraria predefinita (€ / ora)"><Input type="number" min="0" step="0.5" value={hourlyRate} onChange={(e) => setHourlyRate(Number(e.target.value))} /></Field></div>
          <Button className="mt-4" onClick={saveSettings} loading={saving}>Salva tariffa</Button>
        </Panel>
        <Panel>
          <div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-blue-100 text-blue-800"><DatabaseBackup size={21} /></div><div><p className="section-kicker">Portabilità</p><h2 className="type-panel-title">Dati ed esportazione</h2></div></div>
          <p className="mt-4 text-sm leading-6 text-muted">Scarica in formato JSON i dati e i metadati registrati nel gestionale. Fotografie, allegati e altri file binari non sono inclusi: questa esportazione non costituisce un backup completo.</p>
          <Button className="mt-5" variant="secondary" onClick={exportData} loading={exporting}><Download size={17} /> Esporta JSON</Button>
        </Panel>
      </div>
    </div>
  )
}
