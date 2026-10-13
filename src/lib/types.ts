export type JobType = 'restauro' | 'su_misura' | 'recupero' | 'antitarlo'

export type JobStatus =
  | 'nuova_richiesta'
  | 'preventivo_da_preparare'
  | 'preventivo_inviato'
  | 'confermato'
  | 'da_iniziare'
  | 'in_lavorazione'
  | 'in_attesa'
  | 'pronto_consegna'
  | 'consegnato'
  | 'concluso'
  | 'non_confermato'
  | 'annullato'

export interface Customer {
  id: string
  user_id: string
  display_name: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Job {
  id: string
  user_id: string
  customer_id: string | null
  code: string
  title: string
  type: JobType
  description: string | null
  notes: string | null
  technical_details: string | null
  status: JobStatus
  opened_at: string
  due_date: string | null
  completed_at: string | null
  agreed_revenue: number
  payments_received: number
  created_at: string
  updated_at: string
  customer?: Pick<Customer, 'id' | 'display_name' | 'phone'> | null
}

export interface JobTask {
  id: string
  user_id: string
  job_id: string
  title: string
  is_completed: boolean
  sort_order: number
  completed_at: string | null
  created_at: string
}

export type JobFileCategory = 'prima' | 'durante' | 'dopo' | 'documento'
export type QuoteStatus = 'bozza' | 'inviato' | 'accettato' | 'rifiutato'
export type AgendaEventType = 'appuntamento' | 'sopralluogo' | 'ritiro' | 'consegna' | 'lavorazione' | 'scadenza'
export type ExpenseCategory = 'materiali' | 'servizi' | 'trasporto' | 'altro'
export type PaymentKind = 'acconto' | 'saldo' | 'altro'
export type MaterialMovementType = 'carico' | 'scarico' | 'rettifica' | 'consumo_commessa' | 'consumo_recupero'
export type RecoveredItemStatus = 'acquisito' | 'da_restaurare' | 'in_restauro' | 'pronto' | 'in_vendita' | 'venduto'
export type AntitarloStatus = 'da_programmare' | 'ritirato' | 'dal_collaboratore' | 'in_rientro' | 'pronto_riconsegna' | 'riconsegnato' | 'annullato'

export interface JobFile {
  id: string
  user_id: string
  job_id: string
  category: JobFileCategory
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  note: string | null
  created_at: string
  signed_url?: string
}

export interface Quote {
  id: string
  user_id: string
  job_id: string
  code: string
  title: string
  status: QuoteStatus
  quote_date: string
  valid_until: string | null
  labor_hours: number
  hourly_rate: number
  transport_cost: number
  other_costs: number
  margin_percent: number
  subtotal: number
  margin_amount: number
  total: number
  notes: string | null
  terms: string | null
  created_at: string
  updated_at: string
}

export interface QuoteItem {
  id: string
  user_id: string
  quote_id: string
  description: string
  quantity: number
  unit: string
  unit_price: number
  sort_order: number
  created_at: string
  updated_at: string
}

export interface AgendaEvent {
  id: string
  user_id: string
  job_id: string | null
  title: string
  event_type: AgendaEventType
  starts_at: string
  ends_at: string | null
  all_day: boolean
  location: string | null
  notes: string | null
  is_completed: boolean
  created_at: string
  updated_at: string
  job?: Pick<Job, 'id' | 'title' | 'code'> | null
  antitarlo_treatment_id?: string | null
}

export interface TimeEntry {
  id: string
  user_id: string
  job_id: string
  work_date: string
  started_at: string | null
  ended_at: string | null
  duration_minutes: number
  hourly_rate: number
  notes: string | null
  is_running: boolean
  created_at: string
  updated_at: string
}

export interface JobExpense {
  id: string
  user_id: string
  job_id: string
  category: ExpenseCategory
  description: string
  amount: number
  incurred_on: string
  supplier: string | null
  notes: string | null
  created_at: string
  updated_at: string
  antitarlo_treatment_id?: string | null
}

export interface JobPayment {
  id: string
  user_id: string
  job_id: string
  kind: PaymentKind
  amount: number
  paid_on: string
  method: string | null
  notes: string | null
  created_at: string
  updated_at: string
  antitarlo_treatment_id?: string | null
}

export interface MaterialCategory { id: string; user_id: string; name: string; created_at: string }
export interface Supplier { id: string; user_id: string; name: string; phone: string | null; email: string | null; address: string | null; notes: string | null; created_at: string; updated_at: string }
export interface Material {
  id: string; user_id: string; category_id: string | null; supplier_id: string | null; code: string | null; name: string; unit: string; unit_price: number; quantity_available: number; minimum_stock: number; notes: string | null; is_active: boolean; created_at: string; updated_at: string
  category?: Pick<MaterialCategory, 'id' | 'name'> | null
  supplier?: Pick<Supplier, 'id' | 'name'> | null
}
export interface MaterialMovement {
  id: string; user_id: string; material_id: string; movement_type: MaterialMovementType; quantity_delta: number; unit_cost_snapshot: number; occurred_on: string; job_id: string | null; recovered_item_id: string | null; supplier_id: string | null; reversal_of_id: string | null; notes: string | null; created_at: string
  material?: Pick<Material, 'id' | 'name' | 'unit'> | null
  job?: Pick<Job, 'id' | 'code' | 'title'> | null
}
export interface RecoveredItem {
  id: string; user_id: string; job_id: string | null; code: string; name: string; description: string | null; origin: string | null; acquired_on: string; acquisition_cost: number; initial_condition: string | null; required_work: string | null; expected_sale_price: number; actual_sale_price: number | null; sold_on: string | null; status: RecoveredItemStatus; location: string | null; is_archived: boolean; created_at: string; updated_at: string
  job?: Pick<Job, 'id' | 'code' | 'title' | 'agreed_revenue'> | null
}
export interface RecoveredItemFile { id: string; user_id: string; recovered_item_id: string; storage_path: string; file_name: string; mime_type: string; size_bytes: number; created_at: string; signed_url?: string }
export interface RecoveryTimeEntry { id: string; user_id: string; recovered_item_id: string; work_date: string; duration_minutes: number; hourly_rate: number; notes: string | null; created_at: string; updated_at: string }
export interface RecoveryExpense { id: string; user_id: string; recovered_item_id: string; description: string; amount: number; incurred_on: string; supplier: string | null; notes: string | null; created_at: string; updated_at: string }
export interface ExternalCollaborator { id: string; user_id: string; name: string; phone: string | null; email: string | null; notes: string | null; created_at: string; updated_at: string }
export interface AntitarloTreatment {
  id: string; user_id: string; job_id: string; customer_id: string | null; recovered_item_id: string | null; collaborator_id: string | null; furniture_description: string; pickup_date: string | null; collaborator_delivery_date: string | null; expected_return_date: string | null; customer_redelivery_date: string | null; status: AntitarloStatus; notes: string | null; created_at: string; updated_at: string
  job?: Pick<Job, 'id' | 'code' | 'title' | 'agreed_revenue' | 'payments_received'> | null
  customer?: Pick<Customer, 'id' | 'display_name'> | null
  collaborator?: Pick<ExternalCollaborator, 'id' | 'name'> | null
}

export const FILE_CATEGORIES: Array<{ value: JobFileCategory; label: string }> = [
  { value: 'prima', label: 'Prima' },
  { value: 'durante', label: 'Durante' },
  { value: 'dopo', label: 'Dopo' },
  { value: 'documento', label: 'Documenti' }
]

export const QUOTE_STATUSES: Array<{ value: QuoteStatus; label: string; tone: string }> = [
  { value: 'bozza', label: 'Bozza', tone: 'bg-stone-100 text-stone-700' },
  { value: 'inviato', label: 'Inviato', tone: 'bg-violet-100 text-violet-800' },
  { value: 'accettato', label: 'Accettato', tone: 'bg-emerald-100 text-emerald-800' },
  { value: 'rifiutato', label: 'Rifiutato', tone: 'bg-red-100 text-red-800' }
]

export const EVENT_TYPES: Array<{ value: AgendaEventType; label: string; color: string }> = [
  { value: 'appuntamento', label: 'Appuntamento', color: 'bg-blue-500' },
  { value: 'sopralluogo', label: 'Sopralluogo', color: 'bg-violet-500' },
  { value: 'ritiro', label: 'Ritiro', color: 'bg-orange-500' },
  { value: 'consegna', label: 'Consegna', color: 'bg-emerald-600' },
  { value: 'lavorazione', label: 'Lavorazione', color: 'bg-amber-500' },
  { value: 'scadenza', label: 'Scadenza', color: 'bg-red-500' }
]

export const EXPENSE_CATEGORIES: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'materiali', label: 'Materiali' },
  { value: 'servizi', label: 'Servizi esterni' },
  { value: 'trasporto', label: 'Trasporto' },
  { value: 'altro', label: 'Altro' }
]

