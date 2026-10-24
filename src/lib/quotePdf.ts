import type { Customer, Job, Quote, QuoteItem } from './types'
import { calculateQuoteTotals } from './phase2'
import { quoteItemAmount, surfaceCaption, surfaceQuantity } from './quoteSurface'
import { BRAND } from './brand'

const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
const date = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
let brandLogoDataUrl: Promise<string> | null = null

function loadBrandLogo() {
  if (!brandLogoDataUrl) {
    brandLogoDataUrl = fetch(BRAND.logo)
      .then((response) => {
        if (!response.ok) throw new Error('Impossibile caricare il logo LuLab.')
        return response.blob()
      })
      .then((blob) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error ?? new Error('Impossibile leggere il logo LuLab.'))
        reader.readAsDataURL(blob)
      }))
  }
  return brandLogoDataUrl
}

function safeDate(value: string | null) {
  if (!value) return '—'
  return date.format(new Date(`${value}T12:00:00`))
}

export async function generateQuotePdf({
  quote,
  items,
  job,
  customer
}: {
  quote: Quote
  items: QuoteItem[]
  job: Job
  customer: Customer | null
}) {
  const [{ jsPDF }, logoDataUrl] = await Promise.all([import('jspdf'), loadBrandLogo()])
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const left = 18
  const right = pageWidth - 18
  let y = 18

  const ensureSpace = (needed: number) => {
    if (y + needed < pageHeight - 20) return
    doc.addPage()
    y = 20
  }

  doc.addImage(logoDataUrl, 'PNG', left, y, 24, 24, 'lulab-logo', 'FAST')
  doc.setTextColor(32, 36, 31)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(BRAND.name, left + 28, y + 7)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(102, 112, 106)
  doc.text('Laboratorio artigianale di falegnameria', left + 28, y + 13)
  doc.text(BRAND.email, left + 28, y + 18)

  doc.setTextColor(31, 73, 56)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text('PREVENTIVO', right, y + 7, { align: 'right' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(102, 112, 106)
  doc.text(`${quote.code} · ${safeDate(quote.quote_date)}`, right, y + 13, { align: 'right' })
  y += 31

  doc.setDrawColor(221, 221, 214)
  doc.line(left, y, right, y)
  y += 9
  doc.setTextColor(32, 36, 31)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(quote.title, left, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(102, 112, 106)
  doc.text(`Commessa: ${job.code} · ${job.title}`, left, y)
  doc.text(`Validità: ${safeDate(quote.valid_until)}`, right, y, { align: 'right' })
  y += 8

  doc.setFillColor(245, 244, 239)
  doc.roundedRect(left, y, right - left, 24, 2, 2, 'F')
  doc.setTextColor(32, 36, 31)
  doc.setFont('helvetica', 'bold')
  doc.text('Cliente', left + 5, y + 7)
  doc.setFont('helvetica', 'normal')
  doc.text(customer?.display_name ?? 'Cliente non associato', left + 5, y + 13)
  if (customer?.address) doc.text(doc.splitTextToSize(customer.address, 78), left + 5, y + 18)
  if (customer?.email) doc.text(customer.email, right - 5, y + 7, { align: 'right' })
  if (customer?.phone) doc.text(customer.phone, right - 5, y + 13, { align: 'right' })
  y += 31

  const widths = [79, 34, 27, 28]
  doc.setFillColor(31, 73, 56)
  doc.rect(left, y, right - left, 8, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.text('Descrizione', left + 3, y + 5.3)
  doc.text('Qtà', left + widths[0] + 3, y + 5.3)
  doc.text('Unitario', left + widths[0] + widths[1] + 3, y + 5.3)
  doc.text('Totale', right - 3, y + 5.3, { align: 'right' })
  y += 8

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(32, 36, 31)
  for (const item of items) {
    const lines = doc.splitTextToSize([item.description, surfaceCaption(item)].filter(Boolean).join('\n'), widths[0] - 6) as string[]
    const rowHeight = Math.max(8, lines.length * 4.2 + 3)
    ensureSpace(rowHeight + 5)
    doc.setDrawColor(231, 229, 223)
    doc.line(left, y + rowHeight, right, y + rowHeight)
    doc.text(lines, left + 3, y + 5)
    doc.text(`${item.calculation_mode === 'surface' ? surfaceQuantity(item) : Number(item.quantity)} ${item.unit}`, left + widths[0] + 3, y + 5)
    doc.text(`${euro.format(Number(item.unit_price))}${item.calculation_mode === 'surface' ? ' /m²' : ''}`, left + widths[0] + widths[1] + 3, y + 5)
    doc.text(euro.format(quoteItemAmount(item)), right - 3, y + 5, { align: 'right' })
    y += rowHeight
  }

  const totals = calculateQuoteTotals(items, quote.labor_hours, quote.hourly_rate, quote.transport_cost, quote.other_costs, quote.margin_percent)
  ensureSpace(62)
  y += 6
  const labelX = right - 70
  const rows: Array<[string, number, boolean?]> = [
    ['Materiali', totals.materials],
    ['Prestazioni', totals.services],
    [`Ore aggiuntive (${Number(quote.labor_hours)} h × ${euro.format(Number(quote.hourly_rate))})`, totals.labor],
    ['Trasporto', Number(quote.transport_cost)],
    ['Altre spese', Number(quote.other_costs)],
    [`Margine (${Number(quote.margin_percent)}%)`, totals.marginAmount]
  ]
  doc.setFontSize(9)
  rows.forEach(([label, value]) => {
    doc.setTextColor(102, 112, 106)
    doc.text(label, labelX, y)
    doc.setTextColor(32, 36, 31)
    doc.text(euro.format(value), right, y, { align: 'right' })
    y += 6
  })
  doc.setDrawColor(31, 73, 56)
  doc.line(labelX, y - 2, right, y - 2)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(31, 73, 56)
  doc.text('TOTALE', labelX, y + 5)
  doc.text(euro.format(totals.total), right, y + 5, { align: 'right' })
  y += 16

  if (quote.notes || quote.terms) {
    ensureSpace(30)
    doc.setFontSize(10)
    doc.setTextColor(32, 36, 31)
    if (quote.notes) {
      doc.setFont('helvetica', 'bold')
      doc.text('Note', left, y)
      y += 5
      doc.setFont('helvetica', 'normal')
      const lines = doc.splitTextToSize(quote.notes, right - left) as string[]
      doc.text(lines, left, y)
      y += lines.length * 4.5 + 5
    }
    if (quote.terms) {
      ensureSpace(15)
      doc.setFont('helvetica', 'bold')
      doc.text('Condizioni', left, y)
      y += 5
      doc.setFont('helvetica', 'normal')
      doc.text(doc.splitTextToSize(quote.terms, right - left), left, y)
    }
  }

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(130, 135, 130)
    doc.text(`${BRAND.name} · ${quote.code}`, left, pageHeight - 10)
    doc.text(`Pagina ${page} di ${pages}`, right, pageHeight - 10, { align: 'right' })
  }

  doc.save(`${quote.code}-${job.code}.pdf`)
  return doc
}
