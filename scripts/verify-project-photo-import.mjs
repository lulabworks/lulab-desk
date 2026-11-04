import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const helpers = moduleUrl(compile(await read('src/lib/projectPhotoImport.ts')))
const { importedPhotoId } = await import(helpers)
const images = new Map(), objects = new Map()
let files = [], failures = new Set(), lostResponse = false
const file = (id, category, mime_type = 'image/jpeg') => ({ id, category, mime_type, job_id: 'job', file_name: 'CLIENTE-PRIVATO.jpg', note: 'NOTA-PRIVATA', storage_path: `original/${id}`, size_bytes: 30 })
const original = new Blob(['pixels'], { type: 'image/jpeg' })
globalThis.__photoClient = {
  from(table) {
    let filters = [], insert, changes
    const q = {
      select() { return q }, eq(k, v) { filters.push([k, v]); return q }, order() { return q },
      insert(p) { insert = p; return q }, update(p) { changes = p; return q },
      async run() {
        if (table === 'site_portfolio_project_sources') return { data: { job_id: 'job' } }
        if (table === 'job_files') return { data: files }
        assert.equal(table, 'site_portfolio_images')
        if (insert) {
          if (images.has(insert.id)) return { data: null, error: { code: '23505', message: 'duplicate' } }
          images.set(insert.id, { ...insert })
          if (lostResponse) { lostResponse = false; return { error: { message: 'response lost' } } }
          return { data: insert }
        }
        const rows = [...images.values()].filter(row => filters.every(([k, v]) => row[k] === v))
        if (changes) rows.forEach(row => Object.assign(row, changes))
        return { data: rows }
      },
      async maybeSingle() { const r = await q.run(); return { ...r, data: Array.isArray(r.data) ? r.data[0] : r.data } },
      single() { return q.run() }, then(resolve, reject) { return q.run().then(resolve, reject) }
    }
    return q
  },
  storage: { from(bucket) { return {
    async download(path) { assert.equal(bucket, 'job-files'); return failures.has(path) ? { error: { message: 'not accessible' } } : { data: original } },
    async upload(path, blob) { assert.equal(bucket, 'site-drafts'); assert(!objects.has(path)); objects.set(path, blob); return {} },
    async remove(paths) { assert.equal(bucket, 'site-drafts'); paths.forEach(path => objects.delete(path)); return {} },
    async createSignedUrl(path) { return { data: { signedUrl: `private:${path}` } } }
  } } }
}
// Exercise the real optimizer including the Safari JPEG fallback, without browser/network access.
let jpegFallback = false
globalThis.Image = class { naturalWidth = 4400; naturalHeight = 2200; async decode() {} }
globalThis.document = { createElement() { return { getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob(cb, type) { cb(new Blob(['optimized'], { type: jpegFallback && type === 'image/webp' ? 'image/png' : type })) } } } }
let source = compile(await read('src/lib/site.ts'))
source = source.replace(/import .* from ['"]\.\/supabase['"];?/, 'const supabase = globalThis.__photoClient; const readableError = e => e.message ?? String(e);')
source = source.replace("'./photoUpload'", JSON.stringify(moduleUrl(compile(await read('src/lib/photoUpload.ts')))))
source = source.replace("'./projectPhotoImport'", JSON.stringify(helpers))
const { importProjectJobPhotos } = await import(moduleUrl(source))
files = [file('a', 'prima'), file('b', 'durante'), file('c', 'dopo'), file('pdf', 'prima', 'application/pdf'), file('doc', 'documento')]
let report = await importProjectJobPhotos('project')
assert.equal(report.imported, 3); assert.equal(report.failures.length, 0)
assert.deepEqual([...images.values()].map(i => i.image_kind), ['prima', 'durante', 'dopo'])
assert.equal([...images.values()].filter(i => i.is_cover).length, 1)
for (const image of images.values()) {
  assert.equal(image.storage_bucket, 'site-drafts'); assert.equal(image.width, 2200)
  assert(!JSON.stringify(image).includes('PRIVAT')); assert(!image.storage_path.startsWith('original/'))
}
const before = structuredClone([...images.values()])
report = await importProjectJobPhotos('project'); assert.equal(report.skipped, 3); assert.equal(report.imported, 0)
assert.deepEqual([...images.values()], before)
// A manually chosen cover/order survives new imports, including partially inaccessible sources.
for (const i of images.values()) { i.is_cover = i.image_kind === 'dopo'; i.sort_order += 10 }
const selected = structuredClone([...images.values()])
files.push(file('new', 'dopo'), file('bad', 'prima'))
failures.add('original/bad'); jpegFallback = true
report = await importProjectJobPhotos('project'); assert.equal(report.imported, 1); assert.equal(report.failures.length, 1)
assert.equal(images.get(await importedPhotoId('project', 'new')).mime_type, 'image/jpeg')
for (const i of selected) assert.deepEqual(images.get(i.id), i)
failures.clear(); report = await importProjectJobPhotos('project'); assert.equal(report.imported, 1)
// Both requests use the same identity; one insert wins, loser cleans up only its copy.
files.push(file('concurrent', 'prima'))
await Promise.all([importProjectJobPhotos('project'), importProjectJobPhotos('project')])
assert.equal(images.size, 6); assert.equal(objects.size, 6)
files.push(file('lost', 'dopo')); lostResponse = true
report = await importProjectJobPhotos('project'); assert.equal(report.imported, 1)
assert(objects.has(images.get(await importedPhotoId('project', 'lost')).storage_path))
assert.notEqual(await importedPhotoId('other-project', 'a'), await importedPhotoId('project', 'a'))
assert.equal(await original.text(), 'pixels')
const creation = await read('src/pages/SitePage.tsx')
assert.match(creation, /importProjectJobPhotos\(data.id\)/)
assert(!source.includes("publication_status: 'pubblicato'"))
console.log('Importazione foto progetti: categorie, filtri, copie private, copertina, retry, nuove foto, errori parziali, concorrenza, risposta persa e fallback Safari JPEG: OK')
