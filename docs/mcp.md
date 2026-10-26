# Server MCP

Il daemon espone un server MCP su **Streamable HTTP**:

- URL: `http://127.0.0.1:7337/mcp` (porta configurabile in `~/.micelio/config.json`)
- Autenticazione: header `Authorization: Bearer <token>`, con il token preso da `~/.micelio/config.json`
- Modalità **stateless**: ogni richiesta è indipendente, senza sessioni né stream SSE

Il server invia agli agenti delle **istruzioni**:
- cercare con `recall` prima dei task non banali;
- salvare con `remember` solo su richiesta dell'utente, solo conoscenza tecnica riutilizzabile e **senza aggiungere dettagli** non detti;
- mostrare all'utente il testo salvato;
- mai salvare dati personali, HR, credenziali o dati di clienti.

## Tool

| Tool | Parametri | Effetto |
|---|---|---|
| `recall` | `query` (parole chiave), `limit?` (1–20, default 5) | Ricerca full-text nella memoria del team, ordinata per rilevanza (BM25: il titolo pesa più dei tag, i tag più del corpo). Ignora gli accenti e accetta prefissi. Sola lettura |
| `remember` | `title`, `body` (Markdown), `kind?`, `tags?` | **Propone** un ricordo. Passa dal filtro privacy e dalla classificazione, poi risponde con l'esito: *Pubblicato* (con il testo esatto salvato), *in inbox* (con l'id e il motivo) o *trattenuto come privato* (con il motivo) |
| `get` | `id` (anche abbreviato, min 6 caratteri) | Ricordo completo, con tutti i riferimenti al codice (progetto, branch, file, simboli, commit). Sola lettura |
| `architecture` | `project?`, `category?`, `files?`, `query?` | Le **Radici** (sapere fondante): per progetto (nome della cartella del repository), categoria, file che si stanno toccando (vale anche la cartella), o ordinate per pertinenza. Senza Radici di progetto restituisce quelle generali del team. Le Radici "da rivedere" sono segnalate con i motivi. Sola lettura |
| `mark_root` | `id`, `category` | Promuove un ricordo a Radice. Solo su richiesta esplicita dell'utente |
| `vote` | `id`, `useful` (true/false) | Segnala se un ricordo è stato utile o è fuorviante/obsoleto. I voti alzano o abbassano l'attivazione del ricordo per tutto il team |
| `fetch_source` | `id` del ricordo | Per un ricordo distillato da un documento, scarica l'**originale** dal collega che lo possiede (deve essere online e condividere la cartella). Restituisce il percorso locale e il testo estratto (primi 20.000 caratteri) |
| `inbox_review` | nessuno | Elenca i ricordi dubbi in attesa di decisione nell'inbox locale dell'utente. Sola lettura |
| `inbox_decide` | `id`, `decision` (`approve` \| `reject`), `title?`, `body?` | Approva (pubblica, eventualmente correggendo) o rifiuta. Va usato **solo dopo una decisione esplicita dell'utente** |

Dalla Fase 5 `recall` è una **ricerca ibrida**:
- unisce parole chiave (BM25) e significato (embedding locali, multilingue: una domanda in inglese trova ricordi in italiano);
- fonde le due classifiche con la Reciprocal Rank Fusion;
- a parità di pertinenza premia i ricordi con attivazione più alta, cioè usati di recente, votati utili, molto collegati o fissati.

Ogni risultato restituito conta come un "uso" del ricordo.

**Radici (Fase 8).** In coda ai risultati di `recall` arrivano fino a 3 **Radici pertinenti** che non sono già fra i risultati, nella sezione «RADICI PERTINENTI». Così il sapere fondante raggiunge l'agente anche quando la domanda non lo nomina. Le istruzioni del server chiedono all'agente di chiamare `architecture` prima di progettare o modificare una parte dell'architettura.

## Configurazione dei client

### Claude Code

```bash
micelio setup claude-code            # MCP (ambito utente) + hook di fine sessione
micelio setup claude-code --no-hook  # solo MCP
micelio setup claude-code --print    # mostra cosa farebbe, senza modificare nulla
```

