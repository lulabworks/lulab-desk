# Diagnostica locale del dispatch push

## Risultati certi dell'ispezione

- Gli errori Supabase/PostgREST vengono spesso restituiti come oggetti con `code`, `message`, `details`, `hint`. Il vecchio catch riconosceva soltanto `instanceof Error`, producendo `unknown error` per questi oggetti. La nuova diagnostica gestisce entrambi i casi e anche errori di trasporto lanciati durante una query.
- L'UPDATE del job non più valido ignorava `.error`, potendo rispondere 200 lasciando il job in processing. Ora viene controllato e identificato come `job.finalize_invalid`.
- Il precedente try/catch dell'invio includeva l'UPDATE della consegna a sent. Una scrittura DB fallita dopo un invio riuscito veniva trattata come errore Web Push e registrata per retry. Ora l'invio e `deliveries.mark_sent` hanno gestione separata. Un invio riuscito seguito da una scrittura fallita rimane comunque una condizione a rischio di duplicazione al successivo retry; questa modifica diagnostica non introduce garanzie exactly-once.

Non sono stati consultati log o dati reali. Il punto concreto che causa i 500 in produzione non è dimostrabile dal solo codice. L'assenza di consegne è compatibile con un errore in validazione, lettura degli editor, preferenze, sottoscrizioni, lettura consegne o inserimento del tentativo; non prova quale di queste operazioni fallisca. Per esempio, un errore 42501 richiederebbe di controllare i GRANT effettivi del ruolo di servizio sulla relazione indicata dall'operazione: non implica automaticamente una policy RLS da cambiare.

## Log prodotti

Ogni errore del dispatch produce un JSON `push_dispatch_error` con:

- `dispatch_id` casuale per correlare l'esecuzione;
- `operation` della fase che fallisce;
- `job_id`, categoria e tentativi, se il job è già stato prelevato;
- `subscription_id`, se il fallimento riguarda una consegna specifica;
- `error_code` SQL/PostgREST validato e `http_status` quando disponibile;
- un messaggio diagnostico fisso corrispondente al codice, tipo dell'errore e indicatori di presenza di message/details/hint.

Le operazioni distinguono `vapid.configure`, `reminders.enqueue`, `queue.claim`, `notification.validate`, `editors.read`, `preferences.read`, `subscriptions.read`, `deliveries.read`, `deliveries.insert_attempt`, `deliveries.update_attempt`, `web_push.send`, `deliveries.mark_sent`, `deliveries.mark_expired`, `subscriptions.delete_expired`, `deliveries.mark_retry`, `job.finalize_invalid`, `job.finalize`.

Gli errori Web Push recuperabili producono un warning; quelli che interrompono il dispatch un error e una risposta HTTP 500 generica. Non si loggano mai gli oggetti errore completi, i messaggi originali, stack, dettagli SQL, hint o body dei provider: possono contenere valori di righe, credenziali o endpoint. Non vengono loggati payload, titoli, descrizioni, path delle richieste, user ID, chiavi o URL push. I codici non catalogati restano visibili, con un messaggio neutro. Gli ID job/sottoscrizione sono identificatori tecnici utili alla correlazione e vanno trattati come log interni.

Esempio indicativo (non ricavato dalla produzione): `operation=editors.read`, `error_code=42501`, `message=Permesso database negato o policy RLS non soddisfatta.`

## Perché processing e migliaia di tentativi

La RPC `claim_push_notification_jobs` della 006 prende fino a 40 job, li marca processing, aggiorna locked_at e incrementa attempts. Dopo 5 minuti i processing con lease scaduta tornano candidati senza un massimo di tentativi. Se un job fallisce, il catch esterno interrompe l'intera esecuzione e non finalizza né il job fallito né quelli già prelevati ma non ancora visitati. Il cron successivo può riprenderli. Il limite `attempts >= 8` viene valutato soltanto in fondo a deliverJob, dopo tutte le query: non limita i fallimenti precedenti. Inoltre esaurire i retry Web Push oggi porta allo stato sent anche senza una consegna riuscita.

Questo meccanismo spiega la possibilità di contatori molto alti, ma non identifica il guasto iniziale. Nessun job è stato rimesso pending, marcato sent, cancellato o azzerato durante questo lavoro.

La correzione successiva più sicura, da approvare separatamente dopo aver identificato l'errore, è una gestione per singolo job con backoff, rilascio della lease e stato terminale esplicito failed, limite anche nel claim e distinzione fra consegna riuscita e tentativi esauriti. Occorre prevedere i job del batch non ancora visitati e un timeout Web Push inferiore alla lease. Non basta aggiungere un limite al claim: i processing oltre soglia resterebbero bloccati e servirebbe una migrazione incrementale per gli stati/transizioni e un recupero controllato. Prima di riprovare i job reali bisogna verificare l'eventuale invio già riuscito con esito non salvato, per contenere notifiche duplicate. Nessuna di queste variazioni alla coda è implementata qui.

## Verifiche locali e distribuzione successiva

`pnpm test:push-diagnostics` esegue il vero handler compilato con TypeScript usando un runtime Deno, Supabase e web-push simulati. Verifica oggetti errore non Error e failure injection di tutte le fasi DB principali, invio Web Push, nessuna confusione fra invio e salvataggio, errori prima ignorati e assenza dei segreti sintetici nei log. `pnpm test:push` resta un controllo statico. Nessun messaggio push reale viene inviato.

Deno non è disponibile in questo ambiente: non sono stati eseguiti `deno check` né il runtime Supabase reale. Il typecheck del frontend non include le Edge Functions; il test diagnostico verifica sintassi e comportamento dell'handler con dipendenze simulate.

Solo dopo approvazione, dalla cartella LuLab Desk, il comando per distribuire esclusivamente questa funzione (incluso il modulo diagnostics.ts importato) è:

```sh
supabase functions deploy dispatch-push-notifications --project-ref klkqwisnnhbazcqmwjmv --no-verify-jwt
```

Richiede autenticazione CLI e accesso al progetto. `--no-verify-jwt` mantiene la configurazione attuale: l'endpoint verifica il segreto cron dedicato. Il comando non applica migrazioni, non modifica cron/secrets e non pubblica il frontend. Il cron esistente userà poi la funzione aggiornata e continuerà la normale elaborazione della coda: la distribuzione va quindi autorizzata consapevolmente. Non è stata eseguita in questa attività.
