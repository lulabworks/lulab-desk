import type { QuoteItem } from './types'

export function surfaceQuantity(item: Pick<QuoteItem, 'width_cm' | 'height_cm' | 'element_count' | 'faces'>) {
  const width = Number(item.width_cm), height = Number(item.height_cm)
  const count = Number(item.element_count), faces = Number(item.faces)
  if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 10000 && Math.abs(n * 100 - Math.round(n * 100)) < 0.000001)
    || !Number.isInteger(count) || count < 1 || count > 10000 || ![1, 2].includes(faces)) {
    throw new Error('Indica misure positive fino a 10.000 cm (massimo due decimali), un numero intero di elementi da 1 a 10.000 e una o due facce.')
  }
  return Math.round(width * height * count * faces / 10000 * 1e8) / 1e8
}

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
export function quoteItemAmount(item: Pick<QuoteItem, 'quantity' | 'unit_price'> & Partial<QuoteItem>) {
  let quantity = Number(item.quantity)
  if (item.calculation_mode === 'surface') {
    try { quantity = surfaceQuantity(item) } catch { return 0 } // Incomplete editor draft; save validates separately.
  }
  const amount = quantity * Number(item.unit_price)
  // Legacy manual material rows keep their original calculation.
  return item.calculation_mode === 'surface' || item.item_kind === 'service' ? roundMoney(amount) : amount
}

export function surfaceCaption(item: QuoteItem) {
  return item.calculation_mode === 'surface'
    ? `${item.width_cm} × ${item.height_cm} cm · ${item.element_count} elementi · ${item.faces} facce${item.labor_included ? ' · manodopera compresa' : ''}`
    : ''
}
