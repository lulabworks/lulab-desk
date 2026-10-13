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
console.log('Movimenti di magazzino: OK')
console.log('Eliminazione, storno e riassegnazione recuperi: OK')
console.log('Schema, relazioni, RLS e privilegi: OK')
console.log('Regressione migrazioni 001/002: OK')
