# Scansione codici a barre del magazzino

La sezione Materiali propone **Scansiona**. All'apertura richiede la fotocamera posteriore; usa BarcodeDetector soltanto se dichiara tutti i formati richiesti, altrimenti il lettore open source ZXing incorporato nell'app. Supporta EAN-13, EAN-8, UPC-A, UPC-E e Code 128. Non usa cataloghi, riconoscimento AI o servizi esterni. I fotogrammi vengono elaborati sul dispositivo e non caricati.

Una lettura ferma subito fotocamera e decoder. Il codice viene cercato in `materials` con il `user_id` della sessione e con RLS. Il materiale trovato mostra nome, unità, giacenza e prezzo. Carico/scarico usano lo stesso inserimento dei movimenti della gestione manuale. Prima della conferma la giacenza viene riletta; il trigger PostgreSQL resta responsabile del saldo atomico, anche in concorrenza. La conferma non avviene mai automaticamente.

Lo scarico può essere generico, su commessa o su recupero. Un recupero collegato viene registrato come `consumo_commessa`, conservando anche `recovered_item_id`: nessuna spesa parallela viene creata. Quantità e costi rispettano le precisioni già previste (tre e quattro decimali). La scheda consente di associare, modificare e cancellare il barcode indipendentemente dal codice interno. Un codice sconosciuto apre una scheda con il solo barcode precompilato; nome, unità e prezzo devono essere scelti dall'utente.

## Migrazione 007

`supabase/migrations/007_material_barcodes.sql` aggiunge una colonna `materials.barcode` nullable, senza riempire o alterare le righe esistenti. Il testo conserva gli zeri iniziali e accetta fino a 128 caratteri ASCII stampabili (spazi interni ammessi per Code 128; niente spazi ai bordi). Il vincolo univoco parziale vale per utente e considera equivalenti UPC-A a 12 cifre ed EAN-13 con zero iniziale. Non ricaviamo mai il barcode da `materials.code`.

Il test PostgreSQL con le migrazioni 001–003 ha rilevato `infinite recursion` sulla policy INSERT di `material_movements`. La 007 rimuove dalla policy la sottoquery autoreferenziale ridondante, mantenendo e qualificando i controlli di appartenenza di materiale, commessa, recupero e fornitore. Il trigger esistente `validate_material_movement_links` continua a verificare proprietario, costo, quantità e riferimenti di ogni storno. RLS rimane attiva; grant e letture restano invariati, senza accesso anonimo, nuove funzioni privilegiate o modifiche alle migrazioni 001–006.

## Ordine di attivazione in produzione

1. Ottenere l'autorizzazione del proprietario. Verificare progetto `lulab-desk`, riferimento `klkqwisnnhbazcqmwjmv`, e schema già presente. Conservare un backup recuperabile di schema e dati prima dell'intervento.
2. Applicare **soltanto 007**, una volta, con il normale sistema di migrazioni o SQL Editor. È una transazione. Non rilanciare le migrazioni precedenti né effettuare reset. L'app già pubblicata rimane compatibile con questa aggiunta.
3. Verificare colonna, indici, policy, RLS e conservazione di materiali, giacenze e storico. Se una verifica fallisce, fermare la pubblicazione e analizzare l'errore. La migrazione genera anche il reload della cache PostgREST.
4. Solo dopo l'esito positivo, pubblicare il commit frontend su `lulabworks/lulab-desk`, attendere GitHub Actions e verificare la versione incorporata nel footer Impostazioni.
5. Collaudare la fotocamera sulla PWA iPhone aggiornata via HTTPS, iniziando da Scansiona. Nessun permesso viene chiesto prima di tale azione.

Se il frontend locale usa uno schema precedente, la scansione resta disabilitata e il salvataggio manuale omette la colonna barcode. Questo presidio non sostituisce l'ordine database → verifica → frontend per la pubblicazione.

## Verifiche automatiche

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:barcodes:postgres
```

`test:barcodes` decodifica raster sintetici EAN-13, EAN-8, UPC-A e Code 128 con ZXing, verifica alias/zeri, payload e quantità, scarichi su recuperi collegati e autonomi. Con media API simulate verifica lettura singola, rilascio delle tracce, cancellazione mentre il permesso è pendente e permesso negato. Queste prove non sostituiscono un test della fotocamera su iPhone.

`test:barcodes:postgres` richiede PostgreSQL 17 già installato. Crea un cluster temporaneo in `/tmp/lulab-barcodes.*`, senza TCP e con socket dedicata; usa esclusivamente credenziali locali trust e non legge quelle Supabase. Applica 001–003 e 007 con dipendenze Auth/Storage minime simulate, testa barcode, legacy, RLS/anon, consumi, costi storici, storni e scarichi concorrenti tramite due connessioni. Verifica il rollback delle fixture della suite SQL e arresta/rimuove il cluster anche in caso di errore. Non avvia `brew services` e non usa il cluster Homebrew predefinito. Il percorso dei binari può essere specificato tramite `BARCODE_PG_BIN`.

Non vengono collaudati qui PostgREST reale, sessioni Supabase reali o permessi iOS.

## Prova reale iPhone ancora necessaria

- Safari e PWA installata, HTTPS: Scansiona → permesso posteriore; prova anche diniego e recupero tramite inserimento manuale.
- Leggere confezioni reali EAN/UPC e Code 128, anche con orientamento e illuminazione differenti. Confermare una sola lettura e nessuna registrazione prima della conferma.
- Quantità nell'unità scelta, giacenza finale, costo storico, destinazione, reload e storno. Verificare il comportamento con rete assente o stock cambiato nel frattempo.
- Codice sconosciuto → nuova scheda; codice duplicato e associazione manuale. Gli zeri iniziali devono restare presenti.
- Chiudere con X, uscire dalla pagina, passare a un'altra app e riaprire la PWA: la fotocamera deve spegnersi e ripartire solo su richiesta. Controllare tastiera, safe area e scorrimento a 375/390/430 px.

Gli articoli non vengono inventati e nessun dato sintetico va inserito in produzione per eseguire automaticamente questi test.
