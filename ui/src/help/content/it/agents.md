# Agenti e MCP

Gli agenti AI (Claude Code, Codex, VS Code, WebStorm…) usano Micelio tramite **MCP** (*Model Context Protocol*), lo standard con cui un agente scopre e chiama strumenti esterni. Micelio non installa agenti suoi.

## Come si collega un agente {#mcp}

Il daemon espone un server MCP su `http://127.0.0.1:7337/mcp`, protetto dal token. `micelio setup claude-code` (o il pulsante in Impostazioni) lo registra con `claude mcp add` a **livello utente**: da quel momento ogni sessione di Claude Code, in qualunque cartella, vede gli strumenti di Micelio. Per i client che usano MCP via processo c'è lo shim `micelio mcp`; `micelio setup codex|vscode|webstorm` stampa la configurazione da incollare.

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

Separata da MCP: l'hook `SessionEnd` avvisa il daemon a fine sessione, e lo scanner raccoglie le sessioni lunghe. Vedi **Raccolta e distillazione**.

## Sicurezza {#security}

Il server MCP risponde solo su 127.0.0.1 e solo con il token. Le chiamate di Micelio a Claude girano con una variabile che le esclude dalla raccolta: una distillazione non viene a sua volta distillata.
