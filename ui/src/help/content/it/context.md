# Contesto automatico

Un agente usa Micelio solo se decide di chiamare `recall`, e spesso non lo fa. Con il contesto automatico è Micelio a inserire nella conversazione il sapere utile, al momento giusto, senza aspettare l'agente.

## Come funziona {#how}

`micelio setup claude-code` (o «Configura» nelle Impostazioni) installa due **hook** di Claude Code accanto a quello di fine sessione:
- `SessionStart`: all'avvio di una sessione Claude Code esegue `micelio hook session-start`;
- `UserPromptSubmit`: a ogni richiesta dell'utente esegue `micelio hook prompt`.

Il comando chiede il contesto al daemon (`POST /api/context`, con la cartella di lavoro e, per le richieste, il testo) e lo restituisce a Claude Code come `additionalContext`: l'agente lo legge come parte della conversazione. Il team è quello della **cartella** di lavoro (vedi **Più team**). Una cartella che non è in nessun team non riceve contesto: è una protezione contro i repository non fidati (vedi **Agenti e MCP**).

## A inizio sessione {#session-start}

Il progetto è il repository in cui parte la sessione (o il nome della cartella). Arrivano:
- le **Radici** del progetto, più quelle generali (best practice e policy senza progetto);
- i **ricordi più vivi** del progetto (attivazione più alta).

Ogni voce è una riga: tipo o categoria, titolo, prima riga del testo e id. Per il testo completo l'agente usa il tool MCP `get`.

## A ogni richiesta {#prompt}

Micelio confronta il **significato** della richiesta con i ricordi e le Radici (vettori locali) e inserisce solo ciò che supera una soglia di pertinenza **più alta di quella della ricerca** (meglio nessun contesto che uno fuori tema): le sole parole chiave su una frase libera troverebbero troppo rumore. Richieste brevissime («ok», «grazie») non producono nulla, e ciò che è già stato mostrato nella stessa sessione non si ripete. Questi inserimenti non contano come «uso» del ricordo.

## Impostazioni {#settings}

Nella scheda «Contesto automatico» delle Impostazioni: inizio sessione sì/no, richieste sì/no, caratteri massimi per inserimento (default 4000). Valgono per tutta la macchina, perché gli hook sono dell'utente. Per toglierli del tutto: `micelio setup claude-code --no-context`.

## Privacy {#privacy}

Tutto avviene sul PC: il testo delle richieste va solo al daemon locale, non viene salvato e non entra nel log del team. I ricordi inseriti sono quelli che l'utente vede già (team e personali), con i segreti già redatti. Se il daemon è spento o lento, l'hook non inserisce nulla e Claude Code prosegue normalmente.
