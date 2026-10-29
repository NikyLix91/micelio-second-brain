# Aggiornamenti

Dalla versione 0.8.0 l'app desktop si aggiorna da sola: trova la versione nuova, la scarica, controlla che sia davvero nostra e la installa quando glielo chiedi tu. La scheda è in **Impostazioni → Aggiornamenti**; nel browser non c'è, perché l'aggiornamento riguarda l'app installata sul PC.

## Come funziona {#how}

1. **Controllo.** 30 secondi dopo l'avvio e poi ogni 4 ore l'app guarda l'ultima versione pubblicata su GitHub, nella pagina delle release del progetto. Non serve un account: il progetto è pubblico. «Controlla ora» lo fa subito.
2. **Download.** Se c'è una versione più nuova la scarica in background; la scheda mostra l'avanzamento.
3. **Verifica.** Prima di considerarla pronta controlla la **firma** (vedi sotto). Se la firma manca o non torna, cancella il file e non installa nulla.
4. **Avviso.** Una notifica e una voce in cima al menu dell'icona («Riavvia e aggiorna a…») dicono che è pronta.
5. **Installazione.** Solo quando scegli **Riavvia e aggiorna**: mai a sorpresa, nemmeno quando chiudi l'app.

Le versioni di prova (per esempio `0.9.0-rc.1`) non arrivano a chi usa una versione normale.

## Riavvia e aggiorna {#install}

Micelio chiude il daemon in modo ordinato e si chiude; l'installer sostituisce i programmi **senza finestre** e alla fine riapre l'app, che avvia il daemon nuovo. Ci vuole **qualche minuto** su Windows (circa 5: sono migliaia di file e l'antivirus li controlla uno per uno), pochi secondi con l'AppImage: non riaprire Micelio a mano nel frattempo. I colleghi non perdono nulla: quello che scrivono intanto ti arriva appena il nodo riparte.

I tuoi **dati non si toccano**: ricordi, team, chiavi e impostazioni stanno in `~/.micelio`, fuori dalla cartella dei programmi. Anche le impostazioni dell'app (come questa scheda) restano.

Le sessioni di Claude Code già aperte: gli hook continuano a funzionare, ma il collegamento al server MCP di Micelio si interrompe, perché l'installer deve chiudere tutti i programmi della sua cartella. Ricollegalo con `/mcp` (oppure chiudi e riapri la sessione; `/resume` riprende la conversazione).

## La firma {#signature}

**Perché.** Il file scaricato arriva da GitHub. Controllarne solo l'impronta scritta accanto (`latest.yml`) protegge da un download rotto, non da chi riuscisse a cambiare i file di una versione: cambierebbe anche l'impronta. Per questo ogni pacchetto ha una **firma Ed25519 nostra**, in un file `.sig` accanto al pacchetto.

**Come funziona dietro.**
- La firma la fa il processo che costruisce le versioni su GitHub (il workflow di release), con una **chiave privata** che esiste solo in un segreto di GitHub, usabile soltanto quando si pubblica una versione, e in una copia di riserva dell'autore. Non è sul PC di nessuno e non è nel codice.
- La **chiave pubblica** è dentro l'app: con quella l'app verifica, e nessuno può firmare al posto nostro senza la privata.
- La firma copre il nome del pacchetto, la versione e la sua impronta SHA-256: non si può spacciare un pacchetto vecchio (firmato davvero) per una versione nuova, né cambiare un solo byte del file.
- La verifica si ripete subito prima dell'installazione, perché il file resta sul disco anche per ore.

Se la scheda dice che la firma non è valida, l'aggiornamento è già stato cancellato: non c'è niente da fare se non segnalarlo.

## Linux {#linux}

- **AppImage**: si aggiorna come su Windows; il file AppImage viene sostituito con quello nuovo.
- **Pacchetto .deb**: l'app avvisa che c'è una versione nuova e apre la pagina per scaricarla. Installare un .deb richiede la password di amministratore, quindi lo fa il gestore dei pacchetti (`sudo apt install ./micelio_<versione>_amd64.deb`), non l'app.

## Controllo automatico spento {#off}

Togli la spunta a «Controlla gli aggiornamenti da solo» per non far contattare GitHub all'app: per esempio su una rete che lo vieta. Resta «Controlla ora». La scelta vale per questo PC e resta dopo gli aggiornamenti.

## Se qualcosa non va {#trouble}

- **«Non riesco a raggiungere GitHub»**: niente rete o un proxy che blocca `github.com`. Riprova da sola dopo 4 ore.
- **Le versioni prima della 0.8.0** non sanno aggiornarsi: la 0.8.0 va installata a mano, poi il resto è automatico.
- **Aggiornare a mano** funziona sempre: scarica l'installer dalla pagina delle release e lancialo sopra l'installazione esistente.
- Il registro `updates.log` dice cosa è successo a ogni controllo: su Windows è in `%APPDATA%\@micelio\desktop\logs`, su Linux in `~/.config/@micelio/desktop/logs`.
