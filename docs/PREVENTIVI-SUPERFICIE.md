# Preventivi a superficie — preparazione locale

La migrazione `009_quote_surface.sql` è stata applicata al progetto Supabase di produzione. Il frontend aggiornato è ancora locale. La migrazione richiede lo schema preventivi esistente e non modifica le migrazioni precedenti, RLS, GRANT o totali salvati.

Ogni voce può essere materiale o prestazione, con calcolo manuale oppure a superficie. I preventivi precedenti restano manuali e classificati come materiali: nessuna reinterpretazione automatica del loro contenuto.

Formula: larghezza × altezza / 10.000 × elementi × facce. Le misure sono in cm, positive e con massimo due decimali; numero elementi intero da 1 a 10.000, facce 1 o 2. Si conserva la superficie con otto decimali per non perdere piccole misure o precisione con molte unità. L'unità è m² e la tariffa ha due decimali. Il database ricalcola la quantità dalle misure a ogni modifica. Le misure rimangono modificabili dopo il caricamento.

Le nuove voci superficie e prestazioni sono arrotondate al centesimo per voce. Subtotale, margine e totale vengono arrotondati al centesimo nei preventivi che le contengono. Le vecchie voci manuali materiali e i preventivi che contengono soltanto queste mantengono il precedente algoritmo, senza riscritture o ricalcoli retroattivi.

La tariffa al m² può includere la manodopera (impostazione iniziale selezionata). Non genera ore aggiuntive. Il riepilogo distingue materiali, prestazioni e ore aggiuntive; una conferma al salvataggio/PDF verifica che eventuali ore escludano il lavoro già compreso nelle tariffe. Se il lavoro non è incluso, aggiungere esplicitamente le ore necessarie. Telai, ferramenta, trattamenti, trasporto e altre lavorazioni possono essere aggiunti separatamente con il metodo manuale.

Il PDF riporta per ogni voce descrizione, misure se presenti, superficie/quantità, unità, prezzo e importo; riepiloga separatamente materiali, prestazioni e ore aggiuntive. Il margine esistente continua ad applicarsi all'intero subtotale.

## Verifiche

- `pnpm typecheck`
- `pnpm test:quote-surface`: misure, facce, limiti, precisione, arrotondamento, riepiloghi, manodopera, legacy e generazione del contenuto PDF con documento simulato.
- `pnpm test:quote-surface:postgres`: PostgreSQL temporaneo con dipendenze Auth/Storage minime; applicazione 009, conservazione importi precedenti, ricalcolo dopo modifica, vincoli, RLS multiutente, anon e rollback. Il cluster viene fermato e rimosso.
- `pnpm test` e `pnpm build`.

Da verificare manualmente su iPhone e con un PDF reale: leggibilità delle misure e delle descrizioni lunghe, campi numerici e salvataggio/riapertura con il frontend aggiornato. In produzione è stata verificata la migrazione e l'integrità dei preventivi esistenti; non sono stati creati o modificati preventivi per il collaudo.
