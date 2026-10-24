export type EditorialKind = 'collection' | 'portfolio'
export type EditorialDraft = { title: string; description: string; summary?: string; seo_title: string; seo_description: string }

export function editorialQuestions(kind: EditorialKind, data: Record<string, unknown>) {
  const questions = kind === 'portfolio'
    ? [
        ['Condizioni iniziali', data.initial_condition, 'Quali erano le condizioni iniziali del manufatto?', 'Es. La vernice era rovinata e il legno presentava alcune parti deteriorate.'],
        ['Interventi eseguiti', data.work_done ?? data.required_work, 'Quali interventi sono stati realmente eseguiti?', 'Es. Ho carteggiato la superficie, riparato le parti danneggiate e applicato una nuova finitura.'],
        ['Materiali e tecniche', data.materials ?? data.technical_details, 'Quali materiali e tecniche sono stati effettivamente utilizzati?', 'Es. Ho utilizzato carta abrasiva e una vernice trasparente opaca.'],
        ['Obiettivo del lavoro', data.goal, 'Qual era l’obiettivo del lavoro?', 'Es. Recuperare l’aspetto originale del portone senza modificarne le caratteristiche.'],
        ['Particolarità o difficoltà', data.particularity, 'C’è un dettaglio o una difficoltà particolare da raccontare?', 'Es. La vecchia vernice era molto indurita e difficile da rimuovere.']
      ]
    : [
        ['Tipologia', data.category, 'Che tipo di oggetto è?', 'Es. Una credenza in legno con due ante e tre cassetti.'],
        ['Materiali e costruzione', data.materials, 'Quali materiali, finiture o caratteristiche costruttive sono verificati?', 'Es. Struttura in legno massello, maniglie in metallo e finitura scura.'],
        ['Aspetto estetico', data.appearance, 'Quali caratteristiche estetiche vuoi mettere in evidenza?', 'Es. Ha linee semplici, forme squadrate e una superficie segnata dal tempo.'],
        ['Condizioni e interventi', data.condition_description ?? data.initial_condition, 'Quali sono le condizioni attuali? Sono stati eseguiti interventi?', "Es. Presenta alcuni graffi superficiali e un'anta è stata riparata."],
        ['Particolarità', data.particularity, 'C’è una particolarità documentata da raccontare?', 'Es. Conserva ancora le maniglie originali.']
      ]
  return questions.filter(([,known]) => !String(known ?? '').trim()).map(([label, , question, placeholder]) => ({ label: String(label), question: String(question), placeholder: String(placeholder) }))
}

export function buildEditorialPrompt(kind: EditorialKind, data: Record<string, unknown>, answers: Record<string, string>) {
  const keys = kind === 'portfolio' ? ['title','category','summary','description','seo_title','seo_description'] : ['title','materials','dimensions','condition_description','availability','description','seo_title','seo_description']
  const known = Object.fromEntries(keys.filter(key => String(data[key] ?? '').trim()).map(key => [key, String(data[key]).trim()]))
  const safeSource = kind === 'portfolio' ? ['job_title','job_type','job_description','technical_details','initial_condition','required_work','work_done','materials','techniques'] : ['item_name','item_description','materials','dimensions','condition_description','required_work']
  const source = Object.fromEntries(safeSource.filter(key => String(data[key] ?? '').trim()).map(key => [key, String(data[key]).trim()]))
  return `Agisci come assistente editoriale per LuLab, laboratorio artigianale di restauro nel Salento. Scrivi in italiano, con tono concreto, curato e sobrio. Usa solo fatti presenti nei dati e nelle risposte. Non inventare epoche, provenienze, materiali, tecniche o interventi. Se un fatto manca, omettilo. Non aggiungere prezzi, dimensioni o disponibilità non fornite. Restituisci esclusivamente un oggetto JSON valido, senza Markdown, con stringhe per tutte le chiavi richieste.\n\nTipo contenuto: ${kind === 'portfolio' ? 'progetto di portfolio' : 'oggetto della collezione'}\nCampi già presenti (da mantenere come riferimento):\n${JSON.stringify(known,null,2)}\nDati editoriali selezionati dalla scheda collegata (senza nomi/recapiti cliente, prezzi o costi):\n${JSON.stringify(source,null,2)}\nRisposte dell’utente:\n${JSON.stringify(answers,null,2)}\n\nJSON richiesto:\n${JSON.stringify(kind === 'portfolio' ? {title:'',summary:'',description:'',seo_title:'',seo_description:''} : {title:'',description:'',seo_title:'',seo_description:''},null,2)}`
}

