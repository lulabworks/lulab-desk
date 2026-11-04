import type { JobFile, SitePortfolioImageKind } from './types'

// Stable, opaque identity; the existing image primary key arbitrates concurrent imports.
export async function importedPhotoId(projectId: string, sourceId: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`lulab:job-photo:v1:${projectId}:${sourceId}`)))
  digest[6] = (digest[6] & 15) | 128
  digest[8] = (digest[8] & 63) | 128
  const hex = [...digest.slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function isJobPhoto(file: JobFile): file is JobFile & { category: SitePortfolioImageKind } {
  return ['prima', 'durante', 'dopo'].includes(file.category) && file.mime_type.startsWith('image/')
}

export interface PhotoImportReport { imported: number; skipped: number; failures: string[] }
export function photoImportMessage(report: PhotoImportReport) {
  return `${report.imported} foto importate nella galleria privata; ${report.skipped} già presenti.${report.failures.length ? ` ${report.failures.length} foto non importate: ${report.failures.join(' · ')}. Puoi riprovare senza duplicare le copie riuscite.` : ''}`
}