export const PAYMENT_KINDS: Array<{ value: PaymentKind; label: string }> = [
  { value: 'acconto', label: 'Acconto' },
  { value: 'saldo', label: 'Saldo' },
  { value: 'altro', label: 'Altro pagamento' }
]

export const MATERIAL_UNITS = ['pz', 'm', 'm²', 'l', 'kg', 'conf'] as const
export const MOVEMENT_TYPES: Array<{ value: MaterialMovementType; label: string }> = [
  { value: 'carico', label: 'Carico' }, { value: 'scarico', label: 'Scarico generico' }, { value: 'rettifica', label: 'Rettifica inventario' }, { value: 'consumo_commessa', label: 'Consumo commessa' }, { value: 'consumo_recupero', label: 'Consumo recupero' }
]
export const RECOVERY_STATUSES: Array<{ value: RecoveredItemStatus; label: string; tone: string }> = [
  { value: 'acquisito', label: 'Acquisito', tone: 'bg-sky-100 text-sky-800' }, { value: 'da_restaurare', label: 'Da restaurare', tone: 'bg-amber-100 text-amber-900' }, { value: 'in_restauro', label: 'In restauro', tone: 'bg-orange-100 text-orange-800' }, { value: 'pronto', label: 'Pronto', tone: 'bg-emerald-100 text-emerald-800' }, { value: 'in_vendita', label: 'In vendita', tone: 'bg-violet-100 text-violet-800' }, { value: 'venduto', label: 'Venduto', tone: 'bg-emerald-700 text-white' }
]
export const ANTITARLO_STATUSES: Array<{ value: AntitarloStatus; label: string; tone: string }> = [
  { value: 'da_programmare', label: 'Da programmare', tone: 'bg-stone-100 text-stone-700' }, { value: 'ritirato', label: 'Ritirato', tone: 'bg-sky-100 text-sky-800' }, { value: 'dal_collaboratore', label: 'Dal collaboratore', tone: 'bg-violet-100 text-violet-800' }, { value: 'in_rientro', label: 'In rientro', tone: 'bg-orange-100 text-orange-800' }, { value: 'pronto_riconsegna', label: 'Pronto per riconsegna', tone: 'bg-lime-100 text-lime-800' }, { value: 'riconsegnato', label: 'Riconsegnato', tone: 'bg-emerald-700 text-white' }, { value: 'annullato', label: 'Annullato', tone: 'bg-red-100 text-red-800' }
]

