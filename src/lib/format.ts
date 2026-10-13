import { format, isValid, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'

export const money = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR'
})

export function formatDate(value: string | null | undefined, fallback = 'Nessuna data') {
  if (!value) return fallback
  const date = parseISO(value)
  return isValid(date) ? format(date, 'd MMM yyyy', { locale: it }) : fallback
}

export function todayIso() {
  return format(new Date(), 'yyyy-MM-dd')
}
