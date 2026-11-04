import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const types = url(compile(await read('src/lib/types.ts')))
const categories = url(compile(await read('src/lib/siteCategories.ts')).replace("'./types'", JSON.stringify(types)))
const { projectCategoryFromJob, projectCategoryOptions, SITE_PROJECT_CATEGORIES } = await import(categories)
assert.deepEqual(SITE_PROJECT_CATEGORIES, ['Restauro', 'Produzione su misura', 'Recupero e rivendita', 'Trattamento antitarlo'])
for (const [i, type] of ['restauro', 'su_misura', 'recupero', 'antitarlo'].entries()) assert.equal(projectCategoryFromJob(type), SITE_PROJECT_CATEGORIES[i])
assert(!projectCategoryOptions('').includes(''))
assert.equal(projectCategoryOptions('Restauro').length, 4)
const legacy = 'Restauro infissi storico'
assert.equal(projectCategoryOptions(legacy).at(-1), legacy)
// Render the real shared component with a native select in place of its UI wrapper.
globalThis.__categoryReact = React
let component = compile(await read('src/components/ProjectCategorySelect.tsx'))
component = 'const React=globalThis.__categoryReact;\n' + component.replace("'../lib/siteCategories'", JSON.stringify(categories)).replace(/import .* from ['"]\.\/ui['"];?/, 'const Select = props => React.createElement("select", props);')
const { ProjectCategorySelect } = await import(url(component))
const html = value => renderToStaticMarkup(React.createElement(ProjectCategorySelect, { value, onChange() {} }))
assert.match(html(''), /<option value="" disabled="" selected="">Seleziona una categoria/)
assert.match(html(legacy), /value="Restauro infissi storico" selected=""/)
assert.match(html('Produzione su misura'), /value="Produzione su misura" selected=""/)
assert.match(html(''), /required=""/)
const creation = await read('src/pages/SitePage.tsx'), editor = await read('src/pages/SiteContentEditorPage.tsx')
assert.match(creation, /category: source \? projectCategoryFromJob\(source.type\) : ''/)
assert(!creation.includes("category: createForm.category.trim() || 'Restauro'"))
assert.match(editor, /category: \(content as SitePortfolioProject\).category,/)
assert.match(creation, /item.category.*toLocaleLowerCase/)
console.log('Categorie Progetti: tassonomia, preselezione, scelta obbligatoria, menu condiviso, valori storici e ricerca: OK')
