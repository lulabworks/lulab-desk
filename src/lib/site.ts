import { readableError, supabase } from './supabase'
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
    await image.decode()
    return image
  } finally {
    // L'URL resta necessario fino alla fine di decode(), poi i pixel sono disponibili.
    URL.revokeObjectURL(url)
  }
}
export async function optimizeSiteImage(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Usa una fotografia JPG, PNG o WebP.')
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
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY))
  if (!blob) throw new Error('Non è stato possibile ottimizzare la fotografia.')
  if (blob.size > 10 * 1024 * 1024) throw new Error('La copia ottimizzata supera il limite di 10 MB.')
  return { blob, width, height }
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
  setFirstAsCover
}: {
  kind: SiteContentKind
  parentId: string
  files: File[]
  altText: string
  portfolioKind?: SitePortfolioImageKind
  startOrder: number
  setFirstAsCover: boolean
}) {
  if (!supabase) throw new Error('Supabase non è configurato.')
  const inserted: SiteImage[] = []
  for (const [index, file] of files.entries()) {
    const optimized = await optimizeSiteImage(file)
    const path = `${folder(kind)}/${parentId}/${crypto.randomUUID()}.webp`
    const { error: uploadError } = await supabase.storage.from('site-drafts').upload(path, optimized.blob, {
      contentType: 'image/webp',
      upsert: false,
      cacheControl: '3600'
    })
    if (uploadError) throw new Error(readableError(uploadError))

    const payload = {
      [parentColumn(kind)]: parentId,
      storage_bucket: 'site-drafts',
      storage_path: path,
      alt_text: altText.slice(0, 300) || 'Fotografia LuLab',
      caption: null,
      mime_type: 'image/webp',
      size_bytes: optimized.blob.size,
      width: optimized.width,
      height: optimized.height,
      is_cover: setFirstAsCover && index === 0,
      sort_order: startOrder + index,
      ...(kind === 'portfolio' ? { image_kind: portfolioKind } : {})
    }
    const { data, error: metadataError } = await supabase.from(imageTable(kind)).insert(payload).select().single()
    if (metadataError) {
      await supabase.storage.from('site-drafts').remove([path])
      throw new Error(readableError(metadataError))
    }
    inserted.push(data as SiteImage)
  }
  return withSiteImageUrls(inserted)
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
