import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const source=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8')
const url=s=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64')
const surfaceUrl=url(source('src/lib/quoteSurface.ts'))
const {surfaceQuantity,quoteItemAmount,surfaceCaption}=await import(surfaceUrl)
const {calculateQuoteTotals}=await import(url(source('src/lib/phase2.ts').replace("'./quoteSurface'",JSON.stringify(surfaceUrl))))
const row={calculation_mode:'surface',item_kind:'service',width_cm:80,height_cm:210,element_count:3,faces:2,quantity:10.08,unit_price:20,labor_included:true}
assert.equal(surfaceQuantity(row),10.08)
assert.equal(quoteItemAmount(row),201.6)
assert.equal(surfaceQuantity({...row,faces:1}),5.04)
assert.equal(surfaceQuantity({...row,width_cm:1.01,height_cm:2.02,element_count:1,faces:1}),0.00020402)
assert.equal(quoteItemAmount({...row,width_cm:100,height_cm:100,element_count:1,faces:1,unit_price:1.005}),1.01)
assert.ok(surfaceCaption(row).includes('manodopera compresa'))
for(const patch of [{width_cm:0},{height_cm:NaN},{faces:3},{element_count:1.5},{width_cm:1.001},{element_count:10001}]) assert.throws(()=>surfaceQuantity({...row,...patch}))
assert.equal(quoteItemAmount({...row,width_cm:0}),0) // Incomplete draft never crashes totals.
const legacy=[{quantity:1.125,unit_price:2.25}]
const old=calculateQuoteTotals(legacy,2,35,8,3,12)
const subtotal=1.125*2.25+70+8+3
assert.equal(old.total,subtotal+subtotal*.12)
const totals=calculateQuoteTotals([...legacy,row],1,35,10,0,10)
assert.equal(totals.materials,2.53125)
assert.equal(totals.services,201.6)
assert.equal(totals.labor,35) // Surface never generates extra labor hours.
assert.equal(totals.total,274.04)
assert.equal(calculateQuoteTotals([row],0,35,0,0,0).total,201.6)
console.log('Superfici: misure, facce, precisione, arrotondamenti, separazione prestazioni, ore e compatibilità legacy: OK')

// Exercise the PDF writer, capturing its text without a browser/download.
const texts=[]
class Pdf {
  internal={pageSize:{getWidth:()=>210,getHeight:()=>297}}
  addImage(){} setTextColor(){} setFont(){} setFontSize(){} setDrawColor(){} line(){}
  setFillColor(){} roundedRect(){} rect(){} addPage(){} setPage(){} save(){}
  getNumberOfPages(){return 1}
  splitTextToSize(text){return text.split('\n')}
  text(text){texts.push(...(Array.isArray(text)?text:[text]))}
}
globalThis.surfacePdf={jsPDF:Pdf}
globalThis.fetch=async()=>({ok:true,blob:async()=>({})})
globalThis.FileReader=class {readAsDataURL(){this.result='data:image/png;base64,stub';this.onload()}}
const phaseUrl=url(source('src/lib/phase2.ts').replace("'./quoteSurface'",JSON.stringify(surfaceUrl)))
let pdf=source('src/lib/quotePdf.ts').replace("'./phase2'",JSON.stringify(phaseUrl)).replace("'./quoteSurface'",JSON.stringify(surfaceUrl))
pdf=pdf.replace("import { BRAND } from './brand'","const BRAND = {name:'LuLab',email:'lulabworks@gmail.com',logo:'/logo.png'}").replace("import('jspdf')","Promise.resolve(globalThis.surfacePdf)")
const {generateQuotePdf}=await import(url(pdf))
await generateQuotePdf({quote:{code:'P-TEST',title:'Prova',quote_date:'2026-10-24',labor_hours:0,hourly_rate:35,transport_cost:0,other_costs:0,margin_percent:0},items:[{...row,description:'Restauro porta',unit:'m²'}],job:{code:'J-TEST',title:'Porta'},customer:null})
assert.ok(texts.includes('10.08 m²'))
assert.ok(texts.some(t=>t.includes('/m²')))
assert.ok(texts.some(t=>t.includes('80 × 210 cm')))
assert.ok(texts.includes('Prestazioni'))
assert.ok(texts.some(t=>t.includes('201,60')))
console.log('PDF: quantità/unità, misure, prezzi, importi e prestazioni: OK (documento simulato)')
