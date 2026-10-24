import { ArrowLeft, Download, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Field, Input, Notice, Panel, Select, Textarea } from '../components/ui'
import { formatDate, money } from '../lib/format'
import { calculateQuoteTotals } from '../lib/phase2'
import { generateQuotePdf } from '../lib/quotePdf'
import { readableError, supabase } from '../lib/supabase'
import { QUOTE_STATUSES, type Customer, type Job, type Quote, type QuoteItem, type QuoteStatus } from '../lib/types'
import { recordSuccessfulOperation } from '../lib/adaptive/usage'
import { QuoteItemEditor } from '../components/QuoteItemEditor'
import { surfaceQuantity } from '../lib/quoteSurface'
import { useAuth } from '../contexts/AuthContext'

export function QuoteEditorPage() {
  const { user } = useAuth()
  const { id: jobId, quoteId } = useParams()
  const navigate = useNavigate()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [items, setItems] = useState<QuoteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [surfaceReady, setSurfaceReady] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    async function load() {
      if (!supabase || !jobId || !quoteId) return
      const [quoteResult, itemResult, jobResult] = await Promise.all([
        supabase.from('quotes').select('*').eq('id', quoteId).eq('job_id', jobId).single(),
        supabase.from('quote_items').select('*').eq('quote_id', quoteId).order('sort_order'),
        supabase.from('jobs').select('*, customer:customers(*)').eq('id', jobId).single()
      ])
      if (quoteResult.error || itemResult.error || jobResult.error) {
        setMessage({ tone: 'error', text: readableError(quoteResult.error || itemResult.error || jobResult.error) })
      } else {
        setQuote(quoteResult.data as Quote)
        const probe = await supabase.from('quote_items').select('calculation_mode').limit(0)
        setSurfaceReady(!probe.error)
        setItems((itemResult.data ?? []) as QuoteItem[])
        const loadedJob = jobResult.data as Job & { customer?: Customer | null }
        setJob(loadedJob)
        setCustomer(loadedJob.customer ?? null)
      }
      setLoading(false)
    }
    load()
  }, [jobId, quoteId])

  const totals = useMemo(() => quote ? calculateQuoteTotals(items, quote.labor_hours, quote.hourly_rate, quote.transport_cost, quote.other_costs, quote.margin_percent) : null, [items, quote])

  function updateQuote<K extends keyof Quote>(key: K, value: Quote[K]) {
    setQuote((current) => current ? { ...current, [key]: value } : current)
  }

  async function addItem() {
    if (!supabase || !quoteId) return
    const { data, error } = await supabase.from('quote_items').insert({ quote_id: quoteId, description: 'Nuovo materiale', quantity: 1, unit: 'pz', unit_price: 0, sort_order: items.length }).select().single()
    if (error) return setMessage({ tone: 'error', text: readableError(error) })
    recordSuccessfulOperation(user?.id, 'quote.item_created')
    setItems((current) => [...current, data as QuoteItem])
  }

  async function removeItem(itemId: string) {
    if (!supabase || !window.confirm('Rimuovere questa voce dal preventivo?')) return
    const { error } = await supabase.from('quote_items').delete().eq('id', itemId)
    if (error) return setMessage({ tone: 'error', text: readableError(error) })
    recordSuccessfulOperation(user?.id, 'quote.item_deleted')
    setItems((current) => current.filter((item) => item.id !== itemId))
  }

  async function saveQuote(showSuccess = true) {
    if (!supabase || !quote || !totals) return false
    try {
      for (const item of items) {
        if (!item.description.trim() || !item.unit.trim() || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || !Number.isFinite(Number(item.unit_price)) || Number(item.unit_price) < 0) throw new Error('Completa descrizione, quantità, unità e prezzo di tutte le voci.')
        if (item.calculation_mode === 'surface') surfaceQuantity(item)
        if ((item.calculation_mode === 'surface' || item.item_kind === 'service')
          && (Number(item.unit_price) >= 1e10 || Math.abs(Number(item.unit_price) * 100 - Math.round(Number(item.unit_price) * 100)) > 0.00001)) throw new Error('Per le nuove lavorazioni indica un prezzo valido con al massimo due decimali.')
      }
    } catch (error) { setMessage({ tone: 'error', text: readableError(error) }); return false }
    const client = supabase
    if (Number(quote.labor_hours) > 0 && items.some(item => item.calculation_mode === 'surface' && item.labor_included)
      && !window.confirm(`Confermi che le ${quote.labor_hours} ore aggiuntive escludono il lavoro già compreso nelle tariffe al m²?`)) return false
    setSaving(true)
    setMessage(null)
    const quotePayload = {
      title: quote.title,
      status: quote.status,
      quote_date: quote.quote_date,
      valid_until: quote.valid_until || null,
      labor_hours: Number(quote.labor_hours),
      hourly_rate: Number(quote.hourly_rate),
      transport_cost: Number(quote.transport_cost),
      other_costs: Number(quote.other_costs),
      margin_percent: Number(quote.margin_percent),
      subtotal: totals.subtotal,
      margin_amount: totals.marginAmount,
      total: totals.total,
      notes: quote.notes || null,
      terms: quote.terms || null
    }
    const [quoteResult, ...itemResults] = await Promise.all([
      client.from('quotes').update(quotePayload).eq('id', quote.id).select().single(),
      ...items.map((item, index) => client.from('quote_items').update({ description: item.description, quantity: Number(item.quantity), unit: item.unit, unit_price: Number(item.unit_price), sort_order: index, ...(surfaceReady ? { calculation_mode: item.calculation_mode ?? 'manual', item_kind: item.item_kind ?? 'material', width_cm: item.width_cm ?? null, height_cm: item.height_cm ?? null, element_count: item.element_count ?? null, faces: item.faces ?? null, labor_included: item.labor_included ?? false } : {}) }).eq('id', item.id))
    ])
    setSaving(false)
    const firstError = quoteResult.error || itemResults.find((result) => result.error)?.error
    if (firstError) {
      setMessage({ tone: 'error', text: readableError(firstError) })
      return false
    }
    recordSuccessfulOperation(user?.id, 'quote.updated')
    setQuote(quoteResult.data as Quote)
    if (showSuccess) setMessage({ tone: 'success', text: 'Preventivo salvato.' })
    return true
  }

  async function downloadPdf() {
    if (!quote || !job || !totals) return
    const saved = await saveQuote(false)
    if (!saved) return
    await generateQuotePdf({ quote: { ...quote, subtotal: totals.subtotal, margin_amount: totals.marginAmount, total: totals.total }, items, job, customer })
    setMessage({ tone: 'success', text: 'PDF generato e scaricato.' })
  }

  async function deleteQuote() {
    if (!supabase || !quote || !jobId || !window.confirm('Eliminare definitivamente questo preventivo?')) return
    const { error } = await supabase.from('quotes').delete().eq('id', quote.id)
    if (error) return setMessage({ tone: 'error', text: readableError(error) })
    recordSuccessfulOperation(user?.id, 'quote.deleted')
    navigate(`/lavori/${jobId}`, { replace: true })
  }

  if (loading) return <div className="h-80 animate-pulse rounded-2xl bg-white" />
  if (!quote || !job || !totals) return <Notice tone="error">{message?.text ?? 'Preventivo non trovato.'}</Notice>

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><Link className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand" to={`/lavori/${job.id}`}><ArrowLeft size={18} /> Scheda commessa</Link><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={downloadPdf}><Download size={17} /> PDF</Button><Button onClick={() => saveQuote()} loading={saving}><Save size={17} /> Salva</Button></div></div>
      {message && <div className="mb-5"><Notice tone={message.tone}>{message.text}</Notice></div>}
      <header className="mb-6"><div className="flex flex-wrap items-center gap-2"><span className="type-meta tabular-nums text-muted">{quote.code}</span><span className="text-xs text-muted">Commessa {job.code}</span></div><h1 className="mt-2 type-page-title">Modifica preventivo</h1><p className="mt-2 text-sm text-muted">{customer?.display_name ?? 'Nessun cliente associato'} · creato il {formatDate(quote.quote_date)}</p></header>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
        <div className="grid gap-6">
          <Panel>
            <div className="grid gap-5 sm:grid-cols-2"><Field label="Titolo"><Input value={quote.title} onChange={(e) => updateQuote('title', e.target.value)} /></Field><Field label="Stato"><Select value={quote.status} onChange={(e) => updateQuote('status', e.target.value as QuoteStatus)}>{QUOTE_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field><Field label="Data preventivo"><Input type="date" value={quote.quote_date} onChange={(e) => updateQuote('quote_date', e.target.value)} /></Field><Field label="Valido fino al"><Input type="date" value={quote.valid_until ?? ''} onChange={(e) => updateQuote('valid_until', e.target.value || null)} /></Field></div>
          </Panel>
          <Panel>
            <div className="mb-4 flex items-center justify-between gap-3"><div><p className="section-kicker">Voci</p><h2 className="type-panel-title">Materiali e prestazioni</h2></div><Button variant="secondary" onClick={addItem}><Plus size={17} /> Aggiungi</Button></div>
            {!surfaceReady && <Notice>Il calcolo a superficie richiede l’aggiornamento del database. Le voci esistenti restano modificabili.</Notice>}
            <p className="mb-3 text-sm text-muted">Inserisci telai, ferramenta, trattamenti e altre lavorazioni come voci separate.</p>
            <div className="grid gap-3">{items.map(item => surfaceReady ? <QuoteItemEditor key={item.id} item={item} onChange={updated => setItems(current => current.map(row => row.id === updated.id ? updated : row))} onRemove={() => void removeItem(item.id)} /> : <div key={item.id} className="grid gap-3 rounded-xl border border-line p-3"><Field label="Descrizione"><Input value={item.description} onChange={e => setItems(current => current.map(row => row.id === item.id ? { ...row, description: e.target.value } : row))} /></Field><Field label="Quantità"><Input type="number" min="0.001" step="0.001" value={item.quantity} onChange={e => setItems(current => current.map(row => row.id === item.id ? { ...row, quantity: Number(e.target.value) } : row))} /></Field><Field label="Unità"><Input value={item.unit} onChange={e => setItems(current => current.map(row => row.id === item.id ? { ...row, unit: e.target.value } : row))} /></Field><Field label="Prezzo unitario"><Input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => setItems(current => current.map(row => row.id === item.id ? { ...row, unit_price: Number(e.target.value) } : row))} /></Field><Button variant="secondary" onClick={() => void removeItem(item.id)}>Rimuovi voce</Button></div>)}</div>
          </Panel>
          <Panel><div className="grid gap-5 sm:grid-cols-2"><Field label="Note per il cliente"><Textarea value={quote.notes ?? ''} onChange={(e) => updateQuote('notes', e.target.value || null)} /></Field><Field label="Condizioni"><Textarea value={quote.terms ?? ''} onChange={(e) => updateQuote('terms', e.target.value || null)} placeholder="Tempi, modalità di pagamento, esclusioni…" /></Field></div></Panel>
        </div>
        <div className="grid content-start gap-6">
          <Panel><p className="section-kicker">Calcolo</p><h2 className="type-panel-title">Riepilogo</h2><div className="mt-5 grid gap-4"><div className="grid grid-cols-2 gap-3"><Notice>Le ore qui indicate sono aggiuntive. Non includere il tempo già compreso nelle tariffe al m².</Notice><Field label="Ore aggiuntive"><Input type="number" min="0" step="0.25" value={quote.labor_hours} onChange={(e) => updateQuote('labor_hours', Number(e.target.value))} /></Field><Field label="€/ora"><Input type="number" min="0" step="0.5" value={quote.hourly_rate} onChange={(e) => updateQuote('hourly_rate', Number(e.target.value))} /></Field></div><Field label="Trasporto"><Input type="number" min="0" step="0.01" value={quote.transport_cost} onChange={(e) => updateQuote('transport_cost', Number(e.target.value))} /></Field><Field label="Altre spese"><Input type="number" min="0" step="0.01" value={quote.other_costs} onChange={(e) => updateQuote('other_costs', Number(e.target.value))} /></Field><Field label="Margine aggiuntivo (%)"><Input type="number" min="0" step="0.5" value={quote.margin_percent} onChange={(e) => updateQuote('margin_percent', Number(e.target.value))} /></Field></div><div className="mt-6 space-y-2 border-t border-line pt-4 text-sm"><Summary label="Materiali" value={totals.materials} /><Summary label="Prestazioni" value={totals.services} /><Summary label="Manodopera aggiuntiva" value={totals.labor} /><Summary label="Spese" value={Number(quote.transport_cost) + Number(quote.other_costs)} /><Summary label="Margine" value={totals.marginAmount} /><div className="flex items-center justify-between border-t border-line pt-3 type-card-title type-amount text-brand"><span>Totale</span><span>{money.format(totals.total)}</span></div></div></Panel>
          <Button variant="danger" onClick={deleteQuote}><Trash2 size={17} /> Elimina preventivo</Button>
        </div>
      </div>
    </div>
  )
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="flex justify-between gap-4"><span className="text-muted">{label}</span><span className="font-semibold">{money.format(value)}</span></div>
}
