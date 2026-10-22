import type { SupabaseClient } from '@supabase/supabase-js'

export type MaterialLifecycleAction = 'delete' | 'archive' | 'restore'

export async function changeMaterialLifecycle(client: SupabaseClient, materialId: string, action: MaterialLifecycleAction) {
  if (action === 'delete') {
    // This is a usability check, not a replacement for the database FK.
    const history = await client.from('material_movements').select('id', { count: 'exact', head: true }).eq('material_id', materialId)
    if (history.error) throw history.error
    if (history.count) throw new Error('Questo materiale ha movimenti storici: non può essere eliminato. Puoi archiviarlo quando la giacenza è zero.')
  }
  const query = action === 'delete'
    ? client.from('materials').delete().eq('id', materialId).eq('quantity_available', 0)
    : action === 'archive'
      ? client.from('materials').update({ is_active: false }).eq('id', materialId).eq('quantity_available', 0)
      : client.from('materials').update({ is_active: true }).eq('id', materialId)
  const result = await query.select('id').single()
  if (result.error) {
    if (result.error.code === '23503') throw new Error('Il materiale è collegato a dati da conservare e non può essere eliminato. Usa l’archiviazione.')
    if (result.error.code === 'PGRST116') throw new Error('Operazione non eseguita: la giacenza deve essere zero e il materiale deve essere ancora disponibile. Riapri la scheda per aggiornare i dati.')
    throw result.error
  }
}
