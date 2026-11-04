import { readableError, supabase } from './supabase'
import { getSupportedPhotoMimeType } from './photoUpload'
import { importedPhotoId, isJobPhoto, type PhotoImportReport } from './projectPhotoImport'
import type { JobFile } from './types'
import type {
  SiteCollectionImage,
  SitePortfolioImage,
  SitePortfolioImageKind,
  SitePublicationStatus
} from './types'

export type SiteContentKind = 'collection' | 'portfolio'
export type SiteImage = SiteCollectionImage | SitePortfolioImage

const MAX_SOURCE_SIZE = 25 * 1024 * 1024
const MAX_EDGE = 2200
const WEBP_QUALITY = 0.86
const JPEG_QUALITY = 0.88

export function isPublicSiteUnavailable(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message).toLowerCase() : ''
  return code === '42P01' || code === 'PGRST202' || code === 'PGRST205' || message.includes('schema cache') || message.includes('does not exist')
}
export function makeSiteSlug(value: string) {
  const base = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'contenuto'
  return `${base}-${Date.now().toString(36)}`
}

function imageTable(kind: SiteContentKind) {
  return kind === 'collection' ? 'site_collection_images' : 'site_portfolio_images'
}

function parentColumn(kind: SiteContentKind) {
  return kind === 'collection' ? 'collection_item_id' : 'portfolio_project_id'
}

function folder(kind: SiteContentKind) {
  return kind === 'collection' ? 'collection' : 'portfolio'
}

async function decodeImage(file: File) {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    try {
      await image.decode()
    } catch (error) {
      const mimeType = getSupportedPhotoMimeType(file)
      if (mimeType === 'image/heic' || mimeType === 'image/heif') {
        throw new Error('Il browser non riesce a leggere questa foto HEIC/HEIF. Su iPhone esportala da Foto scegliendo “Più compatibile”.')
      }
      throw error
    }
    return image
  } finally {
    // L'URL resta necessario fino alla fine di decode(), poi i pixel sono disponibili.
    URL.revokeObjectURL(url)
  }
}
export async function optimizeSiteImage(file: File) {
  if (!getSupportedPhotoMimeType(file)) {
    throw new Error('Usa una fotografia JPG, PNG, WebP o HEIC/HEIF da iPhone.')
  }
  if (file.size > MAX_SOURCE_SIZE) throw new Error('La fotografia supera il limite di 25 MB.')

  const source = await decodeImage(file)
  const ratio = Math.min(1, MAX_EDGE / Math.max(source.naturalWidth, source.naturalHeight))
  const width = Math.max(1, Math.round(source.naturalWidth * ratio))
  const height = Math.max(1, Math.round(source.naturalHeight * ratio))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Il browser non riesce a preparare questa fotografia.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(source, 0, 0, width, height)
  let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY))
  if (!blob) throw new Error('Non è stato possibile ottimizzare la fotografia.')
  // Safari può ignorare il formato richiesto a toBlob e restituire PNG. Non
  // dichiarare mai un tipo o un'estensione diversi dai byte effettivamente creati.
  if (blob.type !== 'image/webp') {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  }
  if (!blob || !['image/webp', 'image/jpeg'].includes(blob.type)) {
    throw new Error('Il browser non riesce a creare una copia fotografica compatibile.')
  }
  if (blob.size > 10 * 1024 * 1024) throw new Error('La copia ottimizzata supera il limite di 10 MB.')
  const extension = blob.type === 'image/webp' ? 'webp' : 'jpg'
  return { blob, width, height, mimeType: blob.type, extension }
}

export async function withSiteImageUrls<T extends SiteImage>(images: T[]): Promise<T[]> {
  if (!supabase) return images
  return Promise.all(images.map(async (image) => {
    if (image.storage_bucket === 'site-public') {
      const { data } = supabase!.storage.from('site-public').getPublicUrl(image.storage_path)
      return { ...image, display_url: data.publicUrl }
    }
    const { data } = await supabase!.storage.from('site-drafts').createSignedUrl(image.storage_path, 3600)
    return { ...image, display_url: data?.signedUrl }
  }))
}

