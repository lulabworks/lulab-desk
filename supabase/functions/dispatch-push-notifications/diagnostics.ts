export type Context = { dispatch_id: string; job_id?: string; category?: string; attempts?: number; subscription_id?: string }

export class DispatchFailure extends Error {
  constructor(readonly operation: string, readonly original: unknown, readonly context: Context) {
    super('Push dispatch operation failed')
  }
}

// Supabase often returns plain PostgREST objects, not Error instances.
export async function checked<T>(operation: string, context: Context, action: () => PromiseLike<T>): Promise<T> {
  try {
    const result = await action()
    if (result && typeof result === 'object' && 'error' in result && result.error) throw result.error
    return result
  } catch (error) {
    throw new DispatchFailure(operation, error, context)
  }
}

export function diagnosticRecord(error: unknown, fallback: Context, operation = 'dispatch.unhandled') {
  const failure = error instanceof DispatchFailure ? error : new DispatchFailure(operation, error, fallback)
  const raw = failure.original
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const code = typeof obj.code === 'string' && /^(?:[A-Z0-9]{5}|PGRST[0-9]{3})$/.test(obj.code) ? obj.code : null
  const status = Number(obj.statusCode ?? obj.status)
  // Never log raw message/details/hint/body/stack: SQL errors and Web Push
  // responses can contain row values, endpoints, tokens or customer data.
  const messages: Record<string, string> = {
    '42501': 'Permesso database negato o policy RLS non soddisfatta.',
    '42P01': 'Tabella o relazione non presente.', '42703': 'Colonna non presente.',
    '42883': 'Funzione o firma SQL non presente.', '23505': 'Vincolo univoco violato.',
    '23503': 'Vincolo di chiave esterna violato.', '23514': 'Vincolo CHECK violato.',
    '23502': 'Campo obbligatorio mancante.', '22P02': 'Valore non valido per il tipo SQL.',
    'PGRST116': 'Numero di righe incompatibile con la lettura singola.',
    'PGRST202': 'RPC non trovata nella cache dello schema.',
    'PGRST204': 'Colonna non trovata nella cache dello schema.',
    'PGRST205': 'Tabella non trovata nella cache dello schema.',
    '57014': 'Operazione database annullata o scaduta.', '40P01': 'Deadlock database.',
    '55000': 'Lease push scaduta o acquisita da un altro worker.',
    '42702': 'Riferimento SQL ambiguo.', 'P0001': 'Eccezione esplicita sollevata da una funzione o trigger SQL.'
  }
  const message = code && messages[code] ? messages[code]
    : Number.isInteger(status) && status >= 100 && status <= 599 ? 'Risposta HTTP di errore; consultare il codice di stato.'
    : raw instanceof TypeError ? 'Errore di tipo o trasporto durante l’operazione.'
    : 'Errore non classificato; messaggio originale omesso per proteggere i dati.'
  return {
    event: 'push_dispatch_error', ...failure.context, operation: failure.operation,
    error_code: code, http_status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    message, message_present: typeof obj.message === 'string',
    details_present: Boolean(obj.details), hint_present: Boolean(obj.hint),
    error_kind: raw instanceof Error ? 'javascript_error' : raw && typeof raw === 'object' ? 'error_object' : 'other'
  }
}
