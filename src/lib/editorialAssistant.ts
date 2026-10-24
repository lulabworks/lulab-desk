export type EditorialKind = 'collection' | 'portfolio'
export type EditorialDraft = { title: string; description: string; summary?: string; seo_title: string; seo_description: string }

export function editorialQuestions(kind: EditorialKind, data: Record<string, unknown>) {
  const questions = kind === 'portfolio'
    ? [
        ['Condizioni iniziali', data.initial_condition, 'Quali erano le condizioni iniziali del manufatto?'],
        ['Interventi', data.work_done ?? data.required_work, 'Quali interventi sono stati realmente eseguiti?'],
        ['Materiali e tecniche', data.materials ?? data.technical_details, 'Quali materiali e tecniche sono stati effettivamente utilizzati?'],
        ['Obiettivo', data.goal, 'Qual era l’obiettivo del lavoro?'],
        ['Particolarità', data.particularity, 'C’è un dettaglio o una difficoltà particolare da raccontare?']
      ]
    : [
        ['Tipologia', data.category, 'Che tipo di oggetto è?'],
        ['Materiali e costruzione', data.materials, 'Quali materiali, finiture o caratteristiche costruttive sono verificati?'],
        ['Aspetto', data.appearance, 'Quali caratteristiche estetiche vuoi mettere in evidenza?'],
        ['Condizioni e interventi', data.condition_description ?? data.initial_condition, 'Quali sono le condizioni attuali? Sono stati eseguiti interventi?'],
        ['Particolarità', data.particularity, 'C’è una particolarità documentata da raccontare?']
      ]
  return questions.filter(([,known]) => !String(known ?? '').trim()).map(([label, , question]) => ({ label: String(label), question: String(question) }))
}

export function buildEditorialPrompt(kind: EditorialKind, data: Record<string, unknown>, answers: Record<string, string>) {
  const keys = kind === 'portfolio' ? ['title','category','summary','description','seo_title','seo_description'] : ['title','materials','dimensions','condition_description','availability','description','seo_title','seo_description']
  const known = Object.fromEntries(keys.filter(key => String(data[key] ?? '').trim()).map(key => [key, String(data[key]).trim()]))
  const safeSource = kind === 'portfolio' ? ['job_title','job_type','job_description','technical_details','initial_condition','required_work','work_done','materials','techniques'] : ['item_name','item_description','materials','dimensions','condition_description','required_work']
  const source = Object.fromEntries(safeSource.filter(key => String(data[key] ?? '').trim()).map(key => [key, String(data[key]).trim()]))
  return `Agisci come assistente editoriale per LuLab, laboratorio artigianale di restauro nel Salento. Scrivi in italiano, con tono concreto, curato e sobrio. Usa solo fatti presenti nei dati e nelle risposte. Non inventare epoche, provenienze, materiali, tecniche o interventi. Se un fatto manca, omettilo. Non aggiungere prezzi, dimensioni o disponibilità non fornite. Restituisci esclusivamente un oggetto JSON valido, senza Markdown, con stringhe per tutte le chiavi richieste.\n\nTipo contenuto: ${kind === 'portfolio' ? 'progetto di portfolio' : 'oggetto della collezione'}\nCampi già presenti (da mantenere come riferimento):\n${JSON.stringify(known,null,2)}\nDati editoriali selezionati dalla scheda collegata (senza nomi/recapiti cliente, prezzi o costi):\n${JSON.stringify(source,null,2)}\nRisposte dell’utente:\n${JSON.stringify(answers,null,2)}\n\nJSON richiesto:\n${JSON.stringify(kind === 'portfolio' ? {title:'',summary:'',description:'',seo_title:'',seo_description:''} : {title:'',description:'',seo_title:'',seo_description:''},null,2)}`
}

export function chatGptPromptUrl(prompt: string) { return `https://chatgpt.com/?prompt=${encodeURIComponent(prompt)}` }

export function parseEditorialResponse(text: string, kind: EditorialKind): EditorialDraft {
  const unwrapped = text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim()
  const start = unwrapped.indexOf('{'), end = unwrapped.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Non trovo un oggetto JSON nella risposta. Incolla il JSON completo ricevuto da ChatGPT.')
  let value: unknown
  try { value = JSON.parse(unwrapped.slice(start,end+1)) } catch { throw new Error('Il JSON non è valido. Correggilo oppure chiedi a ChatGPT di restituire solo il formato JSON indicato.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La risposta deve essere un oggetto JSON con campi testuali.')
  const record = value as Record<string,unknown>
  const required = kind === 'portfolio' ? ['title','summary','description','seo_title','seo_description'] : ['title','description','seo_title','seo_description']
  const invalid = required.filter(key => typeof record[key] !== 'string')
  if (invalid.length) throw new Error(`Mancano campi testuali richiesti: ${invalid.join(', ')}.`)
  return Object.fromEntries(required.map(key => [key,(record[key] as string).trim()])) as EditorialDraft
}
