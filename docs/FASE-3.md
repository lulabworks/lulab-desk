# LuLab Desk — Architettura Fase 3

## Confini

La Fase 3 aggiunge magazzino, inventario recuperi, trattamenti antitarlo e analisi economica. Le tabelle e le funzioni delle Fasi 1 e 2 restano la fonte autorevole per commesse, clienti, ore, spese, pagamenti e agenda.

## Regole economiche

- Un acquisto di magazzino è un movimento `carico`: descrive l’uscita di cassa per acquistare scorte, ma non viene sommato direttamente al costo di una commessa.
- Un consumo salva `unit_cost_snapshot` e riduce la giacenza. Il suo valore entra nel consuntivo della commessa o del recupero una sola volta.
- Un consumo non crea una riga in `job_expenses`; questo evita il doppio conteggio con le spese Fase 2.
- Ore e spese di un recupero collegato a una commessa sono lette dalle tabelle Fase 2. Le tabelle autonome `recovery_time_entries` e `recovery_expenses` sono utilizzabili soltanto per recuperi senza commessa.
- Costi e pagamenti antitarlo restano rispettivamente in `job_expenses` e `job_payments`, con un riferimento opzionale al trattamento. Il prezzo concordato proviene da `jobs.agreed_revenue`.
- Una commessa può avere più trattamenti antitarlo; cliente e recupero collegati devono restare coerenti con la commessa.
- Il margine considera ricavo concordato, spese, materiali consumati e valore delle ore. Gli incassi sono mostrati separatamente dal ricavo.

## Integrità del magazzino

`materials.quantity_available` non è modificabile direttamente. Il trigger `material_movements_apply_stock` applica soltanto nuovi carichi, scarichi, consumi, rettifiche e storni. Un’operazione che porterebbe la giacenza sotto zero viene rifiutata e annullata integralmente.

Il registro `material_movements` è append-only: `authenticated` può leggerlo e inserire righe, ma non modificarle o cancellarle. Uno storno è una nuova rettifica collegata in modo univoco al movimento originale e deve invertirne esattamente quantità, costo e riferimenti. I riferimenti a materiale, commessa, recupero e fornitore usano `ON DELETE RESTRICT`, quindi nessuna cancellazione a cascata può riscrivere artificialmente la giacenza. Materiali e recuperi vanno disattivati o archiviati, non eliminati; le commesse vengono concluse e conservate.

Il costo storico appartiene al movimento. Aggiornare il prezzo nel catalogo non modifica i costi già imputati.

Un recupero può cambiare commessa soltanto quando non ha consumi attivi. Per collegarlo da gestione autonoma devono inoltre essere assenti ore e spese autonome; per scollegarlo o spostarlo devono essere assenti ore e spese sulla vecchia commessa. Un indice impedisce di collegare più recuperi alla stessa commessa, evitando di attribuire due volte gli stessi costi della Fase 2.

## Sicurezza

Le dieci nuove tabelle hanno RLS attiva, privilegi CRUD concessi solo ad `authenticated` e privilegi revocati ad `anon`. Le policy verificano `user_id` e la proprietà di ogni riferimento a commessa, materiale, recupero, cliente, fornitore o collaboratore.

Le fotografie dei recuperi riutilizzano il bucket privato `job-files`; il percorso inizia con l’ID utente e l’app utilizza URL firmati temporanei.

## Verifica dopo l’attivazione

1. Crea un materiale con giacenza zero.
2. Registra un carico di 10 unità: la giacenza deve diventare 10.
3. Registra un consumo commessa di 3 unità: la giacenza deve diventare 7 e il costo deve apparire nel consuntivo.
4. Modifica il prezzo del catalogo: il costo del consumo precedente deve restare invariato.
5. Storna il consumo: la giacenza deve tornare a 10, mentre originale e storno devono restare visibili.
6. Prova un consumo maggiore della giacenza: Supabase deve rifiutarlo.
7. Crea un recupero autonomo e registra ore, spese e materiali; verifica costo totale e margine.
8. Crea un trattamento, aggiungi costo e pagamento, poi genera un evento agenda; verifica che tutti i record puntino alla stessa commessa.
9. Verifica che un materiale, una commessa o un recupero con movimenti non possa essere eliminato.
10. Prova a collegare, scollegare e riassegnare un recupero con consumi attivi o costi esistenti: l’operazione deve essere rifiutata fino allo storno o alla rimozione controllata dei dati incompatibili.

Prima dell’attivazione si possono ripetere i controlli locali con `pnpm typecheck`, `pnpm test:phase3` e `pnpm build`.
