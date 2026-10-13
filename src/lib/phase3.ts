import type { Job, JobExpense, JobPayment, MaterialMovement, RecoveryExpense, RecoveryTimeEntry, TimeEntry } from './types'

export function isPhase3Unavailable(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message).toLowerCase() : ''
  return code === '42P01' || code === 'PGRST205' || code === '42703' || message.includes('schema cache') || message.includes('does not exist')
}

export function movementCost(movement: Pick<MaterialMovement, 'quantity_delta' | 'unit_cost_snapshot'>) {
  return Math.abs(Number(movement.quantity_delta)) * Number(movement.unit_cost_snapshot)
}

export function effectiveMaterialMovements(movements: MaterialMovement[]) {
  const reversedIds = new Set(movements.flatMap((movement) => movement.reversal_of_id ? [movement.reversal_of_id] : []))
  return movements.filter((movement) => !movement.reversal_of_id && !reversedIds.has(movement.id))
}

export function isMaterialMovementReversed(movement: MaterialMovement, movements: MaterialMovement[]) {
  return movements.some((candidate) => candidate.reversal_of_id === movement.id)
}

export function laborValue(entries: Array<Pick<TimeEntry | RecoveryTimeEntry, 'duration_minutes' | 'hourly_rate'>>) {
  return entries.reduce((sum, entry) => sum + Number(entry.duration_minutes) / 60 * Number(entry.hourly_rate), 0)
}

export function recoveryEconomics({ acquisitionCost, expectedSalePrice, actualSalePrice, sold, expenses, timeEntries, materialMovements }: {
  acquisitionCost: number
  expectedSalePrice: number
  actualSalePrice: number | null
  sold: boolean
  expenses: RecoveryExpense[]
  timeEntries: RecoveryTimeEntry[]
  materialMovements: MaterialMovement[]
}) {
  const expenseCost = expenses.reduce((sum, item) => sum + Number(item.amount), 0)
  const materialsCost = effectiveMaterialMovements(materialMovements).reduce((sum, item) => sum + movementCost(item), 0)
  const laborCost = laborValue(timeEntries)
  const totalCost = Number(acquisitionCost) + expenseCost + materialsCost + laborCost
  const revenue = sold ? Number(actualSalePrice || 0) : Number(expectedSalePrice || 0)
  return { expenseCost, materialsCost, laborCost, totalCost, revenue, margin: revenue - totalCost }
}

export function jobEconomics(job: Pick<Job, 'agreed_revenue'>, expenses: JobExpense[], payments: JobPayment[], timeEntries: TimeEntry[], materialMovements: MaterialMovement[]) {
  const revenue = Number(job.agreed_revenue || 0)
  const received = payments.reduce((sum, item) => sum + Number(item.amount), 0)
  const expensesCost = expenses.reduce((sum, item) => sum + Number(item.amount), 0)
  const materialsCost = effectiveMaterialMovements(materialMovements).reduce((sum, item) => sum + movementCost(item), 0)
  const laborCost = laborValue(timeEntries.filter((item) => !item.is_running))
  const costsWithoutLabor = expensesCost + materialsCost
  return { revenue, received, outstanding: Math.max(revenue - received, 0), expensesCost, materialsCost, laborCost, costsWithoutLabor, margin: revenue - costsWithoutLabor - laborCost }
}
