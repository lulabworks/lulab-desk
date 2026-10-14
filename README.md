# LuLab Desk

Gestionale privato e responsive per il laboratorio di falegnameria LuLab. Le Fasi 1, 2 e 3 includono commesse, clienti, preventivi, agenda, ore, economia, magazzino, recuperi e rivendita, antitarlo e statistiche.

## Requisiti

- Node.js 20 o successivo
- pnpm 9 o successivo (oppure npm)
- Progetto Supabase con le migrazioni delle Fasi 1, 2 e 3 già applicate
- Provider Email di Supabase Auth configurato; nuove registrazioni disabilitate dopo la creazione dell’account LuLab

## Attivare la Fase 2 su Supabase

Il progetto contiene una migrazione incrementale in `supabase/migrations/002_phase2_operations.sql`. Non modifica retroattivamente `001_initial_schema.sql` e va eseguita una sola volta, dopo la migrazione Fase 1.

1. Apri il progetto LuLab in [Supabase Dashboard](https://supabase.com/dashboard).
2. Vai in **SQL Editor → New query**.
3. Apri localmente `supabase/migrations/002_phase2_operations.sql`, copia l’intero contenuto e incollalo nell’editor.
4. Premi **Run** e verifica che l’esecuzione termini senza errori.
5. Vai in **Table Editor** e verifica la presenza delle tabelle:
   - `job_files`
   - `quotes`
   - `quote_items`
   - `agenda_events`
   - `time_entries`
   - `job_expenses`
   - `job_payments`
6. Vai in **Storage** e verifica che il bucket `job-files`, creato dalla Fase 1, sia ancora **Private**. Non renderlo pubblico.
7. In **Authentication → URL Configuration** conserva:
   - **Site URL locale:** `http://localhost:5173/lulab-desk/`
   - **Redirect URL locale:** `http://localhost:5173/lulab-desk/recupera-password`

La migrazione abilita RLS su tutte le nuove tabelle, concede `SELECT`, `INSERT`, `UPDATE` e `DELETE` soltanto al ruolo `authenticated` e revoca i privilegi al ruolo `anon`. Le policy verificano sia l’utente proprietario sia la proprietà della commessa collegata. Per lo Storage, i file restano privati e l’app genera URL firmati temporanei; i percorsi iniziano sempre con l’ID dell’utente.

Gli importi già presenti in `jobs.payments_received` vengono trasformati automaticamente in movimenti `job_payments` con la nota “Importo preesistente alla migrazione Fase 2”, così i dati della Fase 1 non vengono persi.

## Backup obbligatorio prima della Fase 3

Prima di eseguire `003_phase3_management.sql`:

1. Nell’app apri **Altro → Esporta JSON** e conserva il file fuori dalla cartella del progetto.
2. In Supabase apri **Database → Backups** e verifica l’ultimo punto di ripristino disponibile. I backup gestiti dipendono dal piano; Supabase raccomanda ai progetti Free di effettuare regolarmente un dump tramite CLI.
3. Per una copia logica locale installa la Supabase CLI, recupera la stringa di connessione **Session pooler** dal pulsante **Connect** e salvala temporaneamente in una variabile del Terminale, non nel progetto:

```bash
mkdir -p "$HOME/Documents/LuLab-backup-prima-fase-3"
cd "$HOME/Documents/LuLab-backup-prima-fase-3"
export LULAB_DB_URL='postgresql://...'
supabase db dump --db-url "$LULAB_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$LULAB_DB_URL" -f schema.sql
supabase db dump --db-url "$LULAB_DB_URL" -f data.sql --use-copy --data-only
unset LULAB_DB_URL
```

4. I dump database contengono i metadati Storage ma non i file. Da **Storage → Files → job-files** scarica gli allegati importanti; per un archivio completo usa i comandi Storage della CLI o un client S3 compatibile seguendo la documentazione Supabase.
5. Verifica che `roles.sql`, `schema.sql`, `data.sql` e i file Storage siano presenti prima di proseguire.

Riferimenti: [backup database Supabase](https://supabase.com/docs/guides/platform/backups) e [download oggetti Storage](https://supabase.com/docs/guides/storage/management/download-objects).

## Attivare la Fase 3 su Supabase

`supabase/migrations/003_phase3_management.sql` è incrementale e deve essere eseguita una sola volta dopo `001` e `002`.

1. Completa il backup descritto sopra.
2. Apri **Supabase Dashboard → SQL Editor → New query**.
3. Copia l’intero contenuto di `supabase/migrations/003_phase3_management.sql` e premi **Run**.
4. In **Table Editor** verifica le nuove tabelle: `material_categories`, `suppliers`, `materials`, `material_movements`, `recovered_items`, `recovered_item_files`, `recovery_time_entries`, `recovery_expenses`, `external_collaborators`, `antitarlo_treatments`.
5. Controlla che RLS sia attiva sulle dieci tabelle e che il bucket `job-files` resti **Private**.
6. Ricarica LuLab Desk ed entra in **Altro** per aprire i nuovi moduli.

La migrazione non riscrive le migrazioni precedenti. Aggiunge i collegamenti antitarlo a spese, pagamenti e agenda e introduce il registro di magazzino append-only. Le giacenze possono cambiare esclusivamente tramite nuovi movimenti; ogni consumo salva il costo unitario del momento e ogni correzione viene registrata come storno. Materiali, commesse, recuperi e fornitori referenziati dallo storico non possono essere eliminati a cascata.

## Gestione del sito pubblico

La sezione **Sito** permette agli editor autorizzati di gestire:

- Collezione LuLab, anche partendo dai mobili presenti nei Recuperi;
- progetti del portfolio, anche partendo da una commessa;
- fotografie private di bozza e copie pubbliche ottimizzate;
- pubblicazione, ritiro, ordinamento e contenuti in evidenza;
- richieste ricevute dal sito e relativi allegati privati.

La migrazione incrementale è `supabase/migrations/004_public_site.sql` e deve essere applicata una sola volta dopo `001`, `002` e `003`. Prima dell’esecuzione occorre disporre di un dump recuperabile dello schema e dei dati: il piano Free non include backup gestiti. La migrazione crea le tabelle editoriali, l’allowlist `site_editors` e i bucket:

- `site-drafts`, privato, per preparare le fotografie;
- `site-public`, pubblico, esclusivamente per le copie approvate;
- `inquiry-uploads`, privato, per gli allegati delle richieste.

Il primo owner non viene creato automaticamente. Dopo la migrazione, un amministratore del database deve verificare l’UUID dell’utente LuLab in `auth.users` e aggiungerlo esplicitamente:

```sql
insert into public.site_editors (user_id, role)
values ('UUID_UTENTE_LULAB_VERIFICATO', 'owner');
```

Il test transazionale `supabase/tests/004_public_site_security.sql` deve essere eseguito con arresto al primo errore su un database di prova oppure, dopo un backup verificato, prima dell’uso operativo delle nuove funzioni. Il rollback finale non conserva i dati di test.

I prezzi pubblici restano disattivati: l’interfaccia salva sempre `show_price=false` e `public_price=null`. Le tabelle di collegamento a commesse e recuperi non sono leggibili dal visitatore anonimo.

Il repository del sito pubblico esegue una build statica pianificata ogni cinque minuti, oltre che a ogni push e avvio manuale. Pubblicazioni e ritiri diventano quindi visibili senza esporre chiavi amministrative nel browser.

### Richieste dal sito pubblico

Il modulo pubblico usa la Edge Function `submit-inquiry`, presente in `supabase/functions/submit-inquiry`. La funzione è anonima soltanto come endpoint: valida l’origine, applica controlli antispam essenziali, verifica formato e firma delle immagini e usa la `service_role` esclusivamente nell’ambiente server gestito da Supabase. Non inserire mai quella chiave nel frontend o nei repository secrets di build.

Distribuzione nel progetto Supabase collegato:

```bash
supabase functions deploy submit-inquiry
```

Per aggiungere in futuro un dominio pubblico diverso da GitHub Pages, configurare il secret `PUBLIC_SITE_ORIGINS` della funzione con una lista di origini separate da virgole.

## Variabili locali

Il file `.env.local` nella cartella principale deve contenere:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

La chiave deve essere una **Publishable key**, mai una Secret key. `.env.local` è escluso da Git tramite `.gitignore`.

## Identità visiva e PWA

Il marchio ufficiale è conservato in `public/brand/logo-lulab-original.png`; la versione ottimizzata usata dall’interfaccia e dai PDF è `public/brand/logo-lulab.png`. Nome, nome dell’applicazione, email e percorso del logo sono centralizzati in `src/lib/brand.ts`.

Le icone PWA sono generate proporzionalmente dal PNG ufficiale, senza deformazioni o tagli:

- favicon 16×16, 32×32 e variante 64×64;
- icona Apple Touch 180×180 per iPhone e iPad;
- icone PWA 192×192 e 512×512 per Android, Mac e browser desktop;
- icona maskable 512×512 con il margine di sicurezza già presente nel file originale.

Il manifest è prodotto durante la build da `vite-plugin-pwa`. Dopo la pubblicazione HTTPS, LuLab Desk potrà essere installata dal menu del browser; su iPhone si usa **Condividi → Aggiungi alla schermata Home**.

## Preparazione per GitHub Pages

La destinazione prevista è esclusivamente:

- account GitHub: `lulabworks`;
- repository nuovo: `lulab-desk`;
- URL applicazione: `https://lulabworks.github.io/lulab-desk/`.

Il repository `lulabworks/lulabworks`, che contiene il sito pubblico del laboratorio, non deve essere modificato. Prima di creare il nuovo repository o inviare file, verificare l’account attivo con `gh auth status` e `gh api user --jq .login`: l’output deve essere esattamente `lulabworks`. Se compare un altro account, interrompere l’operazione.

Vite usa `base: '/lulab-desk/'`. React Router usa lo stesso basename e `public/404.html` gestisce i caricamenti diretti e i refresh delle pagine interne conservando anche query string e token Auth. La pubblicazione automatica è preparata in `.github/workflows/deploy-pages.yml`: a ogni push su `main` esegue installazione bloccata dal lockfile, typecheck, test, build e deploy dell’artefatto `dist` tramite GitHub Pages.

Nel nuovo repository configurare **Settings → Secrets and variables → Actions → New repository secret**:

- `VITE_SUPABASE_URL` con il Project URL esistente;
- `VITE_SUPABASE_PUBLISHABLE_KEY` con la Publishable key esistente.

Non usare e non salvare mai una Secret key o la chiave `service_role`. Le variabili `VITE_*` sono incluse nel client compilato: devono quindi contenere soltanto valori progettati per l’uso nel browser.

In **Settings → Pages**, selezionare **GitHub Actions** come sorgente. Nessun file `dist` deve essere aggiunto manualmente al repository.

### Configurazione Supabase Auth per la pubblicazione

Prima della messa online, in **Supabase → Authentication → URL Configuration** impostare:

- **Site URL:** `https://lulabworks.github.io/lulab-desk/`
- **Redirect URLs:**
  - `https://lulabworks.github.io/lulab-desk/recupera-password`
  - `http://localhost:5173/lulab-desk/recupera-password`

Il frontend calcola il `redirectTo` dal dominio corrente e dal base path Vite. In locale invia quindi al percorso locale; nella build GitHub Pages invia automaticamente all’URL HTTPS sopra indicato.

## Installazione e avvio sul Mac

Dal Terminale:

```bash
cd "/percorso/di/lulab-desk"
pnpm install
pnpm dev
```

Apri nel browser [http://localhost:5173/lulab-desk/](http://localhost:5173/lulab-desk/). Per fermare il server premi `Control-C` nel Terminale.

Se `pnpm` non è disponibile, installa Node.js 20 LTS, esegui `corepack enable` e riprova. In alternativa usa `npm install` e `npm run dev`.

Verifiche di produzione:

```bash
pnpm typecheck
pnpm test:phase3
pnpm test:site
pnpm test:adaptive
pnpm build
pnpm preview
```

`test:phase3` controlla i calcoli economici, la logica dei movimenti, la struttura RLS/permessi della migrazione 003 e verifica che le migrazioni 001 e 002 non siano state alterate.

`test:site` controlla struttura e RLS della migrazione 004, navigazione, prezzi nascosti, gestione richieste e ciclo fotografie bozza/pubblicazione/ritiro. Non sostituisce l’esecuzione SQL su PostgreSQL/Supabase.

## LuLab Adaptive — statistiche aggregate

La Fase 1 di LuLab Adaptive utilizza la migrazione additiva `supabase/migrations/005_usage_analytics.sql`, senza modificare le migrazioni 001–004. Il collaudo reale su PostgreSQL 17 isolato è stato superato; l’amministratore ha confermato l’applicazione della migrazione al progetto Supabase LuLab Desk e `collection_enabled = false`. La raccolta resta disabilitata fino ad approvazione separata. Raccoglie solo contatori per utente/giorno/funzione e l’ultimo utilizzo; non salva clic o dati delle lavorazioni. È invisibile nell’interfaccia e non raccoglie dati in sviluppo o test.

Il criterio visite, l’elenco degli identificatori, la gestione degli errori, le query amministrative per disattivare/eliminare esclusivamente le statistiche e la query read-only per il report 30/90 giorni sono descritti in [`docs/LULAB-ADAPTIVE.md`](docs/LULAB-ADAPTIVE.md). Il report SQL è in `supabase/reports/usage_analytics_30_90_days.sql`; il test di sicurezza SQL è in `supabase/tests/005_usage_analytics_security.sql` e va eseguito soltanto in un database isolato con due utenti di test.

La migrazione parte con `collection_enabled = false`: l'attivazione sarà esplicita dopo validazione. Ogni attività porta un timestamp UTC di origine (giorno definito in UTC anche per invii offline); il server accetta timestamp da 90 giorni nel passato a 5 minuti nel futuro. La coda IndexedDB è persistente fra chiusure e sessioni PWA e condivisa atomicamente fra schede; localStorage con Web Locks è il fallback. L'invio è circoscritto all'account autenticato corrente; le altre code restano separate. Le ricevute transazionali conservano solo una fingerprint SHA-256 e impediscono doppi incrementi anche con richieste concorrenti. `pnpm test:adaptive` verifica ripristino, cambio account, retry e concorrenza client simulata. Il test SQL transazionale è `supabase/tests/005_usage_analytics_security.sql`; il test PostgreSQL multi-sessione è `supabase/tests/005_usage_analytics_concurrency.sh` e va eseguito solo su un database isolato. Entrambi sono stati eseguiti con successo su PostgreSQL 17.11 e pgcrypto 1.3, con dipendenze Auth minime simulate; il cluster temporaneo è stato arrestato ed eliminato al termine.

## Funzioni Fase 2

- **Foto e allegati:** nella scheda commessa, suddivisi in Prima, Durante, Dopo e Documenti. Sono accettati JPG, PNG, WebP e PDF fino a 15 MB.
- **Preventivi:** materiali, quantità, prezzi unitari, ore e tariffa, trasporto, altre spese, margine, stato e PDF con intestazione LuLab. Un preventivo accettato aggiorna il ricavo concordato della commessa.
- **Agenda:** viste calendario ed elenco, eventi completi/modificabili per appuntamenti, sopralluoghi, ritiri, consegne, lavorazioni e scadenze.
- **Ore:** inserimento manuale o cronometro; una sola sessione può essere attiva per utente. La tariffa predefinita si configura in **Altro**.
- **Economia:** spese, acconti, saldi e altri pagamenti; riepilogo separato di preventivo, consuntivo, incassato, da incassare e margine.

## Funzioni Fase 3

- **Materiali:** categorie, unità, fornitori, prezzi, scorte minime, carichi, scarichi, rettifiche, storni e storico immutabile.
- **Consumi commessa:** scarico automatico della giacenza e costo storico separato dalle spese Fase 2 per evitare duplicazioni.
- **Recuperi:** inventario mobili, fotografie private, lavorazioni, materiali, ore, spese, vendita, costo complessivo e margine.
- **Antitarlo:** schede collegate alle commesse, collaboratori, date operative, costi e pagamenti riutilizzati dalla Fase 2 e inserimento in agenda.
- **Statistiche:** filtri per data, ricavi, incassi, importi aperti, costi, ore, manodopera, margini, tipologie e andamento mensile.

## Recupero password

1. Nella schermata di accesso scegli **Password dimenticata**.
2. Inserisci l’email dell’account.
3. Apri il link ricevuto via email.
4. In `/lulab-desk/recupera-password` scegli e conferma la nuova password.
5. Seleziona **Continua in LuLab Desk**.

## Autosalvataggio e affidabilità

Le modifiche alla scheda commessa vengono accodate e salvate in ordine. Cambiando schermata durante i 700 ms di attesa, il salvataggio pendente parte subito e si accoda dietro alle richieste in corso; alla chiusura o al ricaricamento, il browser avvisa se ci sono operazioni pendenti. Preventivi e moduli economici mostrano invece azioni di salvataggio esplicite o registrano immediatamente ogni movimento.

## Esportazione e backup

**Altro → Esporta JSON** include automaticamente i dati delle fasi presenti nel database. Prima dell’applicazione della Fase 3 continua quindi a esportare correttamente le Fasi 1 e 2. Per gli allegati contiene i metadati, non i file binari.

## Stato del progetto

- **Fase 1:** implementata e mantenuta.
- **Fase 2:** implementata.
- **Fase 3:** implementata; la migrazione `003_phase3_management.sql` è stata applicata al progetto Supabase configurato.
- **Sito:** interfaccia editoriale attiva; la migrazione 004 è applicata e il primo owner LuLab è configurato.
- **GitHub Pages:** pubblicazione del gestionale configurata nel repository dedicato.

Nessuna modifica al database o al repository remoto viene effettuata dalle normali verifiche locali.
