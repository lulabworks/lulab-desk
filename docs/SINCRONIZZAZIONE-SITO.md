# Richiesta di aggiornamento del sito

L’editor richiama `request-site-rebuild` dopo salvataggi pubblici, pubblicazione/ritiro e cambi a immagini pubbliche (testi, copertina, ordine, eliminazione). Upload privati e salvataggi di bozze non richiedono build. La pubblicazione delle foto richiede un solo invio al termine dell’operazione. La funzione verifica JWT tramite Auth e legge la riga `site_editors` dell’utente, attiva, prima di accedere a GitHub. La destinazione è fissa: `lulabworks/lulabworks`, workflow `deploy-pages.yml`, branch `main`.

Le modifiche nella stessa sessione sono accorpate dopo due secondi di inattività. Una modifica durante l’invio conserva una nuova richiesta finale. Il flag pendente, separato per account, sopravvive alla chiusura della pagina in localStorage; viene ripreso all’apertura dell’editor. Errori non annullano i dati Supabase: «Riprova aggiornamento sito» invia solo la richiesta, senza ricaricare foto. La funzione impone dieci secondi tra invii nella stessa istanza e gestisce rifiuti/rate limit e timeout senza mostrare token o risposte private GitHub.

Il risultato conferma soltanto l’accettazione GitHub, non il completamento del deploy. In caso di errore persistente si conserva la richiesta e si può riprovare; il workflow programmato resta il recupero indipendente dal browser. La disponibilità del sito si verifica da GitHub Actions/Pages.

## Configurazione separata necessaria

1. Da GitHub `lulabworks`, creare un fine-grained token limitato esclusivamente a `lulabworks/lulabworks`, con permesso repository **Actions: Read and write** (Metadata read implicito). Autorizzarlo nell’organizzazione se richiesto. Non usare token in Vite, nel browser o nei file del progetto.
2. Nel progetto Supabase corretto `klkqwisnnhbazcqmwjmv`, configurare **solo nei secrets Edge Functions** `GITHUB_SITE_DISPATCH_TOKEN`. Non inserirlo nei comandi salvati o nei log.
3. Distribuire `request-site-rebuild` mantenendo `verify_jwt = true`, dopo verifica sessione e allowlist editor. La funzione usa le variabili Supabase server già disponibili. Non richiede service-role o migrazioni.
4. Il checkout locale Astro `outputs/lulabworks-site/.github/workflows/deploy-pages.yml` contiene già `workflow_dispatch`, schedule ogni cinque minuti e concurrency `pages`. Conservare questi trigger. Verificare la stessa configurazione sul branch remoto `main` nella fase di attivazione.
5. Pubblicare il frontend solo dopo la configurazione. Verificare separatamente un editor attivo, utente non editor/anonimo e l’esito Actions con un contenuto autorizzato.

Nessuna Edge Function, secret o configurazione remota viene distribuita dalla preparazione locale. Non è stato modificato il repository Astro.

## Limiti e verifiche

Test: `pnpm test:site-sync`, typecheck, suite e build. I test locali simulano GitHub; la verifica effettiva JWT/Supabase/GitHub richiede la successiva fase autorizzata. Non sono state inviate richieste di deploy reali.

Debounce e backpressure non sono un lock distribuito. Schede/dispositivi o istanze Edge diverse possono richiedere più run; la concurrency del workflow limita quelle attive e l’ultima compilazione legge tutti i contenuti salvati. Un timeout dopo l’accettazione GitHub può causare un secondo run al retry. Senza un registro server persistente non si promette idempotenza globale. La schedule evita di perdere modifiche anche se il browser chiude prima dell’invio o rimuove localStorage. GitHub può ritardare le esecuzioni pianificate; cinque minuti non è un tempo massimo garantito.
