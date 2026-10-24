# Modifica dei campi numerici

`Input` usa `NumericInput` soltanto per `type="number"`. Il controllo conserva il valore del modulo e prepara una bozza testuale vuota al focus, così il primo numero digitato sostituisce subito quello precedente. Focus e digitazione non invocano gli handler del modulo.

Alla perdita del focus, al tasto Invio oppure alla pressione di un controllo esterno viene accettata la bozza numerica. Una bozza vuota ripristina il valore presente all'ingresso nel campo, anche quando era zero o vuoto. Escape annulla la bozza. Nessun valore viene comunicato durante lo smontaggio del componente. Il controllo non salva dati: le pagine mantengono le proprie azioni esplicite di salvataggio. I riepiloghi si aggiornano quando si accetta il campo.

L'accettazione prima del click copre anche i pulsanti Safari che non spostano il focus. Non vengono bloccati eventi touch o cambiati focus, scorrimento e comportamento dei modali. Il tipo number e gli attributi required/min/max/step rimangono nativi; una digitazione non riconosciuta dal browser resta soggetta alla validazione nativa. La tastiera suggerita è numerica per gli interi e decimale per gli altri valori, salvo inputMode esplicito.

L'audit include preventivi e superficie, materiali e scanner/movimenti, consumi nelle commesse e recuperi, costi dei recuperi, ore, spese e pagamenti, antitarlo, tariffa oraria e ordinamento editoriale. Tutti gli input numerici usano il componente condiviso. Agenda e schede lavoro usano date, orari, selezioni e testi, il cui comportamento non cambia. Codici e barcode restano testi e conservano gli zeri iniziali; nessun testo, email o data viene svuotato o selezionato automaticamente.

## Verifiche

`pnpm test:numeric-inputs` usa un browser WebKit già installato tramite Playwright (locale italiano, larghezze 375/390/430/1280), un modulo React isolato e il vero componente Input. Copre sostituzione 0 → 100, ripristino 0/125, campi facoltativi vuoti, decimali digitati, zero intenzionale, Escape, annullamento del modulo, salvataggio tramite Invio e tramite pulsanti senza blur, assenza di salvataggio implicito, vincoli nativi e conservazione di testi e date. Il server e la cache sono temporanei, senza connessioni al backend.

Il runner non aggiunge dipendenze all'app: cerca Playwright locale o nel runtime Codex; un'altra installazione può essere indicata con `LULAB_PLAYWRIGHT_MODULE`. Il browser WebKit deve essere già disponibile. Il test browser è separato dalla suite Node, così non impone browser alle build GitHub esistenti.

WebKit desktop non riproduce la tastiera e il ciclo di vita della PWA iOS. Restano da provare su iPhone: separatore decimale della tastiera italiana, passaggio con Avanti/Fine fra i campi, tastiera in un bottom sheet e chiusura/annullamento di un modulo.
