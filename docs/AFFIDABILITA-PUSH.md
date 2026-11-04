# Dispatcher push: budget, lease e rilascio controllato (010)

La causa dell'incidente è stata accertata in produzione dall'amministratore: `preferences.read`, SQLSTATE 42501, mancava SELECT per service_role. Dopo il GRANT manuale sono state osservate cinque consegne riuscite e ricezione su iPhone. La 010 rende quel GRANT parte delle migrazioni; non modifica la 006 né le policy RLS. Nessun controllo remoto è stato eseguito durante questo sviluppo.

## Nuovo comportamento

- `dispatch_attempts`: budget da 0 a 8 per i nuovi job, distinto dal contatore storico `attempts`. Il prelievo incrementa entrambi; gli errori SQL consumano il budget come gli errori Web Push.
- Prelievo di un solo job alla volta, fino a dieci per esecuzione, con controllo del tempo prima del prelievo. Un errore di un job viene diagnosticato e recuperato senza interrompere quelli successivi. Errori globali (configurazione, generazione promemoria o claim) restano HTTP 500; una risposta 200 contiene `processed` e `failed` per gli errori per-job. I fallimenti Web Push gestiti rimangono visibili nei warning e negli esiti DB.
- Un retry torna pending dopo cinque minuti; all'ottavo tentativo diventa failed. Un worker interrotto lascia la lease in processing; il claim la recupera dopo cinque minuti, o marca failed se il budget è già esaurito. I processing con locked_at NULL sono recuperabili con la stessa regola di budget.
- `lease_token` cambia a ogni acquisizione. Heartbeat, consegne e finalizzazione passano da una RPC che blocca la riga e controlla stato, token e scadenza. Il worker precedente non può sovrascrivere il lavoro del nuovo. Timeout dell'invio: 20 secondi, inferiore alla lease. Nessun batch di 40 job resta pre-acquisito e non visitato.
- Le consegne riuscite vengono saltate nei retry e non possono essere sovrascritte con retry dalla RPC. Il successo Web Push e il suo salvataggio restano operazioni distinte nei log. Il comportamento 404/410 conserva la rimozione delle sottoscrizioni scadute già prevista; nessuna sottoscrizione valida viene migrata o reinizializzata.
- `sent`: almeno una consegna accettata dal provider, nessun destinatario rimasto da ritentare. Non certifica la visualizzazione sull'iPhone. La RPC rifiuta sent senza una consegna sent. `skipped`: sorgente non più valida oppure elaborazione senza invii (preferenze disabilitate, assenza di destinatari/sottoscrizioni o soli endpoint scaduti). `failed`: budget esaurito, anche con eventuali consegne parziali già riuscite. Solo sent valorizza sent_at.
- Il segreto cron resta obbligatorio. Le nuove RPC sono eseguibili soltanto da service_role; non cambiano i permessi degli utenti. Log con fase, ID tecnici, codice SQL/HTTP e messaggi fissi, senza payload, endpoint o errori grezzi.

## Job già presenti: revisione obbligatoria

La migrazione **non cambia stato, contatori, date o consegne dei job esistenti**, inclusi quelli con oltre 3500 tentativi. `dispatch_attempts` resta NULL su tutte le righe preesistenti, che vengono escluse dal nuovo claim. Il DEFAULT 0 è impostato separatamente e riguarda soltanto i nuovi INSERT. Anche i job pending preesistenti richiedono revisione: è una sospensione intenzionale, non una cancellazione.

Prima di una successiva operazione autorizzata, inventariare per ID i pending/processing, validità della sorgente, età, preferenze ed esiti delle singole sottoscrizioni. Confrontare con gli invii già riusciti, inclusi quelli dell'incidente. Non azzerare attempts, non cancellare consegne e non applicare UPDATE generalizzati. Se una consegna non è stata salvata dopo l'invio, il database non consente di provare che il dispositivo non l'abbia ricevuta.

Solo dopo questa revisione si potrà decidere, per ID approvati, se assegnare un nuovo budget impostando dispatch_attempts e riprendere pending, oppure chiudere come skipped/failed. Conservare attempts e le consegne esistenti. Un job sent non va riaperto automaticamente. Nessuna procedura di recupero dello storico è inclusa o eseguita qui.

## Ordine di rilascio, ancora da autorizzare

