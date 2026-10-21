const PHOTO_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif'
}

const ACCEPTED_PHOTO_MIME_TYPES = new Set(Object.values(PHOTO_MIME_BY_EXTENSION))
const MAX_CONVERTED_EDGE = 4096

export function getSupportedPhotoMimeType(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const mimeType = file.type.toLowerCase()
  const extensionMimeType = PHOTO_MIME_BY_EXTENSION[extension]
  const resolved = mimeType.startsWith('image/heic') || mimeType.startsWith('image/heif')
    ? mimeType.split('-')[0]
    : mimeType || extensionMimeType

  if (extensionMimeType?.startsWith('image/heic') || extensionMimeType?.startsWith('image/heif')) {
    return extensionMimeType
  }
  return ACCEPTED_PHOTO_MIME_TYPES.has(resolved) ? resolved : null
}

function decodePhoto(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Il browser non riesce a leggere questa foto HEIC/HEIF. Su iPhone esportala da Foto scegliendo “Più compatibile”.'))
    }
    image.src = url
  })
}

export async function preparePhotoForUpload(file: File, maxBytes: number) {
  if (file.size > maxBytes) throw new Error('La fotografia supera il limite consentito.')
  const mimeType = getSupportedPhotoMimeType(file)
  if (!mimeType) throw new Error('Formato non supportato. Usa JPG, PNG, WebP o una foto HEIC/HEIF da iPhone.')

  if (!mimeType.startsWith('image/heic') && !mimeType.startsWith('image/heif')) {
    return file.type === mimeType ? file : new File([file], file.name, { type: mimeType, lastModified: file.lastModified })
  }

  const image = await decodePhoto(file)
  const ratio = Math.min(1, MAX_CONVERTED_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Il browser non riesce a convertire questa fotografia.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob || blob.type !== 'image/jpeg') throw new Error('Non è stato possibile convertire la foto HEIC/HEIF in JPEG.')
  if (blob.size > maxBytes) throw new Error('La foto convertita supera il limite consentito.')

  const name = file.name.replace(/\.(heic|heif)$/i, '') + '.jpg'
  return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
}
