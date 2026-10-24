import { useMemo, useState } from 'react'
import { Clipboard, ExternalLink, Sparkles } from 'lucide-react'
import { Button, Field, Input, Modal, ModalPresence, Notice, Panel, Textarea } from './ui'
import { buildEditorialPrompt, chatGptPromptUrl, editorialQuestions, parseEditorialResponse, type EditorialDraft, type EditorialKind } from '../lib/editorialAssistant'

export function EditorialAssistant({ kind, data, onApply }: { kind: EditorialKind; data: Record<string, unknown>; onApply: (draft: EditorialDraft, keys: string[]) => void }) {
  const questions = useMemo(() => editorialQuestions(kind,data),[kind,data])
  const [answers,setAnswers] = useState<Record<string,string>>({})
  const [prompt,setPrompt] = useState('')
  const [paste,setPaste] = useState('')
  const [importOpen,setImportOpen] = useState(false)
  const [draft,setDraft] = useState<EditorialDraft|null>(null)
  const [selected,setSelected] = useState<string[]>([])
  const [error,setError] = useState('')
  const labels: Record<string,string> = {title:'Titolo pubblico',summary:'Sommario',description:kind==='collection'?'Descrizione dell’oggetto':'Descrizione completa',seo_title:'Titolo SEO',seo_description:'Meta description SEO'}
  const promptText = () => buildEditorialPrompt(kind,data,answers)
  function openChat() { const text=promptText();setPrompt(text);window.open(chatGptPromptUrl(text),'_blank','noopener,noreferrer') }
  async function copyPrompt() { const text=promptText();setPrompt(text);try{await navigator.clipboard.writeText(text);setError('Prompt copiato negli appunti.')}catch{setError('Copia automatica non disponibile: seleziona il prompt qui sotto e copialo.')} }
  function parse() { try {const result=parseEditorialResponse(paste,kind);setDraft(result);setSelected(Object.keys(result).filter(key=>!String(data[key]??'').trim()));setError('')}catch(e){setDraft(null);setError(e instanceof Error?e.message:'Risposta non valida.')} }
  return <Panel><div className="flex items-center gap-2"><Sparkles size={18} className="text-brand"/><h2 className="type-panel-title">Assistente editoriale</h2></div>
    <p className="mt-2 text-sm leading-6 text-muted">Prepara una bozza con ChatGPT. Rivedi e salva i testi nell’editor: la pubblicazione resta sempre manuale.</p>
    <div className="mt-4 grid gap-3">{questions.map(({label,question})=><Field key={label} label={question}><Textarea className="min-h-20" value={answers[label]??''} onChange={e=>setAnswers(old=>({...old,[label]:e.target.value}))} placeholder="Facoltativo: puoi lasciare vuoto" /></Field>)}</div>
    <p className="mt-3 text-xs leading-5 text-muted">Le domande con informazioni già presenti sono omesse; puoi saltare quelle facoltative. Non inseriamo nomi o recapiti dei clienti, costi o prezzi. Controlla i dati selezionati e le risposte prima di inviarli.</p>
    <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Mostra il prompt completo e i dati che saranno inviati</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-stone-50 p-3 text-xs">{prompt||promptText()}</pre></details>
    <div className="mt-4 flex flex-wrap gap-2"><Button onClick={openChat}><ExternalLink size={16}/> Scrivi con ChatGPT</Button><Button variant="secondary" onClick={()=>void copyPrompt()}><Clipboard size={16}/> Copia prompt</Button><Button variant="secondary" onClick={()=>{setPaste('');setDraft(null);setError('');setImportOpen(true)}}>Importa risposta da ChatGPT</Button></div>
    {error && <p role="status" className="mt-3 text-sm text-muted">{error}</p>}
    <ModalPresence>{importOpen ? <Modal title="Importa risposta da ChatGPT" onClose={()=>{setImportOpen(false);setPaste('');setDraft(null)}}><div className="grid gap-4"><p className="text-sm text-muted">Incolla l’intera risposta JSON. Puoi correggere il testo e riprovare.</p><Field label="Risposta"><Textarea className="min-h-40" value={paste} onChange={e=>{setPaste(e.target.value);setDraft(null);setError('')}} placeholder={'```json\n{"title":"..."}\n```'} /></Field><Button variant="secondary" onClick={parse}>Verifica risposta</Button>{error && <Notice tone="error">{error}</Notice>}{draft && <><p className="text-sm font-semibold">Anteprima. Seleziona i campi da applicare.</p>{Object.entries(draft).map(([key,value])=><label key={key} className="grid gap-1 rounded-xl border border-line p-3"><span className="flex items-center gap-2 text-sm font-medium"><Input type="checkbox" className="size-4 min-h-0 w-4 p-0" checked={selected.includes(key)} onChange={e=>setSelected(old=>e.target.checked?[...old,key]:old.filter(x=>x!==key))}/>{labels[key]??key}{String(data[key]??'').trim()?' · sostituisce il contenuto esistente':''}</span><span className="whitespace-pre-wrap break-words text-sm text-muted">{value||'—'}</span></label>)}<Button disabled={!selected.length} onClick={()=>{onApply(draft,selected);setImportOpen(false);setPaste('');setDraft(null)}}>Applica campi selezionati</Button></>}</div></Modal>:null}</ModalPresence>
  </Panel>
}
