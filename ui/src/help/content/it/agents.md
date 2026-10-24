# Agenti e MCP

Gli agenti AI (Claude Code, Codex, VS Code, WebStorm…) usano Micelio tramite **MCP** (*Model Context Protocol*), lo standard con cui un agente scopre e chiama strumenti esterni. Micelio non installa agenti suoi.

## Come si collega un agente {#mcp}

Il daemon espone un server MCP su `http://127.0.0.1:7337/mcp`, protetto dal token. `micelio setup claude-code` (o il pulsante in Impostazioni) lo registra a **livello utente** (con `claude mcp add`, trovato anche fuori dal PATH, oppure scrivendo direttamente `~/.claude.json`: vedi **Impostazioni**): da quel momento ogni sessione di Claude Code, in qualunque cartella, vede gli strumenti di Micelio. Per i client che usano MCP via processo c'è lo shim `micelio mcp`; `micelio setup codex|vscode|webstorm` stampa la configurazione da incollare.

Con più team, l'MCP di Claude Code sceglie il team dalla cartella del progetto: il team che l'ha abilitata, altrimenti il **team predefinito** (per le ricerche). Ogni risposta di `remember` dice in quale team è finito il ricordo. Vedi **Più team**.

## Il controllo del team di `remember` {#team-check}

Un ricordo salvato da un agente viene **pubblicato solo se la cartella della sessione è abilitata nel team su cui si salva**. Micelio la confronta ogni volta con le cartelle abilitate di tutti i team. Se non torna, il ricordo non viene pubblicato ma va nell'**Inbox**, con il problema e la soluzione proposta, e l'agente te lo dice. I casi sono tre:

- **la cartella è di un altro team** (per esempio una registrazione vecchia legata a un team): il ricordo va nell'Inbox del team della cartella, dove approvarlo lo pubblica lì;
- **la cartella non è abilitata in nessun team**: va nell'Inbox del team della sessione; abilita la cartella nel team giusto e pubblicalo lì con «Pubblica in…»;
- **la sessione non dice da quale cartella arriva** (registrazione HTTP vecchia o un client diverso dallo shim): stessa cosa, e la soluzione è «Configura» in Impostazioni → Claude Code e riaprire le sessioni.

**Come funziona dietro.** Lo shim `micelio mcp` manda a ogni richiesta la cartella della sessione (`CLAUDE_PROJECT_DIR`, altrimenti la cartella di lavoro) nell'intestazione `x-micelio-cwd`. Il daemon cerca il team con la cartella abilitata più specifica che la contiene, la stessa regola della raccolta delle sessioni. Il ricordo trattenuto passa comunque dal filtro e dalla classificazione: se è privato resta privato. Nato da un bug reale: una sessione aperta prima che la cartella fosse abilitata salvava nel team predefinito.

## La registrazione si aggiorna da sola {#migration}

Fino alla 0.5.0 Claude Code era collegato all'endpoint HTTP `/mcp`, che non dice la cartella. All'avvio il daemon cerca in `~/.claude.json` le registrazioni vecchie che puntano a lui (quella utente e quelle per cartella `/mcp/<team>`) e le sostituisce con lo shim, salvando prima una copia in `.claude.json.micelio-backup`. Le voci di altri server o di altri daemon non si toccano. Claude Code legge la registrazione solo all'avvio della sessione: quelle già aperte vanno chiuse e riaperte (anche con `/resume`). Impostazioni → Claude Code lo ricorda con un avviso.

## Gli strumenti {#tools}

| Strumento | Cosa fa |
|---|---|
| `recall` | ricerca ibrida nel sapere del team, con le **Radici pertinenti** in coda |
| `remember` | propone un ricordo (passa da filtro e classificazione) e risponde con il testo salvato |
| `architecture` | le Radici di un progetto, di una categoria o dei file toccati |
| `get` | un ricordo completo, con tutti i riferimenti al codice |
| `vote` | segnala un ricordo utile o fuorviante |
| `mark_root` | promuove un ricordo a Radice (solo su richiesta esplicita) |
| `fetch_source` | scarica l'originale di un ricordo nato da un documento |
| `inbox_review`, `inbox_decide` | mostra l'inbox e applica la decisione dell'utente |

## Le istruzioni {#instructions}

Il server manda all'agente delle **istruzioni**, che entrano nel suo contesto: cercare con `recall` all'inizio di un task non banale, chiamare `architecture` prima di toccare l'architettura, salvare solo su richiesta e solo sapere tecnico, mai dati personali o segreti, scrivere solo ciò che è stato detto o dimostrato. È l'agente a decidere quando usare gli strumenti: l'uso è consigliato, non forzato. Per forzarlo si possono usare gli hook di Claude Code (es. iniettare le Radici del progetto all'avvio della sessione).

## La raccolta automatica {#hook}

Separata da MCP: l'hook `SessionEnd` avvisa il daemon a fine sessione, e lo scanner raccoglie le sessioni lunghe. Vedi **Raccolta e distillazione**. Gli hook `SessionStart` e `UserPromptSubmit` invece portano il sapere all'agente senza che lo chieda: vedi **Contesto automatico**.

## Sicurezza {#security}

Il server MCP risponde solo su 127.0.0.1 e solo con il token. Le chiamate di Micelio a Claude girano con una variabile che le esclude dalla raccolta: una distillazione non viene a sua volta distillata.
