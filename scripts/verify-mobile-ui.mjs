import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../src/lib/modalViewport.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { modalViewportSnapshot, modalFieldScrollDelta } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const layout = { width: 390, height: 844 }
assert.deepEqual(modalViewportSnapshot(null, layout), { top: 0, left: 0, ...layout })
assert.deepEqual(modalViewportSnapshot({ width: 0, height: 0, offsetTop: -20, offsetLeft: NaN }, layout), { top: 0, left: 0, ...layout }, 'A transient zero viewport during resume must not collapse the sheet')
assert.deepEqual(modalViewportSnapshot({ width: 390, height: 360, offsetTop: 25, offsetLeft: 0 }, layout), { top: 25, left: 0, width: 390, height: 360 }, 'A valid keyboard viewport and its offset must be preserved')
const region = { top: 100, bottom: 400 }
assert.equal(modalFieldScrollDelta({ top: 125, bottom: 169 }, region), 0)
assert.equal(modalFieldScrollDelta({ top: 80, bottom: 124 }, region), -32)
assert.equal(modalFieldScrollDelta({ top: 410, bottom: 454 }, region), 66)
assert.equal(modalFieldScrollDelta({ top: 112, bottom: 700 }, region), 0, 'A tall textarea must remain aligned at its start')
console.log('Modal: ripristino viewport nullo, tastiera/offset e scorrimento confinato dei campi: OK')
