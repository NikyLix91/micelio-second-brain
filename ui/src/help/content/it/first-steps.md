# Primi passi

Il percorso per far lavorare Claude Code con la memoria del team: quattro passi, ognuno con il pulsante che lo fa e un controllo che lo spunta da solo. Si apre da solo dopo la creazione del team o l'ingresso con un invito; si ritrova nella barra laterale finché non è completo, poi qui nella Guida.

**Cosa ti serve prima:** Claude Code installato e con l'accesso fatto, sullo stesso PC e con lo stesso utente con cui usi Micelio. Micelio usa il tuo abbonamento a Claude: nessuna chiave API.

## 1. Claude Code su questo PC {#claude}

Micelio è la memoria; chi la usa è Claude Code. Il passo è fatto quando Micelio trova il programma `claude` **e** vede che questo utente del PC l'ha già aperto almeno una volta.

- **Non trovato**: installa Claude Code dalla [pagina ufficiale](https://code.claude.com/docs/en/setup), aprilo una volta, fai l'accesso, poi premi «Ricontrolla». Micelio lo cerca nel PATH, nelle installazioni note (nativa, npm, WinGet) e nelle estensioni di VS Code, Cursor e Windsurf.
- **Trovato ma mai usato da questo utente**: capita quando Claude Code si usa con un altro utente di Windows, per esempio un account amministratore. Claude Code legge la configurazione dal profilo di chi lo avvia: se lo avvii con un altro utente, non vedrà mai Micelio. Usa Micelio e Claude Code con lo stesso utente.

## 2. Collega Claude Code {#connect}

«Collega Claude Code» fa tre cose, per tutti i progetti di questo utente:
- registra Micelio fra gli strumenti di Claude Code (**server MCP**): così l'agente può cercare nella memoria e salvare;
- aggiunge gli **hook** che portano il sapere del team all'inizio di ogni sessione e a ogni richiesta (**contesto automatico**);
- aggiunge l'hook di fine sessione per la **raccolta automatica** delle sessioni lunghe.

Prima di toccare la configurazione di Claude Code ne salva una copia. È lo stesso pulsante di **Impostazioni → Claude Code**.

**Dopo il clic** chiudi e riapri le sessioni di Claude Code già aperte (in VS Code: ricarica la finestra). Claude Code legge i suoi strumenti solo all'avvio della sessione.

## 3. Scegli le cartelle dei progetti {#folders}

Claude Code usa la memoria del team **solo nelle cartelle che abiliti**, comprese le sottocartelle. Abilita la cartella di ogni progetto su cui lavori con il team: per esempio `C:\SourceCode\nome-progetto`, oppure la cartella che le contiene tutte.

**Perché serve.** Da una cartella che non è di nessun team, Claude Code non legge niente da Micelio: un repository non fidato, clonato da internet, potrebbe contenere istruzioni scritte per far cercare all'agente nella memoria e mandarla fuori. E un ricordo salvato da lì non viene pubblicato: finisce nell'Inbox.

Le stesse cartelle valgono per la **raccolta automatica**: solo le sessioni fatte lì vengono lette, filtrate e distillate. Si cambiano in **Impostazioni → Raccolta automatica**. Con più team, ogni cartella appartiene a un solo team: Claude Code usa il team che la possiede.

## 4. Prova che funziona {#try}

Apri Claude Code in una delle cartelle abilitate:
- **da terminale**: entra nella cartella del progetto e avvia `claude`;
- **in VS Code**: apri la cartella e avvia una sessione nuova di Claude Code.

Poi scrivi, per esempio: *«Cerca in Micelio cosa sa il team di questo progetto»*. Il passo si spunta da solo appena Micelio riceve la chiamata, e dice da quale cartella è arrivata. Con un team nuovo la memoria è vuota: la risposta sarà che non c'è ancora niente, ed è normale.

Se la chiamata arriva da una cartella sbagliata, la pagina lo dice:
- **cartella in nessun team**: abilitala al passo 3, oppure apri Claude Code in una cartella già abilitata;
- **cartella di un altro team** di questo PC: apri Claude Code in una cartella di questo team;
- **nessuna cartella**: è la registrazione vecchia, ripeti il passo 2 e riapri la sessione.

**Non arriva niente?** La sessione deve essere stata aperta **dopo** il passo 2. In Claude Code scrivi `/mcp`: «micelio» deve risultare collegato. Se risulta in errore, controlla che Micelio sia acceso (l'icona nell'area di notifica).

## Poi {#next}

- **Salva il primo ricordo**: chiedi all'agente *«ricorda che …»* con una decisione o una soluzione del progetto; lo trovi nella pagina **Memoria**.
- **Cartelle di documenti** (PDF, Office, Markdown): **Impostazioni → Cartelle di documenti**.
- **Invita un collega**: **Team → Invita un collega**.

## Come funziona dietro {#behind}

La pagina chiede ogni 3 secondi al daemon lo stato dei passi (`GET /api/setup/first-steps`): dove ha trovato `claude`, se il profilo dell'utente contiene tracce di Claude Code, com'è registrato Micelio in `~/.claude.json`, le cartelle abilitate del team. Per il passo 4 il daemon annota l'ultima chiamata MCP ricevuta e la cartella da cui arriva, mandata dal ponte `micelio mcp` che Claude Code avvia. L'annotazione resta solo in memoria e non lascia il PC. Lo stato «percorso aperto / finito» è salvato in questa app, per ogni team.