export async function uploadSiteImages({
  kind,
  parentId,
  files,
  altText,
  portfolioKind = 'durante',
  startOrder,
  setFirstAsCover,
  imageIds
}: {
  kind: SiteContentKind
  parentId: string
  files: File[]
  altText: string
  portfolioKind?: SitePortfolioImageKind
  startOrder: number
  setFirstAsCover: boolean
  imageIds?: string[]
}) {
  if (!supabase) throw new Error('Supabase non è configurato.')
  const inserted: SiteImage[] = []
  for (const [index, file] of files.entries()) {
    const optimized = await optimizeSiteImage(file)
    const path = `${folder(kind)}/${parentId}/${crypto.randomUUID()}.${optimized.extension}`
    const { error: uploadError } = await supabase.storage.from('site-drafts').upload(path, optimized.blob, {
      contentType: optimized.mimeType,
      upsert: false,
      cacheControl: '3600'
    })
    if (uploadError) throw new Error(readableError(uploadError))

    const payload = {
      ...(imageIds?.[index] ? { id: imageIds[index] } : {}),
      [parentColumn(kind)]: parentId,
      storage_bucket: 'site-drafts',
      storage_path: path,
      alt_text: altText.slice(0, 300) || 'Fotografia LuLab',
      caption: null,
      mime_type: optimized.mimeType,
      size_bytes: optimized.blob.size,
      width: optimized.width,
      height: optimized.height,
      is_cover: setFirstAsCover && index === 0,
      sort_order: startOrder + index,
      ...(kind === 'portfolio' ? { image_kind: portfolioKind } : {})
    }
    const { data, error: metadataError } = await supabase.from(imageTable(kind)).insert(payload).select().single()
    if (metadataError) {
      if (imageIds?.[index]) {
        const { data: committed, error: readError } = await supabase.from(imageTable(kind)).select('*').eq('id', imageIds[index]).maybeSingle()
        // A lost response must never delete an object whose metadata was committed.
        if (committed?.storage_path === path) { inserted.push(committed as SiteImage); continue }
        if (readError) throw new Error('Impossibile verificare il salvataggio della copia privata. Riprova l’importazione; nessun originale è stato modificato.')
      }
      await supabase.storage.from('site-drafts').remove([path])
      throw new Error(readableError(metadataError))
    }
    inserted.push(data as SiteImage)
  }
  return withSiteImageUrls(inserted)
}

/** Downloads only through the signed-in user's RLS; never moves operational files. */
export async function importProjectJobPhotos(projectId: string): Promise<PhotoImportReport> {
  if (!supabase) throw new Error('Supabase non è configurato.')
  const client = supabase
  const report: PhotoImportReport = { imported: 0, skipped: 0, failures: [] }
  const { data: source, error: sourceError } = await client.from('site_portfolio_project_sources').select('job_id').eq('portfolio_project_id', projectId).maybeSingle()
  if (sourceError) throw new Error(readableError(sourceError))
  if (!source?.job_id) throw new Error('Questo progetto non è collegato a una commessa.')
  const { data: files, error: fileError } = await client.from('job_files').select('*').eq('job_id', source.job_id).order('created_at').order('id')
  if (fileError) throw new Error(readableError(fileError))
  const { data: current, error: imageError } = await client.from('site_portfolio_images').select('*').eq('portfolio_project_id', projectId)
  if (imageError) throw new Error(readableError(imageError))
  const existing = (current ?? []) as SitePortfolioImage[]
  const knownIds = new Set(existing.map(image => image.id))
  let order = Math.max(-1, ...existing.map(image => image.sort_order)) + 1
  let firstImportedId: string | undefined
  for (const file of ((files ?? []) as JobFile[]).filter(isJobPhoto)) {
    const id = await importedPhotoId(projectId, file.id)
    if (knownIds.has(id)) { report.skipped++; continue }
    try {
      if (file.size_bytes > MAX_SOURCE_SIZE) throw new Error('Fotografia oltre il limite di 25 MB.')
      const { data: blob, error } = await client.storage.from('job-files').download(file.storage_path)
      if (error || !blob) throw new Error(error ? readableError(error) : 'Fotografia non accessibile.')
      // Do not copy filenames, notes or other potentially private operational metadata.
      const photo = new File([blob], `fotografia.${file.mime_type.split('/')[1]}`, { type: file.mime_type })
      await uploadSiteImages({ kind: 'portfolio', parentId: projectId, files: [photo], altText: 'Fotografia del progetto LuLab', portfolioKind: file.category, startOrder: order++, setFirstAsCover: false, imageIds: [id] })
      knownIds.add(id)
      firstImportedId ??= id
      report.imported++
    } catch (error) {
      // Another tab may have inserted this same identity. Its private/public copy wins;
      // uploadSiteImages removes only the random storage path owned by this attempt.
      const { data: duplicate } = await client.from('site_portfolio_images').select('id').eq('id', id).maybeSingle()
      if (duplicate) report.skipped++
      else report.failures.push(`Foto ${file.category} (${report.imported + report.skipped + report.failures.length + 1}): ${readableError(error)}`)
    }
  }
  // Only an initially empty gallery receives an automatic cover. Existing choices stay intact.
  if (existing.length === 0 && firstImportedId) {
    const { data: covers, error: coverReadError } = await client.from('site_portfolio_images').select('id').eq('portfolio_project_id', projectId).eq('is_cover', true)
    if (coverReadError) report.failures.push('Impossibile verificare la copertina: sceglila nella galleria.')
    else if (!covers?.length) {
      const { error } = await client.from('site_portfolio_images').update({ is_cover: true }).eq('id', firstImportedId)
      if (error && error.code !== '23505') report.failures.push('Foto importate: scegli la copertina nella galleria.')
    }
  }
  return report
}

