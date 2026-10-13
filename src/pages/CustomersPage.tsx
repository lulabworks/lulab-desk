import { Mail, MapPin, Phone, Plus, Search, Users } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { z } from 'zod'
import { Button, EmptyState, Field, Input, Modal, ModalPresence, Notice, PageHeader, Textarea } from '../components/ui'
import { readableError, supabase } from '../lib/supabase'
import type { Customer } from '../lib/types'

interface CustomerWithJobs extends Customer { jobs?: Array<{ id: string; status: string }> }

const customerSchema = z.object({
  display_name: z.string().trim().min(2, 'Inserisci il nome del cliente.').max(160),
  phone: z.string().trim().max(40).nullable(),
  email: z.union([z.literal(''), z.string().email('Inserisci un indirizzo email valido.')]).nullable(),
  address: z.string().trim().max(500).nullable(),
  notes: z.string().trim().max(3000).nullable()
})

const emptyForm = { display_name: '', phone: '', email: '', address: '', notes: '' }

export function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerWithJobs[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<CustomerWithJobs | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    async function load() {
      if (!supabase) return
      const { data, error: loadError } = await supabase.from('customers').select('*, jobs(id, status)').order('display_name')
      setCustomers((data ?? []) as CustomerWithJobs[])
      setError(loadError ? readableError(loadError) : '')
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('it')
    return customers.filter((customer) => `${customer.display_name} ${customer.phone ?? ''} ${customer.email ?? ''} ${customer.address ?? ''}`.toLocaleLowerCase('it').includes(needle))
  }, [customers, query])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(customer: CustomerWithJobs) {
    setEditing(customer)
    setForm({ display_name: customer.display_name, phone: customer.phone ?? '', email: customer.email ?? '', address: customer.address ?? '', notes: customer.notes ?? '' })
    setFormError('')
    setModalOpen(true)
  }

  async function saveCustomer(event: FormEvent) {
    event.preventDefault()
    const payload = { ...form, phone: form.phone || null, email: form.email || null, address: form.address || null, notes: form.notes || null }
    const parsed = customerSchema.safeParse(payload)
    if (!parsed.success) return setFormError(parsed.error.issues[0].message)
    if (!supabase) return
    setSaving(true)
    const queryBuilder = editing
      ? supabase.from('customers').update(parsed.data).eq('id', editing.id)
      : supabase.from('customers').insert(parsed.data)
    const { data, error: saveError } = await queryBuilder.select('*, jobs(id, status)').single()
    setSaving(false)
    if (saveError) return setFormError(readableError(saveError))
    setCustomers((current) => editing ? current.map((item) => item.id === editing.id ? data as CustomerWithJobs : item).sort((a, b) => a.display_name.localeCompare(b.display_name)) : [...current, data as CustomerWithJobs].sort((a, b) => a.display_name.localeCompare(b.display_name)))
    setModalOpen(false)
  }

  async function deleteCustomer() {
    if (!editing || !supabase || !window.confirm(`Eliminare ${editing.display_name}? Le commesse resteranno disponibili ma senza cliente associato.`)) return
    const { error: deleteError } = await supabase.from('customers').delete().eq('id', editing.id)
    if (deleteError) return setFormError(readableError(deleteError))
    setCustomers((current) => current.filter((item) => item.id !== editing.id))
    setModalOpen(false)
  }

  return (
    <div>
      <PageHeader eyebrow="Rubrica" title="Clienti" description="Contatti e storico lavori senza duplicazioni." action={<Button onClick={openCreate}><Plus size={18} /> Nuovo cliente</Button>} />
      {error && <div className="mb-5"><Notice tone="error">{error}</Notice></div>}
      <div className="relative mb-5 max-w-xl"><Search className="absolute left-3.5 top-3.5 text-stone-400" size={18} /><Input className="pl-10" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca nome, telefono, email…" aria-label="Cerca clienti" /></div>
      {!loading && filtered.length === 0 ? <EmptyState icon={<Users size={23} />} title={customers.length ? 'Nessun risultato' : 'Nessun cliente'} description={customers.length ? 'Prova a cambiare i termini della ricerca.' : 'Aggiungi il primo cliente e collegalo alle sue commesse.'} action={!customers.length ? <Button onClick={openCreate}><Plus size={17} /> Nuovo cliente</Button> : undefined} /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {loading ? Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-44 animate-pulse rounded-2xl bg-white" />) : filtered.map((customer) => {
            const activeJobs = (customer.jobs ?? []).filter((job) => !['concluso', 'annullato', 'non_confermato'].includes(job.status)).length
            return <button key={customer.id} onClick={() => openEdit(customer)} className="rounded-2xl border border-line bg-white p-5 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-start justify-between gap-4"><div className="grid size-11 place-items-center rounded-2xl bg-brand-soft type-card-title text-brand">{customer.display_name.slice(0, 2).toUpperCase()}</div><span className="rounded-full bg-stone-100 px-2.5 py-1 text-[13px] font-medium text-stone-600">{(customer.jobs ?? []).length} lavori</span></div><h2 className="mt-4 truncate type-card-title">{customer.display_name}</h2><div className="mt-3 grid gap-2 text-xs text-muted">{customer.phone && <span className="flex items-center gap-2"><Phone size={14} /> {customer.phone}</span>}{customer.email && <span className="flex items-center gap-2 truncate"><Mail size={14} /> {customer.email}</span>}{customer.address && <span className="flex items-center gap-2 truncate"><MapPin size={14} /> {customer.address}</span>}</div><p className="mt-4 border-t border-line pt-3 text-xs font-semibold text-brand">{activeJobs ? `${activeJobs} commess${activeJobs === 1 ? 'a attiva' : 'e attive'}` : 'Nessuna commessa attiva'}</p></button>
          })}
        </div>
      )}

      <ModalPresence>{modalOpen && <Modal title={editing ? 'Modifica cliente' : 'Nuovo cliente'} onClose={() => setModalOpen(false)}><form className="grid gap-4" onSubmit={saveCustomer}><Field label="Nome, cognome o ragione sociale"><Input autoFocus value={form.display_name} onChange={(e) => setForm((current) => ({ ...current, display_name: e.target.value }))} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Telefono"><Input type="tel" value={form.phone} onChange={(e) => setForm((current) => ({ ...current, phone: e.target.value }))} /></Field><Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))} /></Field></div><Field label="Indirizzo"><Input value={form.address} onChange={(e) => setForm((current) => ({ ...current, address: e.target.value }))} /></Field><Field label="Note"><Textarea className="min-h-24" value={form.notes} onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))} /></Field>{formError && <Notice tone="error">{formError}</Notice>}<div className="flex flex-wrap gap-3 pt-2">{editing && <Button type="button" variant="danger" onClick={deleteCustomer}>Elimina</Button>}<div className="ml-auto flex gap-3"><Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Annulla</Button><Button type="submit" loading={saving}>Salva</Button></div></div></form></Modal>}</ModalPresence>
    </div>
  )
}
