import { Trash2 } from 'lucide-react'
import type { QuoteItem } from '../lib/types'
import { quoteItemAmount, surfaceQuantity } from '../lib/quoteSurface'
import { money } from '../lib/format'
import { Field, Input, Select } from './ui'

export function QuoteItemEditor({ item, onChange, onRemove }: { item: QuoteItem; onChange: (item: QuoteItem) => void; onRemove: () => void }) {
  const surface = item.calculation_mode === 'surface'
  function change(patch: Partial<QuoteItem>) {
    const next = { ...item, ...patch }
    if (next.calculation_mode === 'surface') {
      next.unit = 'm²'
      try { next.quantity = surfaceQuantity(next) } catch { next.quantity = 0 }
    }
    onChange(next)
  }
  let amount = 0
  try { amount = quoteItemAmount(item) } catch { /* Measures are being edited. */ }
  return <div className="grid min-w-0 gap-3 rounded-xl border border-line p-3">
    <Field label="Descrizione"><Input maxLength={300} value={item.description} onChange={e => change({ description: e.target.value })} /></Field>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Tipo di voce"><Select value={item.item_kind ?? 'material'} onChange={e => change({ item_kind: e.target.value as QuoteItem['item_kind'] })}><option value="material">Materiale</option><option value="service">Prestazione / lavorazione</option></Select></Field>
      <Field label="Metodo"><Select value={item.calculation_mode ?? 'manual'} onChange={e => e.target.value === 'surface'
        ? change({ calculation_mode: 'surface', item_kind: 'service', width_cm: 100, height_cm: 100, element_count: 1, faces: 1, labor_included: true })
        : change({ calculation_mode: 'manual', width_cm: null, height_cm: null, element_count: null, faces: null, labor_included: false })}><option value="manual">Quantità e prezzo</option><option value="surface">Calcolo a superficie</option></Select></Field>
    </div>
    {surface ? <><div className="grid grid-cols-2 gap-3">
      <Field label="Larghezza (cm)"><Input type="number" inputMode="decimal" min="0.01" max="10000" step="0.01" value={item.width_cm ?? ''} onChange={e => change({ width_cm: Number(e.target.value) })} /></Field>
      <Field label="Altezza (cm)"><Input type="number" inputMode="decimal" min="0.01" max="10000" step="0.01" value={item.height_cm ?? ''} onChange={e => change({ height_cm: Number(e.target.value) })} /></Field>
      <Field label="Numero elementi"><Input type="number" min="1" max="10000" step="1" value={item.element_count ?? 1} onChange={e => change({ element_count: Number(e.target.value) })} /></Field>
      <Field label="Facce"><Select value={item.faces ?? 1} onChange={e => change({ faces: Number(e.target.value) })}><option value="1">Una faccia</option><option value="2">Due facce</option></Select></Field>
    </div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.labor_included ?? false} onChange={e => change({ labor_included: e.target.checked })} /> Manodopera compresa nella tariffa al m²</label><p className="text-sm text-muted">Superficie totale: {item.quantity} m²</p></>
      : <div className="grid grid-cols-2 gap-3"><Field label="Quantità"><Input type="number" min="0.00000001" step="any" value={item.quantity} onChange={e => change({ quantity: Number(e.target.value) })} /></Field><Field label="Unità"><Input maxLength={20} value={item.unit} onChange={e => change({ unit: e.target.value })} /></Field></div>}
    <div className="flex flex-wrap items-end gap-3"><Field label={surface ? 'Prezzo (€/m²)' : 'Prezzo unitario'}><Input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => change({ unit_price: Number(e.target.value) })} /></Field><p className="ml-auto py-3 font-semibold tabular-nums">{money.format(amount)}</p><button type="button" className="grid size-11 place-items-center rounded-xl text-red-700" onClick={onRemove} aria-label="Rimuovi voce"><Trash2 size={17} /></button></div>
  </div>
}
