# Più team

Lo stesso PC può partecipare a più team: per esempio il team del tuo prodotto e quello di un cliente, o un team per ogni progetto. Ogni team ha un **sapere tutto suo**, che non si mescola con quello degli altri: un agente che lavora per il cliente A non trova i ricordi del cliente B, e viceversa.

## Cosa resta separato {#separation}

Ogni team ha la sua sottocartella `teams/<id>/` nella cartella del nodo, con:
- le **chiavi** del team (`state.json`), quindi una cifratura diversa;
- il **log** replicato (`corestore/`), che si sincronizza solo con i membri di quel team;
- l'**indice di ricerca**, l'**archivio privato** (inbox, registro), l'**export** Markdown;
- le **impostazioni**: cartelle abilitate, rete (anche DHT diverse) e dreaming.

Sulla rete i team non si possono collegare fra loro: ogni team si annuncia sulla DHT con una chiave di nodo diversa, quindi chi osserva la DHT non vede che due team hanno un PC in comune.

Sono invece **comuni** a tutti i team: la porta e il token dell'API locale, l'LLM (una sola coda di chiamate a Claude e un solo limite giornaliero, perché l'abbonamento è uno) e il modello di embedding.

## Passare da un team all'altro {#switch}

Il selettore **Team** in alto nella barra laterale sceglie su quale team lavorano le schermate. La scelta vale per questa finestra e si ricorda nel browser; non cambia nulla per gli altri programmi.

Il **team predefinito** (★ nella pagina Team) è quello che usano la riga di comando e gli agenti quando non indicano un team. Si cambia con «Rendi predefinito» o con `micelio teams default <team>`. Dalla riga di comando un altro team si indica con `micelio --team <id o nome> <comando>`.

## Aggiungere un team {#add}

«＋ Aggiungi un team…» nel selettore (o nella pagina Team) apre lo stesso modulo del primo avvio: si crea un team nuovo o si entra in uno esistente con un codice d'invito. Il nome è già quello della tua identità; puoi sceglierne un altro solo per il nuovo team. Da terminale: `micelio init <nome>` o `micelio join <codice>`, che si aggiungono ai team già presenti.

## La tua identità {#identity}

La prima volta che entri in un team nasce `identity.json`: il tuo nome e una coppia di chiavi personali. In ogni team il tuo nodo pubblica un evento `member.identity` con la chiave pubblica della persona e una **firma** sulla chiave del proprio feed in quel team. Tutti verificano la firma: nessuno può spacciarsi per te, né copiare l'evento da un altro team.

A cosa serve: se un collega è con te in due team, nella pagina Team accanto al suo nome compare «stessa persona anche in: …». Così distingui anche due colleghi con lo stesso nome. Chi è in un solo team con te vede solo una chiave e non sa in quali altri team sei.

La chiave segreta non lascia mai il PC: proteggi `identity.json` come `state.json`.

## A quale team vanno sessioni e documenti {#folders}

Le cartelle abilitate (Impostazioni) appartengono al team scelto quando le abiliti, e **una cartella appartiene a un solo team**:
- una sessione di Claude Code va al team della cartella **più specifica** che la contiene: con `C:\lavoro` nel team A e `C:\lavoro\clienteX` nel team B, le sessioni in `clienteX` vanno solo a B;
- la stessa cartella non si può abilitare in due team;
- le cartelle di documenti non possono nemmeno essere annidate fra team: la sorveglianza è ricorsiva e lo stesso file finirebbe in due team.

Una sessione in una cartella non abilitata in nessun team viene ignorata, come sempre.

## Gli agenti di un progetto {#agents}

L'MCP registrato con `micelio setup claude-code` (o con «Collega Claude Code» nelle Impostazioni) vale in tutte le cartelle e **sceglie il team dalla cartella in cui lavora Claude Code**: in una cartella abilitata di un team usa quel team; in una cartella che non è in nessun team non legge la memoria (vedi **Agenti e MCP**). Il team si sceglie a ogni richiesta, quindi vale anche per una cartella abilitata a sessione già aperta. Ogni risposta di `remember` dice in quale team è finito il ricordo, e un salvataggio da una cartella che non è del team non viene pubblicato ma va in Inbox (vedi **Agenti e MCP**).

**Come funziona:** Claude Code avvia `micelio mcp` (un piccolo processo su stdio) nella cartella del progetto. Il processo manda la cartella al daemon a ogni richiesta e il daemon la confronta con le cartelle abilitate dei team, come fa per la raccolta delle sessioni. Fino alla versione 0.5.0 l'MCP era registrato via HTTP e il daemon non sapeva in quale cartella lavorasse l'agente: un ricordo salvato in un progetto di un altro team finiva nel team predefinito. Dalla 0.6.1 il daemon aggiorna da solo le registrazioni vecchie all'avvio: riapri le sessioni di Claude Code che erano già aperte.

«Collega Claude Code» accanto a una cartella registra lo stesso shim solo per quella cartella, nell'ambito **local** di Claude Code (in `~/.claude.json`, non nel repository): serve se la registrazione utente manca o è di un'altra installazione. Non si può più forzare un team diverso da quello della cartella: dalla 0.6.1 conta sempre la cartella, ed è il controllo che impedisce di pubblicare nel team sbagliato. Per cambiare il team di un progetto, abilita la sua cartella nell'altro team.

## Togliere un team da questo PC {#leave}

«Togli da questo PC» (pagina Team) o `micelio teams leave <team> --yes` chiude il team e cancella la sua sottocartella: log, ricerca, inbox, registro e impostazioni locali. Il team continua a esistere sui PC dei colleghi, e i ricordi che hai pubblicato restano loro. Per rientrare serve un nuovo invito. Non si può annullare.

## Dalla versione con un solo team {#migration}

Prima i file del team stavano direttamente nella cartella del nodo. Al primo avvio della nuova versione vengono spostati in `teams/<id>/`, le impostazioni del team passano da `config.json` a `settings.json` e il nome del nodo diventa quello della tua identità. Il team diventa il predefinito: CLI, agenti e hook continuano a funzionare come prima.
