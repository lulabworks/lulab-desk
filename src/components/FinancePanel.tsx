import { Banknote, CircleDollarSign, Plus, ReceiptText, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { buildJobExpenseInsert, buildJobPaymentInsert } from '../lib/finance'
import { formatDate, money, todayIso } from '../lib/format'
import { isPhase2Unavailable } from '../lib/phase2'
import { effectiveMaterialMovements, movementCost } from '../lib/phase3'
import { readableError, supabase } from '../lib/supabase'
import { EXPENSE_CATEGORIES, PAYMENT_KINDS, type ExpenseCategory, type Job, type JobExpense, type JobPayment, type MaterialMovement, type PaymentKind, type TimeEntry } from '../lib/types'
import { useAuth } from '../contexts/AuthContext'
import { recordSuccessfulOperation } from '../lib/adaptive/usage'
import { Button, EmptyState, Field, Input, Modal, ModalPresence, Notice, Panel, Select, Textarea } from './ui'

export function FinancePanel({ job }: { job: Job }) {
  const { user } = useAuth()
  const [expenses, setExpenses] = useState<JobExpense[]>([])
  const [payments, setPayments] = useState<JobPayment[]>([])
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [materialMovements, setMaterialMovements] = useState<MaterialMovement[]>([])
  const [dialog, setDialog] = useState<'expense' | 'payment' | null>(null)
  const [expense, setExpense] = useState({ category: 'materiali' as ExpenseCategory, description: '', amount: 0, incurred_on: todayIso(), supplier: '', notes: '' })
  const [payment, setPayment] = useState({ kind: 'acconto' as PaymentKind, amount: 0, paid_on: todayIso(), method: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    async function load() {
      if (!supabase) return
      const [expenseResult, paymentResult, timeResult] = await Promise.all([
        supabase.from('job_expenses').select('*').eq('job_id', job.id).order('incurred_on', { ascending: false }),
        supabase.from('job_payments').select('*').eq('job_id', job.id).order('paid_on', { ascending: false }),
        supabase.from('time_entries').select('*').eq('job_id', job.id)
      ])
      const firstError = expenseResult.error || paymentResult.error || timeResult.error
      if (firstError) {
        setUnavailable(isPhase2Unavailable(firstError))
        if (!isPhase2Unavailable(firstError)) setError(readableError(firstError))
        return
      }
      setExpenses((expenseResult.data ?? []) as JobExpense[])
      setPayments((paymentResult.data ?? []) as JobPayment[])
      setTimeEntries((timeResult.data ?? []) as TimeEntry[])
      const { data: movementData } = await supabase.from('material_movements').select('*').eq('job_id', job.id)
      setMaterialMovements((movementData ?? []) as MaterialMovement[])
    }
    load()
  }, [job.id])

  const summary = useMemo(() => {
    const forecast = Number(job.agreed_revenue || 0)
    const costs = expenses.reduce((sum, item) => sum + Number(item.amount), 0)
    const received = payments.reduce((sum, item) => sum + Number(item.amount), 0)
    const labor = timeEntries.reduce((sum, entry) => sum + (Number(entry.duration_minutes) / 60) * Number(entry.hourly_rate), 0)
    const materials = effectiveMaterialMovements(materialMovements).filter((item) => item.movement_type === 'consumo_commessa').reduce((sum, item) => sum + movementCost(item), 0)
    return { forecast, costs, received, labor, materials, outstanding: Math.max(forecast - received, 0), projectedMargin: forecast - costs - materials - labor, cashBalance: received - costs }
  }, [expenses, job.agreed_revenue, materialMovements, payments, timeEntries])

  async function addExpense(event: FormEvent) {
    event.preventDefault()
    if (!supabase || expense.amount <= 0 || !expense.description.trim()) return
    setSaving(true)
    const { data, error: addError } = await supabase.from('job_expenses').insert(buildJobExpenseInsert(job.id, expense)).select().single()
    setSaving(false)
    if (addError) return setError(readableError(addError))
    recordSuccessfulOperation(user?.id, 'finance.expense_created')
    setExpenses((current) => [data as JobExpense, ...current])
    setExpense({ category: 'materiali', description: '', amount: 0, incurred_on: todayIso(), supplier: '', notes: '' })
    setDialog(null)
  }

  async function addPayment(event: FormEvent) {
    event.preventDefault()
    if (!supabase || payment.amount <= 0) return
    setSaving(true)
    const { data, error: addError } = await supabase.from('job_payments').insert(buildJobPaymentInsert(job.id, payment)).select().single()
    setSaving(false)
    if (addError) return setError(readableError(addError))
    recordSuccessfulOperation(user?.id, 'finance.payment_created')
    setPayments((current) => [data as JobPayment, ...current])
    setPayment({ kind: 'acconto', amount: 0, paid_on: todayIso(), method: '', notes: '' })
    setDialog(null)
  }

  async function remove(table: 'job_expenses' | 'job_payments', id: string) {
    if (!supabase || !window.confirm('Eliminare questa registrazione?')) return
    const { error: removeError } = await supabase.from(table).delete().eq('id', id)
    if (removeError) return setError(readableError(removeError))
    recordSuccessfulOperation(user?.id, 'finance.entry_deleted')
    if (table === 'job_expenses') setExpenses((current) => current.filter((item) => item.id !== id))
    else setPayments((current) => current.filter((item) => item.id !== id))
  }

  return (
    <Panel>
      <div className="mb-5"><p className="section-kicker">Economia</p><h2 className="type-panel-title">Spese e incassi</h2></div>
      {unavailable ? <Notice>Applica la migrazione <strong>002_phase2_operations.sql</strong> per attivare consuntivo e pagamenti.</Notice> : <>
        {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
        <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3">
          <Metric label="Preventivo" value={summary.forecast} />
          <Metric label="Consuntivo costi" value={summary.costs + summary.materials + summary.labor} />
          <Metric label="Incassato" value={summary.received} />
          <Metric label="Da incassare" value={summary.outstanding} accent />
          <Metric label="Margine previsto" value={summary.projectedMargin} />
          <Metric label="Cassa netta" value={summary.cashBalance} />
        </div>
        <p className="mt-3 text-xs leading-5 text-muted">Il consuntivo somma spese ({money.format(summary.costs)}), materiali consumati ({money.format(summary.materials)}) e valore delle ore ({money.format(summary.labor)}). Gli acquisti di magazzino non vengono conteggiati di nuovo.</p>

        <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-2">
          <section className="min-w-0">
            <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><ReceiptText size={18} className="shrink-0 text-brand" /><h3 className="font-semibold">Spese</h3></div><Button className="min-h-9 shrink-0 px-3 py-1.5" variant="secondary" onClick={() => setDialog('expense')}><Plus size={15} /> Aggiungi</Button></div>
            {expenses.length === 0 ? <EmptyState icon={<ReceiptText size={21} />} title="Nessuna spesa" description="Registra materiali, servizi, trasporti e altre uscite." /> : <div className="min-w-0 divide-y divide-line">{expenses.map((item) => <div key={item.id} className="flex min-w-0 items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.description}</p><p className="mt-0.5 truncate text-xs text-muted">{EXPENSE_CATEGORIES.find((entry) => entry.value === item.category)?.label} · {formatDate(item.incurred_on)}</p></div><p className="shrink-0 text-sm font-semibold">{money.format(Number(item.amount))}</p><button className="grid size-8 shrink-0 place-items-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-700" onClick={() => remove('job_expenses', item.id)} aria-label="Elimina spesa"><Trash2 size={15} /></button></div>)}</div>}
          </section>
          <section className="min-w-0">
            <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><Banknote size={18} className="shrink-0 text-brand" /><h3 className="font-semibold">Pagamenti</h3></div><Button className="min-h-9 shrink-0 px-3 py-1.5" variant="secondary" onClick={() => setDialog('payment')}><Plus size={15} /> Aggiungi</Button></div>
            {payments.length === 0 ? <EmptyState icon={<CircleDollarSign size={21} />} title="Nessun pagamento" description="Registra acconti, saldo e altri importi incassati." /> : <div className="min-w-0 divide-y divide-line">{payments.map((item) => <div key={item.id} className="flex min-w-0 items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{PAYMENT_KINDS.find((entry) => entry.value === item.kind)?.label}</p><p className="mt-0.5 truncate text-xs text-muted">{formatDate(item.paid_on)}{item.method ? ` · ${item.method}` : ''}</p></div><p className="shrink-0 text-sm font-semibold text-emerald-700">{money.format(Number(item.amount))}</p><button className="grid size-8 shrink-0 place-items-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-700" onClick={() => remove('job_payments', item.id)} aria-label="Elimina pagamento"><Trash2 size={15} /></button></div>)}</div>}
          </section>
        </div>
      </>}
      <ModalPresence>{dialog === 'expense' && <Modal title="Registra una spesa" onClose={() => setDialog(null)}><form className="grid gap-4" onSubmit={addExpense}><Field label="Categoria"><Select value={expense.category} onChange={(e) => setExpense((current) => ({ ...current, category: e.target.value as ExpenseCategory }))}>{EXPENSE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field><Field label="Descrizione"><Input required minLength={2} value={expense.description} onChange={(e) => setExpense((current) => ({ ...current, description: e.target.value }))} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Importo"><Input required type="number" min="0.01" step="0.01" value={expense.amount} onChange={(e) => setExpense((current) => ({ ...current, amount: Number(e.target.value) }))} /></Field><Field label="Data"><Input required type="date" value={expense.incurred_on} onChange={(e) => setExpense((current) => ({ ...current, incurred_on: e.target.value }))} /></Field></div><Field label="Fornitore"><Input value={expense.supplier} onChange={(e) => setExpense((current) => ({ ...current, supplier: e.target.value }))} /></Field><Field label="Note"><Textarea value={expense.notes} onChange={(e) => setExpense((current) => ({ ...current, notes: e.target.value }))} /></Field><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Annulla</Button><Button type="submit" loading={saving}>Registra spesa</Button></div></form></Modal>}</ModalPresence>
      <ModalPresence>{dialog === 'payment' && <Modal title="Registra un pagamento" onClose={() => setDialog(null)}><form className="grid gap-4" onSubmit={addPayment}><Field label="Tipo"><Select value={payment.kind} onChange={(e) => setPayment((current) => ({ ...current, kind: e.target.value as PaymentKind }))}>{PAYMENT_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field><div className="grid grid-cols-2 gap-3"><Field label="Importo"><Input required type="number" min="0.01" step="0.01" value={payment.amount} onChange={(e) => setPayment((current) => ({ ...current, amount: Number(e.target.value) }))} /></Field><Field label="Data"><Input required type="date" value={payment.paid_on} onChange={(e) => setPayment((current) => ({ ...current, paid_on: e.target.value }))} /></Field></div><Field label="Metodo"><Input value={payment.method} onChange={(e) => setPayment((current) => ({ ...current, method: e.target.value }))} placeholder="Bonifico, contanti, carta…" /></Field><Field label="Note"><Textarea value={payment.notes} onChange={(e) => setPayment((current) => ({ ...current, notes: e.target.value }))} /></Field><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Annulla</Button><Button type="submit" loading={saving}>Registra pagamento</Button></div></form></Modal>}</ModalPresence>
    </Panel>
  )
}

function Metric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return <div className="min-w-0 rounded-xl bg-stone-50 p-3"><p className="break-words type-meta text-muted">{label}</p><p className={`mt-1 break-words text-xl type-amount [overflow-wrap:anywhere] ${accent ? 'text-brand' : value < 0 ? 'text-red-700' : ''}`}>{money.format(value)}</p></div>
}
