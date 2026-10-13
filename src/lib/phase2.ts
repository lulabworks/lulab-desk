import type { QuoteItem } from './types'

export function isPhase2Unavailable(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message).toLowerCase() : ''
  return code === '42P01' || code === 'PGRST205' || message.includes('schema cache') || message.includes('does not exist')
}

export function calculateQuoteTotals(
  items: Array<Pick<QuoteItem, 'quantity' | 'unit_price'>>,
  laborHours: number,
  hourlyRate: number,
  transportCost: number,
  otherCosts: number,
  marginPercent: number
) {
  const materials = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0)
  const labor = Number(laborHours || 0) * Number(hourlyRate || 0)
  const subtotal = materials + labor + Number(transportCost || 0) + Number(otherCosts || 0)
  const marginAmount = subtotal * (Number(marginPercent || 0) / 100)
  return { materials, labor, subtotal, marginAmount, total: subtotal + marginAmount }
}

export function minutesLabel(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (!hours) return `${remainder} min`
  return `${hours} h${remainder ? ` ${remainder} min` : ''}`
}
