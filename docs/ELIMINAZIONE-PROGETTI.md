# Eliminazione definitiva dei Progetti del sito

Nell'editor Progetti, in fondo alla schermata, **Elimina progetto** apre una conferma con titolo e conseguenze. Durante l'operazione i comandi dell'editor sono disabilitati. Il progetto non viene eliminato prima della conferma.

Non servono migrazioni: si usano RLS, GRANT e vincoli della 004. La policy di DELETE del progetto è riservata agli **owner editoriali**, un sottoinsieme degli editor attivi. La funzione applicativa verifica `is_site_owner` prima di qualsiasi operazione; non amplia le autorizzazioni. Un editor senza ruolo owner riceve un errore senza cancellazioni.

## Sequenza

1. Legge dal database la scheda e le immagini attuali (non usa la galleria eventualmente obsoleta dell'editor).
2. Elimina i metadati delle copie fotografiche e i relativi oggetti utilizzando il helper esistente. L'ordine metadati → Storage rispetta le policy. In caso di errore Storage, il helper tenta di ripristinare i metadati.
3. Elenca e rimuove gli eventuali oggetti rimasti nel solo prefisso `portfolio/<id>/`, nei bucket `site-public` e `site-drafts`, con paginazione. Verifica che siano assenti anche quando Storage risponde senza errori ma non cancella per RLS.
4. Verifica l'assenza dei metadati, ritira la scheda tramite il ciclo esistente e cancella il progetto con conferma della riga eliminata. Il media guard della 004 impedisce ritiro/DELETE se restano oggetti pubblici. Il FK già presente cancella soltanto il collegamento `site_portfolio_project_sources` nello stesso DELETE; non coinvolge la commessa.
5. Verifica l'assenza del collegamento e ricontrolla i bucket. Torna a `/sito?area=projects`, dove l'elenco viene ricaricato.

Nessuna scrittura su `jobs`, `job_files` o `job-files`. Sono rimossi solo i file derivati del progetto, anche quando originati dall'importazione automatica. Non si aggiungono cascade.

Se il contenuto era pubblico o vengono incontrati file pubblici, richiede la rigenerazione attraverso la coda di sincronizzazione esistente anche in caso di errore parziale. La pagina Sito mostra lo stato della richiesta e il comando di retry. Il sito statico resta quello dell'ultimo deploy finché la ricompilazione non termina; copie già scaricate o presenti in cache esterne non sono revocabili dal client. Gli oggetti vengono eliminati dallo Storage di origine.

## Errori e verifiche

Non esiste una transazione unica fra PostgreSQL e Storage: una cancellazione può essere parziale. L'interfaccia lo segnala senza messaggio di successo e permette di riprovare, usando sempre lo stato reale. Una seconda chiamata può completare la pulizia anche se la scheda è stata già eliminata. Evitare modifiche contemporanee allo stesso progetto da altri dispositivi durante l'eliminazione: i vincoli DB bloccano riferimenti concorrenti, ma un upload interrotto senza metadati può comunque lasciare un oggetto privato, recuperabile con un nuovo tentativo. Le verifiche non sono un lock distribuito.

`pnpm test:site-project-deletion` esegue la procedura e i helper reali di cancellazione/ritiro con client DB/Storage simulato: bozze e pubblicati, controllo owner, pulizia orfani oltre 100 elementi, isolamento dei percorsi, errori metadati/Storage/elenco/DELETE, rifiuto silenzioso RLS, verifica finale fallita e retry, sincronizzazione. Non accede a dati reali.

Restano da collaudare in un ambiente autorizzato RLS e trigger reali, errori di rete reali, richiesta di rebuild e UI Safari iPhone (modal, focus, scroll e safe area). I test locali non certificano questi comportamenti su un dispositivo fisico.
