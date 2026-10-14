# LuLab Adaptive — Fase 1

Questa fondazione raccoglie solo contatori aggregati di utilizzo. Non aggiunge pagine, controlli o impostazioni visibili all'utilizzatore e non modifica i flussi operativi.

## Criterio di conteggio

- Una visita viene conteggiata quando l'utente autenticato entra in una sezione principale: primo caricamento dell'app e ogni passaggio successivo fra sezioni diverse. L'apertura di una scheda dettaglio, una route annidata, un cambio di query string, un rerender o il replay dell'effetto React StrictMode non aggiungono visite. Tornare a una sezione dopo esserne usciti conta una nuova visita.
- Le operazioni vengono accodate soltanto dopo la risposta Supabase senza errore. Gli autosalvataggi della commessa vengono contati per ogni salvataggio effettivamente confermato; la coda li aggrega in un'unica richiesta breve.
- Ogni attività riceve subito un `occurred_at` ISO-8601 UTC. Il giorno aggregato è la data UTC di quel timestamp: mezzanotte locale/DST e ritardi di invio non spostano l'attività a un altro giorno. L'RPC accetta attività da 90 giorni nel passato fino a 5 minuti nel futuro rispetto al server; oltre questi limiti il batch viene rifiutato.
- Il dispositivo accorpa eventi per utente/funzione/giorno UTC per circa 1,5 secondi. La coda primaria è in IndexedDB, con una riga per account e transazioni read/write atomiche condivise fra schede. Se IndexedDB non è disponibile, si usa localStorage coordinato dal Web Locks API quando supportato; senza entrambi si ricade in memoria soltanto. Ogni batch congelato ha un UUID e un payload immutabili. Chiusura completa della PWA, nuova sessione iOS e schede successive recuperano la stessa coda persistente; una risposta persa riutilizza ID e payload, senza duplicare contatori. iOS può comunque rimuovere dati locali per pulizia/gestione spazio o quando l'utente cancella i dati del sito; inoltre non garantisce l'esecuzione JavaScript in background a PWA chiusa. Il successivo avvio riprende la coda, ma non può caricarla mentre l'app è terminata.
- `last_used_at` è il massimo `occurred_at` delle attività, non l'ora di ricezione. Il timestamp proviene dall'orologio del client: il server valida formato e finestra temporale, ma non può attestare crittograficamente l'orologio del dispositivo.
- L'uso non viene raccolto in sviluppo o durante i test (`import.meta.env.PROD` deve essere vero). Non eseguire flussi di prova sull'app di produzione.

## Dati e sicurezza

`usage_daily_aggregates` contiene solo `user_id`, giorno UTC, identificatore stabile della funzione, due contatori e ultimo uso. Non esiste una riga per clic. Il frontend non invia né salva nomi, descrizioni, note, importi, fotografie, percorsi file, ID di entità operative o URL. `auth.uid()` è l'unica fonte dell'identità; il client usa la publishable key già prevista e non contiene service-role key.

La tabella è leggibile esclusivamente dall'utente autenticato proprietario della riga; nessun ruolo client può scriverla direttamente. L'RPC `record_usage_batch(uuid, jsonb)` è l'unico percorso di scrittura, valida catalogo, conteggi, schema del payload e timestamp prima di ogni modifica. La chiave `(user_id, batch_id)` delle ricevute e la scrittura di ricevuta + aggregati nella stessa transazione rendono idempotenti anche richieste concorrenti. La ricevuta conserva solo SHA-256 esadecimale del JSONB canonico UTF-8, non il payload. Riutilizzare l'UUID con contenuto diverso viene rifiutato confrontando l'impronta. La migrazione installa `pgcrypto` (estensione PostgreSQL supportata anche da Supabase) e individua il suo schema effettivo per qualificare `digest(..., 'sha256')`. Le ricevute sono conservate per 100 giorni, oltre la massima finestra di attività offline di 90 giorni.

La coda è separata per UUID account. Il sender richiede la sessione corrente e controlla che corrisponda al proprietario prima dell'invio; il client RPC effimero è vincolato al token appena verificato e una transizione Auth annulla la richiesta in corso. Il database attribuisce i dati esclusivamente con `auth.uid()`. Se l'account A è disconnesso mentre è attivo B, la coda A resta in IndexedDB e viene ripresa su `SIGNED_IN`/refresh quando A torna attivo. Schede multiple condividono gli aggiornamenti atomici IndexedDB; due flush possono inviare lo stesso batch, ma stesso UUID/payload e deduplicazione server rendono innocuo il retry.

`collection_enabled` è `false` sia come default sia nella riga iniziale. L'RPC non registra né deduplica batch mentre la raccolta è disabilitata. L'abilitazione deve essere esplicita e amministrativa, dopo approvazione:

```sql
update public.usage_analytics_config
set collection_enabled = true, updated_at = now()
where singleton = true;
```

Per disabilitare la raccolta dal SQL Editor Supabase con il ruolo amministrativo:

```sql
update public.usage_analytics_config
set collection_enabled = false, updated_at = now()
where singleton = true;
```

Solo dopo averla disabilitata, per eliminare esclusivamente le statistiche di utilizzo:

```sql
delete from public.usage_daily_aggregates;
```

Queste istruzioni non toccano commesse, clienti, allegati o altri dati operativi. Non riabilitare la raccolta senza approvazione. La tabella di catalogo e la configurazione non sono accessibili ai ruoli client.

## Report periodico

Usare [la query di report](../supabase/reports/usage_analytics_30_90_days.sql) nel SQL Editor. Sostituire l'UUID con quello dell'utente da analizzare e `30` con `90` per il periodo trimestrale. La query è di sola lettura e include ogni funzione registrata, anche quelle mai usate. Lo stato distingue `usata_nel_periodo`, `non_usata_nel_periodo` (uso storico precedente), `mai_usata` (l'utente ha altri dati, ma non quella funzione) e `nessun_dato_disponibile` (nessuna statistica per l'utente).

## Test e attivazione

Eseguire `pnpm test:adaptive` per testare catalogo, classificazione route, transazioni client simulate tra schede, ripristino dopo una nuova istanza, retry con UUID/payload invariati, timestamp offline e cambio account. `supabase/tests/005_usage_analytics_security.sql` è transazionale e verifica anche che la fingerprint SHA-256 corrisponda a pgcrypto e che la ricevuta non contenga il payload. Per provare la concorrenza PostgreSQL reale su ambiente isolato, dopo migrazioni 001–005 e raccolta esplicitamente attivata, eseguire `DATABASE_URL=... TEST_USER_ID=... bash supabase/tests/005_usage_analytics_concurrency.sh`. Non eseguire sul progetto operativo.

Il test SQL e l'harness multi-sessione sono stati eseguiti con successo su PostgreSQL 17.11 in un cluster temporaneo isolato, con pgcrypto 1.3 e dipendenze Auth minime simulate. Sono stati verificati retry, SHA-256, isolamento RLS, accesso anonimo, raccolta disabilitata, payload non validi e due connessioni concorrenti. Il test SQL ha annullato le proprie scritture e il cluster è stato arrestato ed eliminato al termine. Il collaudo non include il gateway JWT o i servizi Auth e Storage completi di Supabase.

L’amministratore ha confermato l’applicazione della migrazione 005 al progetto Supabase LuLab Desk e la presenza delle tabelle e dell’RPC con `collection_enabled = false`. Il frontend può essere pubblicato mantenendo la raccolta disabilitata. L’abilitazione di `collection_enabled` richiede una successiva approvazione separata, dopo la verifica della versione pubblicata. Non rieseguire la migrazione già applicata.
