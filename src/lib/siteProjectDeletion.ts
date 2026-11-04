import { supabase, readableError } from './supabase'
import { deleteSiteImage, changeSitePublication } from './site'
import type { SitePortfolioImage } from './types'

/** Only the project's dedicated prefixes are inspected, including orphan files from interrupted attempts. */
export async function deleteSiteProject(projectId: string, requestSiteSync: () => void) {
  if (!supabase) throw new Error('Supabase non è configurato.')
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error('Identificativo del progetto non valido.')
  const client = supabase
  const { data: owner, error: authError } = await client.rpc('is_site_owner')
  if (authError || !owner) throw new Error('L’eliminazione definitiva richiede un owner editoriale autorizzato.')
  const { data: project, error: projectError } = await client.from('site_portfolio_projects').select('id,publication_status').eq('id', projectId).maybeSingle()
  if (projectError) throw new Error(readableError(projectError))
  const prefix = `portfolio/${projectId}`
  let publicChanged = project?.publication_status === 'pubblicato'
  async function listObjects(bucket: string, folder = prefix): Promise<string[]> {
    const paths: string[] = []
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await client.storage.from(bucket).list(folder, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
      if (error || !data) throw new Error(error ? readableError(error) : 'Impossibile verificare i file del progetto.')
      for (const item of data) {
        if (!item.name || item.name.includes('/') || item.name === '.' || item.name === '..') throw new Error('Percorso fotografico inatteso: eliminazione interrotta.')
        const path = `${folder}/${item.name}`
        if (item.id) paths.push(path)
        else paths.push(...await listObjects(bucket, path))
      }
      if (data.length < 100) break
    }
    return paths
  }
  try {
    const { data: images, error } = await client.from('site_portfolio_images').select('*').eq('portfolio_project_id', projectId)
    if (error) throw new Error(readableError(error))
    for (const image of (images ?? []) as SitePortfolioImage[]) {
      if (!['site-drafts', 'site-public'].includes(image.storage_bucket) || !image.storage_path.startsWith(`${prefix}/`)) throw new Error('Riferimento fotografico incoerente: eliminazione interrotta.')
      publicChanged ||= image.storage_bucket === 'site-public'
      await deleteSiteImage('portfolio', image)
    }
    // Retry also cleans objects left without metadata by an interrupted operation.
    for (const bucket of ['site-public', 'site-drafts']) {
      const paths = await listObjects(bucket)
      if (bucket === 'site-public' && paths.length) publicChanged = true
      for (let offset = 0; offset < paths.length; offset += 100) {
        const { error } = await client.storage.from(bucket).remove(paths.slice(offset, offset + 100))
        if (error) throw new Error(readableError(error))
      }
      // Storage/RLS can return no error for a deletion that removed no rows.
      if ((await listObjects(bucket)).length) throw new Error('Alcune fotografie non sono state rimosse. Il progetto è conservato: riprova l’eliminazione.')
    }
    const { data: remaining, error: mediaError } = await client.from('site_portfolio_images').select('id').eq('portfolio_project_id', projectId)
    if (mediaError || remaining?.length) throw new Error('I metadati fotografici non sono stati eliminati completamente. Riprova.')
    if (project) {
      // The media guard permits withdrawal only after both public objects and metadata are gone.
      await changeSitePublication({ kind: 'portfolio', parentId: projectId, images: [], nextStatus: 'non_pubblicato' })
      const { data: removed, error } = await client.from('site_portfolio_projects').delete().eq('id', projectId).select('id')
      if (error || !removed?.length) throw new Error(error ? readableError(error) : 'Il database non ha confermato l’eliminazione del progetto.')
    }
    // The original 004 FK removes only the private source link in the same DELETE.
    const { data: sources, error: sourceError } = await client.from('site_portfolio_project_sources').select('portfolio_project_id').eq('portfolio_project_id', projectId)
    if (sourceError || sources?.length) throw new Error('Impossibile confermare la rimozione del collegamento alla commessa. Riprova.')
    for (const bucket of ['site-public', 'site-drafts']) {
      if ((await listObjects(bucket)).length) throw new Error('Sono rimasti file del progetto. Riprova per completare la pulizia.')
    }
  } finally {
    // A partially completed deletion can already change the public projection.
    if (publicChanged) requestSiteSync()
  }
}