1. Backup e inventario in sola lettura dei job/consegne e verifica dello schema e del GRANT manuale. Verificare che non ci siano dispatcher vecchi ancora in esecuzione durante il passaggio; un worker vecchio già in volo usa scritture dirette e non conosce i token.
2. Applicare esclusivamente `010_push_dispatch_reliability.sql` tramite il normale storico delle migrazioni. Attendere il commit completo prima di usare le nuove funzioni: i nuovi valori enum non sono utilizzabili prima del commit PostgreSQL. Controllare GRANT, RPC, nuovi campi e stati; nessuna riesecuzione della 006.
3. La vecchia RPC `claim_push_notification_jobs` è sostituita con un no-op compatibile: il vecchio dispatcher non può acquisire nuovi job senza fencing nell'intervallo del deploy. Il cron resta invariato e i nuovi job restano pending. Attendere/confermare la fine delle vecchie invocazioni prima del passo successivo.
4. Distribuire soltanto `dispatch-push-notifications`, inclusa diagnostics.ts, nel progetto corretto; non serve pubblicare il frontend o cambiare secrets/cron. Il nuovo codice richiede la 010 e non deve essere distribuito prima. Controllare i log e gli esiti delle normali notifiche senza creare dati clienti di prova. Un eventuale rollback della funzione alla vecchia versione lascerebbe il claim disattivato: non ripristinare la vecchia RPC senza un piano specifico.
5. Gestire separatamente i job legacy con autorizzazione esplicita e selezione per ID. Non devono essere recuperati automaticamente durante il deploy.

### Ripristino operativo se il deploy fallisce

Il ripristino sicuro prevede una sospensione delle nuove acquisizioni e la conservazione della coda, senza annullare la 010. Non rimuovere colonne o valori enum, non ripristinare il claim originale della 006 e non azzerare stati, tentativi o consegne. Se il nuovo codice non è mai entrato in servizio, il vecchio claim no-op mantiene già questa sospensione; i nuovi job restano pending e quelli legacy restano esclusi.

Se il deploy è parziale, o non si può escludere che il nuovo codice sia già attivo, non presumere che il vecchio claim no-op basti: il nuovo dispatcher usa una RPC diversa. Il piano di contenimento, da autorizzare separatamente, è sostituire temporaneamente anche il corpo di claim_push_notification_job_v2 con un SELECT vuoto della stessa firma, conservando SECURITY DEFINER, search_path e ACL. Nessun job va aggiornato da questa operazione. Le invocazioni già partite devono terminare prima di qualsiasi ripristino del codice; i job interrotti restano recuperabili tramite la lease e il budget. La sostituzione del claim non annulla un invio Web Push già partito.

Confermare la versione realmente servita e la fine delle invocazioni in corso tramite deployment e log della piattaforma: cinque minuti di lease non costituiscono una prova che il vecchio worker sia terminato. Se non è possibile verificarlo, mantenere la sospensione. Correggere o ripetere il deploy della nuova funzione compatibile con la 010, poi ripristinare esclusivamente il corpo v2 approvato, verificarne ACL e riavviare le acquisizioni. La vecchia RPC resta no-op. Questo piano privilegia la conservazione dei job rispetto alla continuità immediata degli invii; non prevede rollback distruttivi dello schema né recuperi automatici dello storico. Nessuna di queste operazioni è stata eseguita.

## Verifiche e limiti

`pnpm test:push-diagnostics`: vero handler TypeScript con dipendenze simulate, errori per fase, separazione SQL/invio, isolamento di errori per job, prosecuzione di un job sano, retry, skip dei sent, autenticazione e assenza dei segreti sintetici nei log. Non invia push reali.

`pnpm test:push-reliability:postgres`: cluster PostgreSQL 17 temporaneo con socket dedicata, senza connessioni TCP/credenziali remote; definizioni reali delle tabelle e claim 006 con sole dipendenze Auth minime e applicazione integrale della 010. Controlla GRANT, permessi RPC, stato legacy immutato, limite di otto, recupero interruzioni, token obsoleti, divieto di falso sent, esiti terminali, conservazione delle consegne sent e due connessioni concorrenti. Arresta e rimuove il cluster anche in caso di errore. Non ricostruisce il cron, PostgREST o le altre migrazioni operative.

Web Push non offre una transazione distribuita con PostgreSQL: un invio accettato seguito da un errore nel salvataggio o da una terminazione del worker può essere ritentato. Il tag stabile job.id e renotify=false del service worker riducono le duplicazioni visibili, ma non garantiscono exactly-once. Anche una sospensione del processo tra il controllo della lease e la chiamata di rete non è eliminabile tramite il solo token DB. I token proteggono le scritture e le acquisizioni concorrenti; timeout e heartbeat limitano la finestra ordinaria. Deno/Supabase Edge e ricezione fisica non sono collaudati da questi test locali.
