import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const files = [
  'src/components/JobFilesPanel.tsx',
  'src/pages/RecoveryDetailPage.tsx',
  'src/pages/SiteContentEditorPage.tsx'
]
const sources = await Promise.all(files.map((path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')))
for (const [index, source] of sources.entries()) {
  assert.doesNotMatch(source, /capture\s*=/, `${files[index]} non deve forzare la fotocamera`)
  assert.match(source, /image\/\*/, `${files[index]} deve lasciare disponibile il selettore foto nativo`)
}

const helper = await readFile(new URL('../src/lib/photoUpload.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(helper, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText
const { getSupportedPhotoMimeType, preparePhotoForUpload } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const heic = new File(['original-heic'], 'IMG_1234.HEIC', { type: 'image/heic' })
const heifWithoutMime = new File(['original-heif'], 'IMG_1235.heif', { type: '' })
assert.equal(getSupportedPhotoMimeType(heic), 'image/heic')
assert.equal(getSupportedPhotoMimeType(heifWithoutMime), 'image/heif')
assert.equal(getSupportedPhotoMimeType(new File(['gif'], 'image.gif', { type: 'image/gif' })), null)

const originalImage = globalThis.Image
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL
const originalDocument = globalThis.document
try {
  globalThis.Image = class {
    naturalWidth = 6000
    naturalHeight = 4000
    set src(_value) { queueMicrotask(() => this.onload?.()) }
  }
  URL.createObjectURL = () => 'blob:test-heic'
  URL.revokeObjectURL = () => {}
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({ drawImage() {} }),
      toBlob: (callback, mimeType) => callback(new Blob(['jpeg-converted'], { type: mimeType }))
    })
  }

  const converted = await preparePhotoForUpload(heic, 15 * 1024 * 1024)
  assert.equal(converted.type, 'image/jpeg')
  assert.equal(converted.name, 'IMG_1234.jpg')
  assert.equal(converted.size, 14)
  await assert.rejects(preparePhotoForUpload(heic, 4), /supera il limite/)
} finally {
  globalThis.Image = originalImage
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
  globalThis.document = originalDocument
}

console.log('Selettori foto non forzano la fotocamera; HEIC/HEIF iPhone vengono normalizzati in JPEG: OK')
