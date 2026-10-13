# Piano e architettura — Fase 1

## Confini della fase

La Fase 1 consegna una base operativa: autenticazione privata, navigazione responsive, dashboard da dati reali, clienti, commesse, scheda lavoro, checklist, persistenza Supabase, esportazione JSON e PWA installabile.

Agenda, fotografie, allegati, preventivi PDF, ore, spese e pagamenti analitici appartengono alla Fase 2. Materiali, recuperi, antitarlo avanzato, analisi e statistiche appartengono alla Fase 3. Le relative aree non simulano funzioni non ancora disponibili.

## Architettura

- `src/pages`: schermate organizzate per area funzionale.
- `src/components`: layout e componenti UI riutilizzabili.
- `src/contexts`: sessione di autenticazione.
- `src/lib`: client Supabase, tipi e formattazione.
- `supabase/migrations`: schema, indici, trigger e politiche RLS versionate.
- `public`: icona PWA e risorse statiche.

Il browser usa esclusivamente la publishable key. Le tabelle applicative concedono le operazioni CRUD al solo ruolo `authenticated`; ogni tabella contiene inoltre `user_id` e le policy RLS consentono a un account di leggere o modificare soltanto i propri record. Le operazioni applicative non usano mai privilegi amministrativi.

## Schema iniziale

- `user_settings`: tariffa oraria personale.
- `customers`: anagrafica unica dei clienti.
- `jobs`: commesse, stato, dettagli tecnici, scadenze e riepilogo incassi.
- `job_tasks`: checklist ordinata collegata alla commessa.
- `storage.objects` / bucket `job-files`: area privata già predisposta per la Fase 2.

Relazioni principali: un utente possiede molti clienti e lavori; un cliente ha molti lavori; un lavoro ha molte attività. La cancellazione di un cliente non elimina le commesse. La cancellazione di una commessa elimina la sua checklist.

## Decisioni operative

- Creazione rapida della commessa con soli titolo e tipologia.
- Codice commessa generato dal database.
- Modifiche alla scheda accodate in ordine, salvate automaticamente dopo 700 ms e inviate immediatamente quando si lascia la schermata.
- Dashboard calcolata al caricamento sui dati reali dell’utente.
- Conferma esplicita prima delle eliminazioni.
- Nessun fallback con dati dimostrativi quando Supabase non è configurato.
