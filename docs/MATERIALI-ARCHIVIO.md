# Ciclo di vita dei materiali

La migrazione `008_material_lifecycle.sql` richiede le migrazioni precedenti, inclusa 007, ed è stata applicata al progetto Supabase di produzione. Il codice frontend descritto qui è preparato localmente e non ancora pubblicato.

## Uso

- Modifica materiale → **Archivia materiale**: richiede giacenza esattamente zero. Conserva codice interno, barcode, prezzi, storico e riferimenti. I materiali archiviati non sono nell'elenco operativo o nei nuovi movimenti.
- **Mostra archiviati** → scheda → **Ripristina**: cambia solo `is_active`, mantenendo i dati.
- **Elimina materiale definitivamente**: conferma con il nome; disponibile solo a giacenza zero, senza movimenti né riferimenti protetti da FK. Non elimina record collegati.
- Il barcode di un archiviato apre la proposta di ripristino, non la creazione di un duplicato. Il vincolo di unicità 007 continua a includere gli archiviati.
- Gli storni di un archiviato sono respinti: ripristinare il materiale in Materiali e poi stornare normalmente. Non si modifica mai lo storico.

## Garanzie database

La 008 non cambia RLS, GRANT, FK o immutabilità dei movimenti. Aggiunge il vincolo `materials_archived_zero_stock`, il trigger di ciclo di vita e aggiorna soltanto la funzione stock esistente, preservandone SECURITY DEFINER, search_path vuoto, ownership e ACL.

Ogni movimento, storni inclusi, acquisisce `FOR NO KEY UPDATE` sulla riga del materiale e ne controlla il proprietario e lo stato. Questo lock è compatibile con i lock KEY SHARE delle FK, evitando un upgrade a FOR UPDATE che potrebbe causare deadlock fra due movimenti. Archiviazione e movimentazione sono serializzate sulla stessa riga; anche gli errori nel trigger AFTER INSERT annullano integralmente il movimento.

Se un movimento precede l'archiviazione, questa verifica la giacenza risultante; se l'archiviazione precede il movimento, il movimento viene respinto. Anche una rettifica netta zero su un archiviato viene rifiutata.

Il preflight ha controllato i materiali presenti al momento dell'applicazione e avrebbe bloccato la migrazione in caso di archiviati con quantità diversa da zero. Non corregge alcun dato. La migrazione è transazionale e non va rieseguita fuori dal normale storico migrazioni.

## Verifiche locali

```
pnpm typecheck
pnpm test
pnpm test:material-lifecycle:postgres
pnpm build
```

Il runner PostgreSQL usa un cluster temporaneo, socket dedicata, nessuna connessione TCP o credenziale Supabase. Applica solo in quel cluster le dipendenze operative 001–003, 007 e 008. Verifica preflight/rollback, materiali preesistenti, isolamento RLS, anonimato, archivio/ripristino, storni, FK, GRANT e otto gare fra due connessioni reali: archivio↔carico, scarico→archivio, carico↔carico, archivio↔storno, eliminazione↔carico. Arresta ed elimina il cluster a fine test, anche in caso di errore.

Il controllo client di giacenza e riferimenti migliora il messaggio all'utente; i trigger e le FK sono sempre autorevoli per finestre obsolete, richieste dirette o più dispositivi. I selettori commesse e recuperi filtrano già `is_active`; se una schermata è rimasta aperta, il database respinge il salvataggio e restituisce l'invito al ripristino.

Da provare manualmente prima del rilascio: conferme native e azioni da iPhone, cambio dei filtri, ripristino dopo scansione e messaggi per una scheda aperta prima dell'archiviazione su un altro dispositivo. Nessun test con dati reali in produzione.

## File interessati

Nuovi:

- `supabase/migrations/008_material_lifecycle.sql`
- `supabase/tests/008_material_lifecycle.sql`
- `src/components/MaterialLifecycleActions.tsx`
- `src/lib/materialLifecycle.ts`
- `scripts/verify-material-lifecycle.mjs`
- `scripts/test-material-lifecycle-postgres.mjs`
- `docs/MATERIALI-ARCHIVIO.md`

Aggiornati:

- `src/pages/MaterialsPage.tsx`
- `src/components/MaterialBarcodeScanner.tsx`
- `src/components/MaterialMovementDialog.tsx`
- `src/lib/materialMovement.ts`
- `package.json`
- `README.md`

I selettori di `JobMaterialsPanel.tsx` e `RecoveryDetailPage.tsx` sono stati verificati e non richiedono modifiche: filtrano già gli attivi. Le migrazioni 001–007 non sono state modificate.
