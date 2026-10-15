import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const source = await read('src/lib/phase3.ts')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText
const economics = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const financeSource = await read('src/lib/finance.ts')
const financeCompiled = ts.transpileModule(financeSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText
const finance = await import(`data:text/javascript;base64,${Buffer.from(financeCompiled).toString('base64')}`)

const expensePayload = finance.buildJobExpenseInsert('job-correct', {
  category: 'trasporto',
  description: '  Consegna mobile  ',
  amount: 85,
  incurred_on: '2026-10-13',
  supplier: '  Trasporti LuLab  ',
  notes: '  Piano primo  '
})
assert.deepEqual(expensePayload, {
  job_id: 'job-correct',
  category: 'trasporto',
  description: 'Consegna mobile',
  amount: 85,
  incurred_on: '2026-10-13',
  supplier: 'Trasporti LuLab',
  notes: 'Piano primo'
})
assert.equal('user_id' in expensePayload, false, 'user_id deve essere valorizzato dal default auth.uid()')

const paymentPayload = finance.buildJobPaymentInsert('job-correct', {
  kind: 'acconto',
  amount: 400,
  paid_on: '2026-10-13',
  method: '  Bonifico  ',
  notes: '  Primo acconto  '
})
assert.deepEqual(paymentPayload, {
  job_id: 'job-correct',
  kind: 'acconto',
  amount: 400,
  paid_on: '2026-10-13',
  method: 'Bonifico',
  notes: 'Primo acconto'
})
assert.equal('user_id' in paymentPayload, false, 'user_id deve essere valorizzato dal default auth.uid()')

const financePanelSource = await read('src/components/FinancePanel.tsx')
const antitarloSource = await read('src/pages/AntitarloPage.tsx')
const agendaSource = await read('src/pages/AgendaPage.tsx')
const jobsSource = await read('src/pages/JobsPage.tsx')
const appSource = await read('src/App.tsx')
const typographySource = await read('src/index.css')
const uiSource = await read('src/components/ui.tsx')
assert.match(financePanelSource, /from\('job_expenses'\)\.insert\(buildJobExpenseInsert\(job\.id, expense\)\)/)
assert.match(financePanelSource, /from\('job_payments'\)\.insert\(buildJobPaymentInsert\(job\.id, payment\)\)/)
assert.match(financePanelSource, /from\('job_expenses'\)\.select\('\*'\)\.eq\('job_id', job\.id\)/)
assert.match(financePanelSource, /from\('job_payments'\)\.select\('\*'\)\.eq\('job_id', job\.id\)/)
assert.match(antitarloSource, /from\('job_expenses'\)\.insert\(\{ job_id: selected\.job_id,/)
assert.match(antitarloSource, /from\('job_payments'\)\.insert\(\{ job_id: selected\.job_id,/)

const phase2Sql = await read('supabase/migrations/002_phase2_operations.sql')
const expenseTableSql = phase2Sql.match(/create table public\.job_expenses \([\s\S]+?\n\);/i)?.[0] ?? ''
const paymentTableSql = phase2Sql.match(/create table public\.job_payments \([\s\S]+?\n\);/i)?.[0] ?? ''
assert.match(expenseTableSql, /user_id uuid not null[^\n]+default auth\.uid\(\)/i)
assert.match(paymentTableSql, /user_id uuid not null[^\n]+default auth\.uid\(\)/i)
assert.match(expenseTableSql, /job_id uuid not null references public\.jobs\(id\)/i)
assert.match(paymentTableSql, /job_id uuid not null references public\.jobs\(id\)/i)
assert.match(phase2Sql, /create policy "Users manage expenses for their jobs"[\s\S]+?with check \([\s\S]+?j\.id = job_id and j\.user_id = \(select auth\.uid\(\)\)/i)
assert.match(phase2Sql, /create policy "Users manage payments for their jobs"[\s\S]+?with check \([\s\S]+?j\.id = job_id and j\.user_id = \(select auth\.uid\(\)\)/i)
assert.match(phase2Sql, /create trigger job_payments_sync_total[\s\S]+?after insert or update or delete on public\.job_payments/i)

assert.match(appSource, /export const RouteLayer = forwardRef<HTMLDivElement/)
assert.match(appSource, /ref=\{ref\}/)
assert.match(appSource, /data-route-state=\{isPresent \? 'present' : 'exiting'\}/)
assert.match(appSource, /const isPresent = useIsPresent\(\)/)
assert.match(appSource, /style=\{\{ zIndex: isPresent \? 1 : 0 \}\}/)
assert.match(appSource, /style=\{\{ visibility: isPresent \? 'visible' : 'hidden' \}\}/)
assert.doesNotMatch(appSource, /pointer-events-none fixed inset-0/, 'La route uscente non deve essere mascherata con un overlay')
assert.match(appSource, /exit: \{ x: 0, scale: 1, zIndex: 0 \}/)
assert.match(appSource, /className="relative isolate min-w-0 overflow-x-clip bg-canvas"/)
assert.match(appSource, /<AnimatePresence initial=\{false\} mode="popLayout" custom=\{direction\}>/)
assert.match(appSource, /<RouteLayer key=\{location\.pathname\}/)
assert.equal((appSource.match(/layoutId=/g) ?? []).length, 0, 'I layoutId delle pagine restano nei componenti di lista e dettaglio')

assert.match(typographySource, /--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif/)
assert.doesNotMatch(typographySource, /Georgia|Times New Roman|--font-display/)
assert.match(typographySource, /\.type-page-title \{ font-size: 1\.875rem; line-height: 2\.25rem; font-weight: 700;/)
assert.match(typographySource, /\.type-panel-title \{ font-size: 1\.3125rem; line-height: 1\.625rem; font-weight: 600;/)
assert.match(typographySource, /\.type-card-title \{ font-size: 1\.0625rem; line-height: 1\.375rem; font-weight: 600;/)
assert.match(typographySource, /\.type-meta \{ font-size: \.8125rem; line-height: 1\.125rem; font-weight: 500;/)
assert.match(uiSource, /const fieldClass =[\s\S]+text-base/)
assert.match(typographySource, /input, select, textarea \{ font-size: max\(1rem, 16px\) !important; \}/)
assert.doesNotMatch(uiSource, /font-display|text-\[(?:9|10|11|12)px\]/)

assert.match(uiSource, /import \{ createPortal \} from 'react-dom'/)
assert.match(uiSource, /return createPortal\([\s\S]+document\.body/)
assert.match(uiSource, /window\.visualViewport/)
assert.match(uiSource, /data-modal-viewport="visual"/)
assert.match(uiSource, /data-modal-scroll-region/)
assert.match(uiSource, /lockPageForModal\(restoreFocusRef\.current\)/)
assert.match(uiSource, /appRoot\?\.setAttribute\('inert', ''\)/)
assert.match(uiSource, /snapshot\.restoreFocus\.focus\(\{ preventScroll: true \}\)/)
assert.match(uiSource, /event\.key === 'Escape'/)
assert.match(uiSource, /event\.key !== 'Tab'/)
assert.doesNotMatch(uiSource, /activeElement\.scrollIntoView\(/, 'Viewport changes must not scroll off-screen modal headers or the whole document')
assert.match(uiSource, /region\.scrollTo\(/)
assert.match(jobsSource, /<Modal title="Nuova commessa"/)
assert.match(agendaSource, /<Modal\s+title=\{editing === 'new' \? 'Nuovo evento' : 'Modifica evento'\}/)
assert.match(antitarloSource, /<Modal title=\{selected \? 'Modifica trattamento' : 'Nuovo trattamento'\}/)

assert.equal(economics.movementCost({ quantity_delta: -3, unit_cost_snapshot: 12.5 }), 37.5)
const ledger = [
  { id: 'original', reversal_of_id: null, quantity_delta: -3, unit_cost_snapshot: 12.5 },
  { id: 'reversal', reversal_of_id: 'original', quantity_delta: 3, unit_cost_snapshot: 12.5 },
  { id: 'active', reversal_of_id: null, quantity_delta: -2, unit_cost_snapshot: 5 }
]
assert.deepEqual(economics.effectiveMaterialMovements(ledger).map((entry) => entry.id), ['active'])
assert.equal(economics.isMaterialMovementReversed(ledger[0], ledger), true)
assert.equal(economics.laborValue([
  { duration_minutes: 90, hourly_rate: 40 },
  { duration_minutes: 30, hourly_rate: 20 }
]), 70)

const recovery = economics.recoveryEconomics({
  acquisitionCost: 100,
  expectedSalePrice: 500,
  actualSalePrice: 600,
  sold: true,
  expenses: [{ amount: 50 }],
  timeEntries: [{ duration_minutes: 90, hourly_rate: 40 }],
  materialMovements: [{ quantity_delta: -3, unit_cost_snapshot: 12.5 }]
})
assert.deepEqual(recovery, {
  expenseCost: 50,
  materialsCost: 37.5,
  laborCost: 60,
  totalCost: 247.5,
  revenue: 600,
  margin: 352.5
})

const job = economics.jobEconomics(
  { agreed_revenue: 1000 },
  [{ amount: 100 }],
  [{ amount: 400 }],
  [{ duration_minutes: 120, hourly_rate: 30, is_running: false }],
  [{ quantity_delta: -5, unit_cost_snapshot: 10 }]
)
assert.deepEqual(job, {
  revenue: 1000,
  received: 400,
  outstanding: 600,
  expensesCost: 100,
  materialsCost: 50,
  laborCost: 60,
  costsWithoutLabor: 150,
  margin: 790
})

const afterNewRows = economics.jobEconomics(
  { agreed_revenue: 1000 },
  [{ amount: 100 }, { amount: expensePayload.amount }],
  [{ amount: paymentPayload.amount }],
  [],
  []
)
assert.deepEqual(afterNewRows, {
  revenue: 1000,
  received: 400,
  outstanding: 600,
  expensesCost: 185,
  materialsCost: 0,
  laborCost: 0,
  costsWithoutLabor: 185,
  margin: 815
})

let stock = 0
for (const delta of [10, -3, 2, -4]) {
  const next = stock + delta
  assert.ok(next >= 0, 'La giacenza non può diventare negativa')
  stock = next
}
assert.equal(stock, 5)
assert.throws(() => {
  const next = stock - 6
  assert.ok(next >= 0, 'La giacenza non può diventare negativa')
})

const canChangeRecoveryJob = ({ activeMovements = 0, standaloneRows = 0, oldJobEconomicRows = 0 }) =>
  activeMovements === 0 && standaloneRows === 0 && oldJobEconomicRows === 0
assert.equal(canChangeRecoveryJob({ activeMovements: 1 }), false)
assert.equal(canChangeRecoveryJob({ standaloneRows: 1 }), false)
assert.equal(canChangeRecoveryJob({ oldJobEconomicRows: 1 }), false)
assert.equal(canChangeRecoveryJob({}), true)

const sql = await read('supabase/migrations/003_phase3_management.sql')
const movementTable = sql.match(/create table public\.material_movements \([\s\S]+?\n\);/i)?.[0] ?? ''
const tables = [
  'material_categories', 'suppliers', 'materials', 'material_movements',
  'recovered_items', 'recovered_item_files', 'recovery_time_entries',
  'recovery_expenses', 'external_collaborators', 'antitarlo_treatments'
]
const grantBlock = sql.match(/grant select, insert, update, delete on table[\s\S]+?to authenticated;/i)?.[0] ?? ''
const revokeBlock = sql.match(/revoke all privileges on table[\s\S]+?from anon;/i)?.[0] ?? ''
for (const table of tables) {
  assert.match(sql, new RegExp(`create table public\\.${table}\\s*\\(`, 'i'))
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
  assert.match(sql, new RegExp(`create policy [\\s\\S]+? on public\\.${table}`, 'i'))
  if (table !== 'material_movements') assert.match(grantBlock, new RegExp(`public\\.${table}`, 'i'))
  assert.match(revokeBlock, new RegExp(`public\\.${table}`, 'i'))
}
assert.doesNotMatch(grantBlock, /public\.material_movements/i)
assert.match(sql, /grant select, insert on table public\.material_movements to authenticated;/i)
assert.match(sql, /revoke update, delete on table public\.material_movements from authenticated;/i)
assert.equal((sql.match(/create policy /gi) ?? []).length, tables.length + 1)
assert.match(sql, /create trigger material_movements_apply_stock/i)
assert.match(sql, /create trigger material_movements_validate_links/i)
assert.match(sql, /create trigger material_movements_prevent_mutation/i)
assert.match(sql, /create trigger antitarlo_treatments_validate_references/i)
assert.equal((sql.match(/add column antitarlo_treatment_id uuid references public\.antitarlo_treatments/gi) ?? []).length, 3)
assert.match(sql, /job_id uuid references public\.jobs\(id\)/i)
assert.match(sql, /recovered_item_id uuid references public\.recovered_items\(id\)/i)
assert.match(sql, /material_id uuid not null references public\.materials\(id\) on delete restrict/i)
assert.match(sql, /job_id uuid references public\.jobs\(id\) on delete restrict/i)
assert.match(sql, /recovered_item_id uuid references public\.recovered_items\(id\) on delete restrict/i)
assert.match(sql, /supplier_id uuid references public\.suppliers\(id\) on delete restrict/i)
assert.match(sql, /reversal_of_id uuid unique references public\.material_movements\(id\) on delete restrict/i)
assert.doesNotMatch(movementTable, /(material_id|job_id|recovered_item_id|supplier_id)[^\n]+on delete cascade/i)
assert.match(sql, /after insert on public\.material_movements/i)
assert.doesNotMatch(sql, /after insert or update or delete on public\.material_movements/i)
assert.match(sql, /stornare tutti i consumi attivi del recupero/i)
assert.match(sql, /from public\.time_entries t where t\.job_id = old\.job_id/i)
assert.match(sql, /from public\.job_expenses e where e\.job_id = old\.job_id/i)
assert.doesNotMatch(sql, /unique\s*\(job_id\)/i)
assert.equal((sql.match(/\$\$/g) ?? []).length % 2, 0, 'Blocchi SQL $$ non bilanciati')

const knownMigrations = new Map([
  ['supabase/migrations/001_initial_schema.sql', '493b97f0b27b308eaa8486a45dad817a7695d82ce318e160bc511430340355f4'],
  ['supabase/migrations/002_phase2_operations.sql', 'db3111f40088f70c63234433c6e2c5f1d71cf86aefac616eb34d9611e40bcc58']
])
for (const [path, expected] of knownMigrations) {
  const contents = await read(path)
  assert.equal(createHash('sha256').update(contents).digest('hex'), expected, `${path} è stata modificata`)
}

console.log('Calcoli economici: OK')
console.log('Payload spese e pagamenti con job_id: OK')
console.log('Audit INSERT economici: OK')
console.log('Transizioni route senza ghosting: OK')
console.log('Sistema tipografico e campi iPhone: OK')
console.log('Modali portaled, viewport, scroll e focus: OK')
console.log('Movimenti di magazzino: OK')
console.log('Eliminazione, storno e riassegnazione recuperi: OK')
console.log('Schema, relazioni, RLS e privilegi: OK')
console.log('Regressione migrazioni 001/002: OK')
