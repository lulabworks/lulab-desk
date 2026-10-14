import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [migration, securityTest, app, shell, sitePage, editorPage, siteLib] = await Promise.all([
  readFile(new URL('../supabase/migrations/004_public_site.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/tests/004_public_site_security.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/SitePage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/SiteContentEditorPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/site.ts', import.meta.url), 'utf8')
])

for (const table of [
  'site_editors',
  'site_collection_items',
  'site_collection_item_sources',
  'site_collection_images',
  'site_portfolio_projects',
  'site_portfolio_project_sources',
  'site_portfolio_images',
  'customer_inquiries',
  'customer_inquiry_files'
]) {
  assert.match(migration, new RegExp(`create table public\\.${table} \\(`), `Tabella mancante: ${table}`)
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`), `RLS mancante: ${table}`)
}

assert.match(migration, /'site-drafts',[\s\S]*?false/)
assert.match(migration, /'site-public',[\s\S]*?true/)
assert.match(migration, /'inquiry-uploads',[\s\S]*?false/)
assert.doesNotMatch(migration, /grant[^;]+customer_inquiries[^;]+to anon/is)
assert.match(migration, /show_price and public_price is not null/)
assert.match(migration, /not show_price and public_price is null/)
assert.match(migration, /site_portfolio_image_kind as enum \('prima', 'durante', 'dopo'\)/)
assert.match(migration, /pg_advisory_xact_lock/)

assert.match(securityTest, /set local role anon;/)
assert.match(securityTest, /Media lifecycle fallito/)
assert.match(securityTest, /Integrità allegati fallita/)
assert.match(securityTest, /rollback;/)

assert.match(app, /path="\/sito"/)
assert.match(app, /path="\/sito\/collezione\/:id"/)
assert.match(app, /path="\/sito\/progetti\/:id"/)
assert.match(shell, /to: '\/sito', label: 'Sito'/)

assert.match(sitePage, /rpc\('is_site_editor'\)/)
assert.match(sitePage, /show_price: false/)
assert.match(sitePage, /public_price: null/)
assert.match(sitePage, /customer_inquiry_files/)
assert.match(editorPage, /changeSitePublication/)
assert.match(editorPage, /requestSiteRebuild/)
assert.match(siteLib, /optimizeSiteImage/)
assert.match(siteLib, /from\('site-drafts'\)/)
assert.match(siteLib, /targetBucket === 'site-public'/)
assert.match(siteLib, /moved\.reverse\(\)/)

console.log('Schema e RLS sito pubblico: OK')
console.log('Navigazione ed editor Sito: OK')
console.log('Prezzi pubblici disattivati: OK')
console.log('Ciclo immagini bozza/pubblicazione/ritiro: OK')
console.log('Richieste e allegati privati: OK')