export function chatGptPromptUrl(prompt: string) { return `https://chatgpt.com/?prompt=${encodeURIComponent(prompt)}` }

export function editorialCorrectionPrompt(kind: EditorialKind, reason: string) {
  const schema = kind === 'portfolio'
    ? '{"title":"","summary":"","description":"","seo_title":"","seo_description":""}'
    : '{"title":"","description":"","seo_title":"","seo_description":""}'
  return `La risposta precedente non è stato possibile importarla: ${reason}\nRestituisci di nuovo SOLO un oggetto JSON valido, senza Markdown o testo prima/dopo. Tutti i valori devono essere stringhe. Mantieni i fatti e il significato dei testi, non inventare informazioni. Schema richiesto:\n${schema}`
}

function extractObject(text: string) {
  let start = -1, depth = 0, quoted = false, curlyQuoted = false, escaped = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (start < 0) { if (c === '{') { start = i; depth = 1 }; continue }
    if (quoted) {
      if (escaped) escaped = false
      else if (c === '\\' && !curlyQuoted) escaped = true
      else if ((curlyQuoted && c === '”') || (!curlyQuoted && c === '"')) quoted = false
      continue
    }
    if (c === '"' || c === '“') { quoted = true; curlyQuoted = c === '“'; continue }
    if (c === '{') depth++
    if (c === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  return ''
}

/** Repairs only JSON delimiters and raw line breaks; quoted prose is preserved verbatim. */
function repairJson(source: string) {
  let output = '', inString = false, curlyString = false, escaped = false
  for (let index = 0; index < source.length; index++) {
    const c = source[index]
    if (inString) {
      if (escaped) { output += c; escaped = false; continue }
      if (c === '\\' && !curlyString) { output += c; escaped = true; continue }
      if ((curlyString && c === '”') || (!curlyString && c === '"')) { output += '"'; inString = false; curlyString = false; continue }
      if (c === '\r' || c === '\n') { if (c === '\r' && source[index + 1] === '\n') index++; output += '\\n'; continue }
      output += c; continue
    }
    if (c === '“') { output += '"'; inString = true; curlyString = true; continue }
    if (c === '”' || c === '„') { output += '"'; inString = true; curlyString = c === '„'; continue }
    if (c === '"') { output += c; inString = true; continue }
    output += c
  }
  return output
}

export function parseEditorialResponse(text: string, kind: EditorialKind): EditorialDraft {
  const unwrapped = text.replace(/^\uFEFF/, '').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim()
  const object = extractObject(unwrapped)
  if (!object) throw new Error('Non trovo un oggetto JSON completo. Chiedi a ChatGPT di restituire solo il JSON indicato.')
  let value: unknown
  try { value = JSON.parse(object) } catch {
    try { value = JSON.parse(repairJson(object)) }
    catch { throw new Error('La struttura JSON non è recuperabile in modo sicuro. Chiedi a ChatGPT di restituire solo il JSON indicato, con virgolette doppie e una chiave per riga.') }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La risposta deve essere un oggetto JSON con campi testuali.')
  const record = value as Record<string,unknown>
  const required = kind === 'portfolio' ? ['title','summary','description','seo_title','seo_description'] : ['title','description','seo_title','seo_description']
  const invalid = required.filter(key => typeof record[key] !== 'string')
  if (invalid.length) throw new Error(`Mancano campi testuali richiesti: ${invalid.join(', ')}.`)
  return Object.fromEntries(required.map(key => [key,(record[key] as string).trim()])) as EditorialDraft
}