export const JOB_TYPES: Array<{ value: JobType; label: string }> = [
  { value: 'restauro', label: 'Restauro' },
  { value: 'su_misura', label: 'Produzione su misura' },
  { value: 'recupero', label: 'Recupero e rivendita' },
  { value: 'antitarlo', label: 'Trattamento antitarlo' }
]

export const JOB_STATUSES: Array<{ value: JobStatus; label: string; tone: string }> = [
  { value: 'nuova_richiesta', label: 'Nuova richiesta', tone: 'bg-sky-100 text-sky-800' },
  { value: 'preventivo_da_preparare', label: 'Preventivo da preparare', tone: 'bg-amber-100 text-amber-900' },
  { value: 'preventivo_inviato', label: 'Preventivo inviato', tone: 'bg-violet-100 text-violet-800' },
  { value: 'confermato', label: 'Confermato', tone: 'bg-emerald-100 text-emerald-800' },
  { value: 'da_iniziare', label: 'Da iniziare', tone: 'bg-blue-100 text-blue-800' },
  { value: 'in_lavorazione', label: 'In lavorazione', tone: 'bg-orange-100 text-orange-800' },
  { value: 'in_attesa', label: 'In attesa', tone: 'bg-stone-200 text-stone-700' },
  { value: 'pronto_consegna', label: 'Pronto per la consegna', tone: 'bg-lime-100 text-lime-800' },
  { value: 'consegnato', label: 'Consegnato', tone: 'bg-teal-100 text-teal-800' },
  { value: 'concluso', label: 'Concluso', tone: 'bg-emerald-700 text-white' },
  { value: 'non_confermato', label: 'Non confermato', tone: 'bg-rose-100 text-rose-800' },
  { value: 'annullato', label: 'Annullato', tone: 'bg-red-100 text-red-800' }
]

export function jobStatusMeta(status: JobStatus) {
  return JOB_STATUSES.find((item) => item.value === status) ?? JOB_STATUSES[0]
}

export function jobTypeLabel(type: JobType) {
  return JOB_TYPES.find((item) => item.value === type)?.label ?? type
}
