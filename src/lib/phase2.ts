import type { QuoteItem } from './types'
import { quoteItemAmount, roundMoney } from './quoteSurface'

export function isPhase2Unavailable(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message).toLowerCase() : ''
  return code === '42P01' || code === 'PGRST205' || message.includes('schema cache') || message.includes('does not exist')
}

export function calculateQuoteTotals(
  items: Array<Pick<QuoteItem, 'quantity' | 'unit_price'> & Partial<QuoteItem>>,
  laborHours: number,
  hourlyRate: number,
  transportCost: number,
  otherCosts: number,
  marginPercent: number
) {
  const materials = items.filter(item => item.item_kind !== 'service').reduce((sum, item) => sum + quoteItemAmount(item), 0)
  const services = items.filter(item => item.item_kind === 'service').reduce((sum, item) => sum + quoteItemAmount(item), 0)
  const round = items.some(item => item.calculation_mode === 'surface' || item.item_kind === 'service') ? roundMoney : (value: number) => value
  const labor = Number(laborHours || 0) * Number(hourlyRate || 0)
  const subtotal = round(materials + services + labor + Number(transportCost || 0) + Number(otherCosts || 0))
  const marginAmount = round(subtotal * (Number(marginPercent || 0) / 100))
  return { materials, services, labor, subtotal, marginAmount, total: round(subtotal + marginAmount) }
}

export function minutesLabel(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (!hours) return `${remainder} min`
  return `${hours} h${remainder ? ` ${remainder} min` : ''}`
}
