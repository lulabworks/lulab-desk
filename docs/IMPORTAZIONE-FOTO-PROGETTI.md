# Fotografie della commessa nei Progetti

Quando si crea un progetto da una commessa, dopo la creazione della bozza e del collegamento viene avviata l'importazione delle fotografie. L'editor offre anche **Importa foto dalla commessa**. I progetti indipendenti mantengono il caricamento manuale.

Si leggono tramite la sessione autenticata i `job_files` visibili all'utente: soltanto categorie Prima, Durante, Dopo con MIME fotografico. Documenti e PDF sono esclusi. Ogni file viene scaricato da `job-files`, decodificato e ridimensionato con la pipeline esistente (lato massimo 2200px, WebP o JPEG). La copia viene caricata esclusivamente in `site-drafts`, con percorso casuale, conservando la categoria. Non si copiano nome originale, note, recapiti o altri metadati operativi: il testo alternativo iniziale è generico e modificabile. Canvas elimina i metadati EXIF dell'originale.

La chiave dell'immagine è un UUID opaco derivato deterministicamente da SHA-256 di namespace, ID progetto e ID file. La chiave primaria esistente impone un solo record per coppia anche tra schede/dispositivi concorrenti. Non servono migrazioni, nuovi campi pubblici o variazioni a RLS/GRANT. La deduplicazione resta valida quando le copie vengono spostate tra bucket durante pubblicazione/ritiro; non è una deduplicazione per contenuto binario (due record operativi distinti sono due fotografie).

Le nuove foto si accodano senza aggiornare quelle esistenti. Solo una galleria inizialmente vuota riceve una copertina automatica; il normale comando Copertina permette di cambiarla. L'importazione non pubblica, non invoca sincronizzazione e non modifica le commesse. Nei progetti già pubblicati, le nuove immagini richiedono **Pubblica aggiornamenti**. Eliminare una copia del progetto non elimina la sorgente. Una successiva importazione esplicita può importare nuovamente una copia eliminata: non esiste uno storico permanente delle esclusioni.

Ogni foto viene elaborata separatamente. Il riepilogo indica importate, già presenti ed errori; si può ripetere l'operazione dopo un'interruzione. Un conflitto di chiave rimuove solo il percorso casuale di quel tentativo. Una risposta di INSERT persa viene verificata prima di eliminare la copia. Se anche la verifica di rete fallisce, il file privato viene conservato prudenzialmente: può restare un oggetto privato orfano, senza esposizione pubblica. In casi di arresto del browser a metà operazione non è possibile garantire la pulizia degli oggetti Storage senza una transazione distribuita. Il caricamento resta sequenziale per contenere memoria su iPhone.

## Verifiche locali

`pnpm test:project-photo-import` esegue la logica reale con client Storage/DB e decodifica/canvas simulati: tre categorie, esclusione documenti, copie private indipendenti, copertina, ripetizioni, nuovi file, errori parziali, importazioni concorrenti arbitrate dalla chiave primaria, risposta persa, fallback JPEG Safari. Non costituisce un test reale di Supabase, RLS, conversione HEIC o fotocamera.

Da verificare su Safari iOS e su un ambiente autorizzato: creazione da commessa fotografata, galleria e cambio copertina, rimozione della sola copia, importazione successiva, file HEIC/HEIF, permessi e interruzioni reali di rete. Se Safari non decodifica HEIC/HEIF, viene mostrato l'errore già previsto dalla pipeline con indicazione di esportazione “Più compatibile”.
