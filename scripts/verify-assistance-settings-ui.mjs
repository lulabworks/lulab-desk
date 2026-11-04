import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import React from 'react'
let confirm = false
let snapshot = { enabled: false, available: true, error: '' }
const writes = []
globalThis.__assistanceUiTest = {
  React,
  useState: () => [confirm, value => { confirm = value }],
  useSyncExternalStore: () => snapshot,
  preference: { subscribe() {}, getSnapshot() {}, set(value) { writes.push(value) } }
}
const source = await readFile(new URL('../src/components/AdaptiveAssistanceSettings.tsx', import.meta.url), 'utf8')
let code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
code = code.replace(/import .* from ['"]react['"];?/, 'const { React, useState, useSyncExternalStore } = globalThis.__assistanceUiTest;')
code = code.replace(/import .* from ['"]..\/lib\/adaptive\/assistance['"];?/, 'const assistancePreference = globalThis.__assistanceUiTest.preference;')
code = code.replace(/import .* from ['"]\.\/ui['"];?/, 'const Button="button", Modal="dialog", ModalPresence="section", Notice="aside", Panel="section";')
const { AdaptiveAssistanceSettings } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
function nodes(node) {
  return React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : []
}
const render = () => nodes(AdaptiveAssistanceSettings())
const toggle = tree => tree.find(n => n.props.role === 'switch')
let tree = render()
assert.equal(tree.find(n => n.type === 'details').props.open, undefined)
assert.equal(toggle(tree).props['aria-checked'], false)
toggle(tree).props.onClick()
assert.deepEqual(writes, [], 'opening confirmation must not persist the preference')
tree = render(); assert(tree.some(n => n.type === 'dialog'))
tree.find(n => n.type === 'button' && n.props.children === 'Annulla').props.onClick()
assert.deepEqual(writes, []); assert.equal(confirm, false)
toggle(render()).props.onClick()
tree = render()
tree.find(n => n.type === 'button' && n.props.children === 'Conferma esclusione').props.onClick()
assert.deepEqual(writes, [true]); assert.equal(confirm, false)
snapshot = { enabled: true, available: true, error: '' }
tree = render()
const summary = tree.find(n => n.type === 'summary')
assert(nodes(summary).some(n => n.props.children === 'Dispositivo escluso dalle statistiche'))
toggle(tree).props.onClick(); assert.deepEqual(writes, [true, false]); assert.equal(confirm, false)
snapshot = { enabled: false, available: false, error: 'Memoria non disponibile' }
tree = render(); assert(tree.some(n => n.props.children === snapshot.error))
assert(nodes(tree.find(n => n.type === 'summary')).some(n => n.props.children === 'Stato della preferenza non verificabile'))
console.log('UI assistenza: sezione chiusa, stato nel riepilogo, conferma/annullamento, disattivazione diretta ed errori: OK (test del componente con hook simulati)')
