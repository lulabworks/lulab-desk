import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

// Use an already installed browser runner; do not download browsers or add app dependencies.
const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch {
  const runtime = process.env.LULAB_PLAYWRIGHT_MODULE ?? `${process.env.HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`
  playwright = require(runtime)
}
const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Input} from '/src/components/ui.tsx';
function Test() {
 const initial={zero:0,existing:125,optional:'',decimal:1.25,text:'Codice 00125',date:'2026-10-24'};
 const [values,setValues]=useState(initial),[saved,setSaved]=useState(initial),[changes,setChanges]=useState(0),[submits,setSubmits]=useState(0),[open,setOpen]=useState(true);
 return React.createElement('form',{onSubmit:e=>{e.preventDefault();setSubmits(n=>n+1);setSaved(values)}},
  open && Object.entries(values).map(([key,value])=>React.createElement('label',{key},key,React.createElement(Input,{
   'aria-label':key,type:key==='text'?'text':key==='date'?'date':'number',value,required:key==='zero',
   min:key==='decimal'?0:undefined,max:key==='decimal'?1000:undefined,step:key==='decimal'||key==='existing'?'0.01':'1',
   onChange:e=>{const next=e.target.value;setChanges(n=>n+1);setValues(v=>({...v,[key]:key==='text'||key==='date'?next:next===''?'':Number(next)}))}
  }))),
  React.createElement('button',{type:'submit'},'Salva'),
  React.createElement('button',{type:'button',onPointerDown:e=>e.preventDefault(),onClick:()=>setSaved(values)},'Salva senza blur'),
  React.createElement('button',{type:'button',onClick:()=>{setOpen(false);setValues(saved)}},'Annulla'),
  React.createElement('button',{type:'button',onClick:()=>setOpen(true)},'Riapri'),
  React.createElement('output',{id:'values'},JSON.stringify(values)),React.createElement('output',{id:'saved'},JSON.stringify(saved)),
  React.createElement('output',{id:'changes'},changes),React.createElement('output',{id:'submits'},submits));
}
createRoot(document.getElementById('root')).render(React.createElement(Test));`
const cacheDir=await mkdtemp(join(tmpdir(),'lulab-fields-'))
const server = await createServer({ configFile:false,cacheDir,root:fileURLToPath(new URL('..',import.meta.url)),
 resolve:{dedupe:['react','react-dom']},optimizeDeps:{entries:[],include:['react','react-dom','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime','lucide-react','motion/react']},
 plugins:[react(),{name:'isolated-field-fixture',resolveId:id=>id==='/__fields.jsx'?id:null,load:id=>id==='/__fields.jsx'?fixture:null,
 configureServer(server){server.middlewares.use('/__fields.html',async(_,response)=>{response.setHeader('Content-Type','text/html');response.end(await server.transformIndexHtml('/__fields.html','<html><div id="root"></div><script type="module" src="/__fields.jsx"></script></html>'))})}}],
 server:{host:'127.0.0.1',port:53491,strictPort:true},logLevel:'error'})
let browser
try {
 await server.listen()
 const url=`http://127.0.0.1:${server.httpServer.address().port}/__fields.html`
 // WebKit exercises the real React component using Safari's number-input implementation.
 browser=await playwright.webkit.launch({headless:true})
 for(const width of [375,390,430,1280]) {
  const page=await browser.newPage({viewport:{width,height:844},locale:'it-IT'})
  const errors=[];page.on('pageerror',e=>errors.push(e.stack))
  await page.goto(url);const input=name=>page.getByLabel(name,{exact:true})
  const values=()=>page.locator('#values').textContent().then(JSON.parse)
  const saved=()=>page.locator('#saved').textContent().then(JSON.parse)
  await input('zero').focus();await input('zero').pressSequentially('100');await input('text').focus()
  assert.equal((await values()).zero,100,'0 → 100, without a leading zero')
  assert.equal((await saved()).zero,0,'Editing must not persist a form')
  await input('zero').focus();await input('zero').fill('0');await input('text').focus()
  assert.equal((await values()).zero,0,'Intentional zero must be accepted')
  for(const [field,expected] of [['zero',0],['existing',125],['optional','']]) {
   const count=await page.locator('#changes').textContent()
   await input(field).focus();assert.equal(await input(field).inputValue(),'')
   await input(field).fill('');await input('text').focus()
   assert.equal((await values())[field],expected,'Empty edit restores the previous value')
   assert.equal(await page.locator('#changes').textContent(),count,'Focus/empty/blur emits no changes')
  }
  await input('existing').focus();await input('existing').pressSequentially('19.75');await input('text').focus()
  assert.equal((await values()).existing,19.75)
  await input('existing').focus();await input('existing').fill('80');await input('existing').fill('');await input('text').focus()
  assert.equal((await values()).existing,19.75,'An abandoned draft restores the original, not the last keystroke')
  await input('optional').focus();await input('optional').fill('17');await input('optional').fill('');await input('text').focus()
  assert.equal((await values()).optional,'','Optional empty must not become zero')
  await input('decimal').focus();await input('decimal').fill('23.50')
  await page.getByRole('button',{name:'Salva senza blur',exact:true}).click()
  assert.equal((await saved()).decimal,23.5,'Safari buttons without blur still save the latest draft')
  await input('existing').focus();await input('existing').fill('99');await input('existing').press('Escape');await input('text').focus()
  assert.equal((await values()).existing,19.75,'Escape cancels the field draft')
  await input('zero').focus();await input('zero').press('Enter')
  assert.equal(await page.locator('#submits').textContent(),'1','Enter must really submit the form')
  assert.equal((await saved()).zero,0,'Enter restores an untouched required number before submission')
  await input('decimal').focus();await input('decimal').fill('0.001');await input('text').focus()
  assert.equal(await input('decimal').evaluate(el=>el.validity.stepMismatch),true,'Native precision validation retained')
  await input('decimal').focus();await input('decimal').fill('1001');await input('text').focus()
  assert.equal(await input('decimal').evaluate(el=>el.validity.rangeOverflow),true,'Native maximum retained')
  await input('text').focus();assert.equal(await input('text').inputValue(),'Codice 00125')
  await input('date').focus();assert.equal(await input('date').inputValue(),'2026-10-24')
  await input('zero').focus();await input('zero').fill('888');await page.getByRole('button',{name:'Annulla',exact:true}).click()
  await page.getByRole('button',{name:'Riapri',exact:true}).click()
  assert.equal((await values()).zero,(await saved()).zero,'Cancel restores saved form data')
  assert.deepEqual(errors,[])
  await page.close()
  console.log('Campi numerici e testi, WebKit '+width+'px: OK')
 }
} finally {await browser?.close();await server.close();await rm(cacheDir,{recursive:true,force:true})}
