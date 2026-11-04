import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const id = '12345678-1234-4234-8234-123456789012', prefix = `portfolio/${id}/`
let project, images, objects, link, owner, fault, sync, calls
const original = { job: 'original job', files: ['original/photo.jpg', 'original/document.pdf'] }
const originalSnapshot = structuredClone(original)
function reset(published = false) {
  project = { id, publication_status: published ? 'pubblicato' : 'bozza' }; owner = true; fault = ''; sync = 0; calls = []
  images = [{ id: 'image', portfolio_project_id: id, storage_bucket: published ? 'site-public' : 'site-drafts', storage_path: `${prefix}photo.jpg` }]
  objects = new Map([['site-public', new Set()], ['site-drafts', new Set()]])
  objects.get(images[0].storage_bucket).add(images[0].storage_path)
  objects.get('site-public').add('portfolio/OTHER/preserve.jpg'); link = true
}
globalThis.__deletionClient = {
  async rpc(name) { assert.equal(name, 'is_site_owner'); return { data: owner } },
  from(table) {
    assert(['site_portfolio_projects', 'site_portfolio_images', 'site_portfolio_project_sources'].includes(table))
    let deleting = false, changes
    const q = {
      eq(key, value) { assert.equal(value, id); return q }, select() { return q }, delete() { deleting = true; return q }, update(p) { changes = p; return q },
      async run() {
        calls.push(table)
        if (table === 'site_portfolio_images') return { data: images }
        if (table === 'site_portfolio_project_sources') return fault === 'verify-link' ? { error: { message: 'network' } } : { data: link ? [{ portfolio_project_id: id }] : [] }
        if (deleting) {
          assert.equal(images.length, 0)
          assert.equal(objects.get('site-public').has(`${prefix}photo.jpg`), false)
          if (fault === 'db') return { error: { message: 'db failed' } }
          if (fault === 'rls') return { data: [] }
          assert.equal(project.publication_status, 'non_pubblicato'); project = null; link = false
          return { data: [{ id }] }
        }
        if (changes) Object.assign(project, changes)
        return { data: project }
      },
      maybeSingle() { return q.run() }, then(resolve, reject) { return q.run().then(resolve, reject) }
    }; return q
  },
  storage: { from(bucket) { assert(['site-drafts', 'site-public'].includes(bucket)); return {
    async list(folder, { offset, limit }) {
      const entries = [...objects.get(bucket)].filter(p => p.startsWith(folder + '/')).sort().slice(offset, offset + limit).map(path => ({ id: path, name: path.slice(folder.length + 1) }))
      return fault === 'list' ? { error: { message: 'list failed' } } : { data: entries }
    },
    async remove(paths) {
      paths.forEach(p => assert(p.startsWith(prefix)))
      if (fault === 'storage') return { error: { message: 'storage failed' } }
      if (fault !== 'silent-storage') paths.forEach(p => objects.get(bucket).delete(p))
      return {}
    }
  } } }
}
const siteSource = compile(await read('src/lib/site.ts'))
const deletionBody = siteSource.slice(siteSource.indexOf('export async function changeSitePublication'))
// Exercise the real existing metadata-first deletion/rollback helper.
const helpers = url(`const supabase = globalThis.__deletionClient; const readableError = e => e.message;
const imageTable = () => 'site_portfolio_images';
${deletionBody}`)
// Extend the mock for the metadata helper's insert/delete operations.
const baseFrom = globalThis.__deletionClient.from
globalThis.__deletionClient.from = table => {
  if (table !== 'site_portfolio_images') return baseFrom(table)
  let remove = false, restored
  const q = { select() { return q }, eq() { return q }, delete() { remove = true; return q }, insert(p) { restored = p; return q },
    then(resolve, reject) { return Promise.resolve().then(() => {
      if (fault === 'metadata' && remove) return { error: { message: 'metadata failed' } }
      if (remove) images = []
      if (restored) images.push(restored)
      return { data: images }
    }).then(resolve, reject) }
  }; return q
}
let source = compile(await read('src/lib/siteProjectDeletion.ts'))
source = source.replace(/import .* from ['"]\.\/supabase['"];?/, 'const supabase=globalThis.__deletionClient; const readableError=e=>e.message ?? String(e);')
source = source.replace("'./site'", JSON.stringify(helpers))
const { deleteSiteProject } = await import(url(source))
const run = () => deleteSiteProject(id, () => sync++)
for (const published of [false, true]) {
  reset(published); await run(); assert.equal(project, null); assert.equal(link, false); assert.equal(images.length, 0)
  assert.equal(sync, published ? 1 : 0)
  assert(objects.get('site-public').has('portfolio/OTHER/preserve.jpg'))
  await run(); assert.deepEqual(original, originalSnapshot)
}
reset(); owner = false; await assert.rejects(run, /owner/); assert(project); assert.equal(images.length, 1)
for (const failure of ['metadata', 'storage', 'silent-storage', 'list', 'db', 'rls', 'verify-link']) {
  reset(true); fault = failure
  await assert.rejects(run); assert.equal(sync, 1)
  fault = ''; await run(); assert.equal(project, null); assert.equal(link, false)
}
reset(); images = []; for (let i=0;i<205;i++) objects.get('site-drafts').add(`${prefix}orphan-${i}.jpg`)
await run(); assert.equal(objects.get('site-drafts').size, 0)
assert.deepEqual(original, originalSnapshot)
const editor = await read('src/pages/SiteContentEditorPage.tsx')
assert.match(editor, /Elimina definitivamente/); assert.match(editor, /content.title/); assert.match(editor, /navigate\('\/sito\?area=projects/)
console.log('Eliminazione progetti: bozze/pubblicati, owner, foto e orfani paginati, RLS silenziosa, errori/rollback/retry, sincronizzazione e conservazione dati operativi: OK (client simulato)')
