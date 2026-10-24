import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source=await readFile(new URL('../src/lib/editorialAssistant.ts',import.meta.url),'utf8')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const {editorialQuestions,buildEditorialPrompt,chatGptPromptUrl,parseEditorialResponse,editorialCorrectionPrompt}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const known={title:'Restauro credenza',description:'Testo esistente',category:'Restauro mobili',summary:'Riepilogo esistente',materials:'Noce massello',seo_title:'SEO presente',seo_description:'Meta presente',public_price:900,acquisition_cost:120,customer_name:'Privato',email:'segreto@example.test'}
assert(!editorialQuestions('portfolio',{initial_condition:'Descritta',materials:'Noce'}).some(q=>q.label==='Condizioni iniziali'||q.label==='Materiali e tecniche'))
assert(editorialQuestions('collection',known).length>=3&&editorialQuestions('collection',known).length<=5)
const prompt=buildEditorialPrompt('portfolio',{...known,job_title:'Restauro credenza',job_description:'Rimozione vernice e finitura a gommalacca',technical_details:'Lucidatura manuale'}, {'Interventi':'Pulitura e lucidatura manuale'})
assert.match(prompt,/"Restauro credenza"/);assert.match(prompt,/non inventare/i);assert.match(prompt,/"title": ""/)
for(const privateValue of ['Privato','segreto@example.test','900','120'])assert(!prompt.includes(privateValue),`private value excluded: ${privateValue}`)
const url=chatGptPromptUrl(prompt);assert.equal(new URL(url).searchParams.get('prompt'),prompt)
const project=parseEditorialResponse('Risposta:\n```json\n{"title":"Progetto","summary":"Sintesi","description":"Testo","seo_title":"Titolo SEO","seo_description":"Meta SEO"}\n```','portfolio')
assert.equal(project.summary,'Sintesi')
const imperfect='Ecco la bozza:\r\n```JSON\r\n“{\r\n  “title”: “Restauro della credenza”,\r\n  “summary”: “Mobile in noce, con finitura rinnovata”,\r\n  “description”: “La credenza d’epoca è stata pulita.\r\nLa finitura originale, «calda», è stata conservata.”,\r\n  “seo_title”: “Restauro credenza in noce”,\r\n  “seo_description”: “Restauro artigianale della credenza.”\r\n}”\r\n```\r\nTesto conclusivo.'
const recovered=parseEditorialResponse(imperfect,'portfolio')
assert.equal(recovered.title,'Restauro della credenza')
assert.equal(recovered.description,'La credenza d’epoca è stata pulita.\nLa finitura originale, «calda», è stata conservata.')
const escaped='```json\n{"title":"Cassettiera","summary":"Sintesi","description":"Prima riga\\nSeconda riga, con l’apostrofo dell’artigiano e le virgolette \\"conservate\\".","seo_title":"Cassettiera restaurata","seo_description":"Descrizione breve."}\n```'
assert.match(parseEditorialResponse(escaped,'portfolio').description,/l’apostrofo dell’artigiano e le virgolette "conservate"/)
const collection=parseEditorialResponse('{"title":"Credenza","description":"Descrizione","seo_title":"SEO","seo_description":"Meta"}','collection')
assert.equal(collection.summary,undefined)
assert.throws(()=>parseEditorialResponse('testo senza JSON','collection'),/oggetto JSON/i)
assert.throws(()=>parseEditorialResponse('{"title":1}','portfolio'),/campi testuali/i)
assert.match(editorialCorrectionPrompt('collection','formato irrecuperabile'),/Restituisci di nuovo SOLO un oggetto JSON valido/)
console.log('Assistente editoriale: domande adattive, privacy prompt, URL ChatGPT e importazione/validazione JSON: OK')