async function moveImage(kind: SiteContentKind, image: SiteImage, targetBucket: 'site-drafts' | 'site-public') {
  if (!supabase || image.storage_bucket === targetBucket) return image
  const sourceBucket = image.storage_bucket
  const { data: source, error: downloadError } = await supabase.storage.from(sourceBucket).download(image.storage_path)
  if (downloadError || !source) throw new Error(downloadError ? readableError(downloadError) : 'File sorgente non disponibile.')

  const { error: uploadError } = await supabase.storage.from(targetBucket).upload(image.storage_path, source, {
    contentType: image.mime_type,
    cacheControl: targetBucket === 'site-public' ? '31536000' : '3600',
    upsert: true
  })
  if (uploadError) throw new Error(readableError(uploadError))

  const { data, error: metadataError } = await supabase.from(imageTable(kind))
    .update({ storage_bucket: targetBucket })
    .eq('id', image.id)
    .select()
    .single()
  if (metadataError) {
    await supabase.storage.from(targetBucket).remove([image.storage_path])
    throw new Error(readableError(metadataError))
  }

  const { error: removeError } = await supabase.storage.from(sourceBucket).remove([image.storage_path])
  if (removeError) {
    await supabase.from(imageTable(kind)).update({ storage_bucket: sourceBucket }).eq('id', image.id)
    await supabase.storage.from(targetBucket).remove([image.storage_path])
    throw new Error(readableError(removeError))
  }
  return data as SiteImage
}

export async function changeSitePublication({
  kind,
  parentId,
  images,
  nextStatus
}: {
  kind: SiteContentKind
  parentId: string
  images: SiteImage[]
  nextStatus: Extract<SitePublicationStatus, 'pubblicato' | 'non_pubblicato'>
}) {
  if (!supabase) throw new Error('Supabase non è configurato.')
  const targetBucket = nextStatus === 'pubblicato' ? 'site-public' : 'site-drafts'
  const moved: Array<{ before: SiteImage; after: SiteImage }> = []
  const incomingCover = images.find((image) => image.storage_bucket !== targetBucket && image.is_cover)
  const existingTargetCover = images.find((image) => image.storage_bucket === targetBucket && image.is_cover)
  let targetCoverCleared = false
  try {
    if (incomingCover && existingTargetCover) {
      const { error: coverError } = await supabase.from(imageTable(kind)).update({ is_cover: false }).eq('id', existingTargetCover.id)
      if (coverError) throw new Error(readableError(coverError))
      targetCoverCleared = true
    }
    for (const image of images) {
      if (image.storage_bucket === targetBucket) continue
      const after = await moveImage(kind, image, targetBucket)
      moved.push({ before: image, after })
    }
    const table = kind === 'collection' ? 'site_collection_items' : 'site_portfolio_projects'
    const { error } = await supabase.from(table).update({ publication_status: nextStatus }).eq('id', parentId)
    if (error) throw new Error(readableError(error))
  } catch (error) {
    for (const item of moved.reverse()) {
      try {
        await moveImage(kind, item.after, item.before.storage_bucket)
      } catch {
        // Il messaggio originale resta quello più utile; load() mostrerà lo stato reale.
      }
    }
    if (targetCoverCleared && existingTargetCover) {
      await supabase.from(imageTable(kind)).update({ is_cover: true }).eq('id', existingTargetCover.id)
    }
    throw error
  }
}

export async function deleteSiteImage(kind: SiteContentKind, image: SiteImage) {
  if (!supabase) throw new Error('Supabase non è configurato.')
  const { error: metadataError } = await supabase.from(imageTable(kind)).delete().eq('id', image.id)
  if (metadataError) throw new Error(readableError(metadataError))
  const { error: storageError } = await supabase.storage.from(image.storage_bucket).remove([image.storage_path])
  if (storageError) {
    const payload = { ...image } as Record<string, unknown>
    delete payload.display_url
    const { error: restoreError } = await supabase.from(imageTable(kind)).insert(payload)
    if (restoreError) throw new Error(`File non rimosso e metadati non ripristinati: ${readableError(storageError)}`)
    throw new Error(readableError(storageError))
  }
}
