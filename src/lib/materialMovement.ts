import type { Material, MaterialMovementType, RecoveredItem } from './types'

export interface MaterialMovementDraft {
  material_id: string
  movement_type: MaterialMovementType
  quantity: number
  unit_cost: number
  occurred_on: string
  job_id: string
  recovered_item_id: string
  supplier_id: string
  notes: string
}

export function buildMaterialMovement(draft: MaterialMovementDraft, material: Material, recoveries: RecoveredItem[]) {
  if (draft.material_id !== material.id) throw new Error('Seleziona il materiale da movimentare.')
  const quantity = Number(draft.quantity)
  const cost = Number(draft.unit_cost)
  if (!Number.isFinite(quantity) || quantity === 0 || (draft.movement_type !== 'rettifica' && quantity < 0)
    || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.00001 || Math.abs(quantity) >= 1e11) {
    throw new Error('Inserisci una quantità valida, con al massimo tre decimali.')
  }
  if (!Number.isFinite(cost) || cost < 0 || cost >= 1e8 || Math.abs(cost * 10000 - Math.round(cost * 10000)) > 0.00001) {
    throw new Error('Inserisci un costo unitario valido, con al massimo quattro decimali.')
  }
  let type = draft.movement_type
  let jobId = type === 'consumo_commessa' ? draft.job_id || null : null
  const recoveryId = type === 'consumo_recupero' ? draft.recovered_item_id || null : null
  if (type === 'consumo_commessa' && !jobId) throw new Error('Seleziona la commessa.')
  if (type === 'consumo_recupero') {
    const recovery = recoveries.find((item) => item.id === recoveryId)
    if (!recovery) throw new Error('Seleziona il recupero.')
    // A linked recovery must charge its existing job, while retaining the item
    // reference. It must never create an independent, duplicate recovery cost.
    if (recovery.job_id) { type = 'consumo_commessa'; jobId = recovery.job_id }
  }
  const negative = ['scarico', 'consumo_commessa', 'consumo_recupero'].includes(type)
  const delta = type === 'rettifica' ? quantity : Math.abs(quantity) * (negative ? -1 : 1)
  const resultingStock = (Math.round(Number(material.quantity_available) * 1000) + Math.round(delta * 1000)) / 1000
  if (resultingStock < 0) throw new Error('La quantità supera la giacenza disponibile.')
  return {
    resultingStock,
    payload: {
      material_id: material.id,
      movement_type: type,
      quantity_delta: delta,
      unit_cost_snapshot: cost,
      occurred_on: draft.occurred_on,
      job_id: jobId,
      recovered_item_id: recoveryId,
      supplier_id: type === 'carico' ? draft.supplier_id || null : null,
      notes: draft.notes.trim() || null
    }
  }
}

export type MaterialMovementInsert = ReturnType<typeof buildMaterialMovement>['payload']