Il comando registra lo shim stdio: `claude mcp add --scope user micelio -- <node> <dist/cli/main.js> --home <home> mcp` (dalla 0.5.1; prima era l'endpoint HTTP). `claude` si cerca anche fuori dal PATH: installazione nativa, npm (si lancia il suo `cli.js` con il Node di Micelio), WinGet, estensione di VS Code, Cursor e Windsurf. Se non si trova, la stessa voce si scrive direttamente in `~/.claude.json` (`mcpServers.micelio`, copia in `.claude.json.micelio-backup`). Se Claude Code non risulta mai usato dall'utente del sistema che esegue Micelio, il comando avvisa: Claude Code legge la configurazione dal profilo di chi lo esegue (dalla 0.5.3). Poi, salvo `--no-hook`, aggiunge a `~/.claude/settings.json` (rispettando `CLAUDE_CONFIG_DIR`) un hook `SessionEnd` che avvisa il daemon a ogni fine sessione. Il file originale viene salvato in `settings.json.micelio-backup`. Rieseguire il comando è sicuro: sostituisce la configurazione precedente invece di duplicarla.

Per un uso temporaneo, senza modificare la configurazione:

```bash
claude --mcp-config '{"mcpServers":{"micelio":{"type":"http","url":"http://127.0.0.1:7337/mcp","headers":{"Authorization":"Bearer <token>"}}}}'
```

### Altri client (Codex CLI, VS Code, WebStorm)

Per i client che lanciano i server MCP come **processo** (stdio), Micelio ha uno shim: `micelio mcp`. Espone su stdio gli stessi tool del daemon e inoltra ogni richiesta all'endpoint HTTP locale, quindi il daemon deve essere attivo.

`micelio setup` stampa la configurazione già pronta, con i percorsi della tua macchina, da incollare nel client:

```bash
micelio setup codex      # blocco per ~/.codex/config.toml
micelio setup vscode     # blocco per .vscode/mcp.json o impostazioni utente
micelio setup webstorm   # JSON per AI Assistant → Model Context Protocol (anche altri IDE JetBrains)
```

Per questi client Micelio non modifica i file di configurazione: i loro formati cambiano spesso fra una versione e l'altra. Lo shim è verificato con un client MCP stdio reale. Le tre configurazioni seguono i formati documentati dai rispettivi client, ma non sono state provate dentro Codex, VS Code e WebStorm, che non erano disponibili.

I client che supportano MCP su HTTP possono anche collegarsi direttamente all'URL del daemon con l'header del token.

## Sicurezza

- Il daemon ascolta solo su `127.0.0.1`, salvo `MICELIO_HOST` (es. nei container).
- Senza token valido tutte le rotte rispondono `401`, tranne `/api/health`.
- L'header di autenticazione impedisce anche a una pagina web aperta nel browser di usare il daemon locale.
- Chi possiede il token può leggere e scrivere la memoria del team **da quella macchina**: il file `config.json` va protetto come una credenziale.

## Più team sullo stesso PC

Con più team (vedi [guida utente](guida-utente.md#4-ter-più-team-sullo-stesso-pc)):

- `micelio mcp` (lo shim su stdio, registrato da `micelio setup claude-code` e da «Collega Claude Code») manda al daemon la cartella del progetto (`CLAUDE_PROJECT_DIR`, altrimenti la cartella di lavoro) nell'intestazione `x-micelio-cwd`, a ogni richiesta. Il daemon usa il team che ha abilitato quella cartella (la più specifica). Fino alla 0.5.0 l'MCP utente era registrato via HTTP e lavorava sempre sul predefinito: ricordi di un progetto di un altro team finivano nel team sbagliato (bug del 2026-10-21);
- `http://127.0.0.1:7337/mcp` da una cartella che non è in nessun team, o senza l'intestazione, **non legge la memoria** (dalla 0.6.2): gli strumenti di lettura rispondono con la spiegazione e `remember` mette il ricordo nell'Inbox del team predefinito. È una protezione contro i repository non fidati che spingono l'agente a leggere la memoria e a mandarla fuori;
- `http://127.0.0.1:7337/mcp/<team>` lavora sul team indicato, per id locale o per nome.

**Controllo del team di `remember` (0.6.1).** Un ricordo salvato da un agente viene pubblicato solo se la cartella della sessione è abilitata nel team su cui si salva. Altrimenti va nell'Inbox con il problema e la soluzione, e la risposta lo dice:

| Caso | Dove va | Soluzione |
|---|---|---|
| La cartella è abilitata in un altro team (`/mcp/<team>` o `--team` vecchi) | Inbox del team della cartella | Approvarlo lo pubblica lì |
| La cartella non è abilitata in nessun team | Inbox del team della sessione | Abilitarla nel team giusto, poi «Pubblica in…» |
| Nessuna cartella (endpoint HTTP senza `x-micelio-cwd`) | Inbox del team della sessione | Registrare lo shim («Configura») e riaprire le sessioni |

Lo shim manda la cartella anche con `--team`. Il ricordo trattenuto passa comunque dal filtro e dalla classificazione. «Pubblica in…» corrisponde a `POST /api/inbox/:id/move` con `{ team, publish }`. Il codice è in `src/core/team-check.ts` e `MicelioHost.rememberFromAgent`.

**Migrazione automatica (0.6.1).** All'avvio, `micelio daemon` sostituisce in `~/.claude.json` le registrazioni HTTP che puntano a lui (quella utente e quelle per progetto `/mcp/<team>`) con lo shim, salvando prima `.claude.json.micelio-backup`. Le voci di altri server o di daemon su altre porte restano com'erano. `GET /api/setup/claude-code` dice com'è collegato Claude Code (`shim`, `legacy`, `missing`) e se c'è stata una migrazione: le Impostazioni lo usano per ricordare di riaprire le sessioni.

`micelio setup claude-code --project <cartella>` (e «Collega Claude Code» accanto a una cartella) registra lo stesso shim nell'ambito *local* di quella cartella. Non fissa più un team: decide la cartella.

Per i client che usano lo shim: `micelio --team <team> setup codex|vscode|webstorm` stampa una configurazione che passa `--team` allo shim; anche lì `remember` controlla la cartella.

## Ricordi personali, codice cambiato, contesto automatico (B4)

- `remember` accetta `personal: true`: il ricordo resta solo sul PC dell'utente (l'agente lo usa quando l'utente chiede di ricordare qualcosa «per sé»).
- Nei risultati di `recall` e `get` un ricordo personale è marcato `PERSONALE`, uno con il codice citato cambiato dopo la scrittura `⚠ CODICE CAMBIATO` (con il numero di commit e di file spariti): le istruzioni del server chiedono all'agente di verificare sul codice attuale.
- Il contesto automatico non passa da MCP: sono gli hook `SessionStart` e `UserPromptSubmit` di Claude Code (`micelio hook session-start` / `prompt`) a chiedere il contesto al daemon (`POST /api/context`) e a restituirlo come `additionalContext`. Vedi la voce «Contesto automatico» della guida in linea.
