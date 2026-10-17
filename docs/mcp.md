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
| `get` | `id` (anche abbreviato, min 6 caratteri) | Ricordo completo. Sola lettura |
| `vote` | `id`, `useful` (true/false) | Segnala se un ricordo è stato utile o è fuorviante/obsoleto. I voti alzano o abbassano l'attivazione del ricordo per tutto il team |
| `fetch_source` | `id` del ricordo | Per un ricordo distillato da un documento, scarica l'**originale** dal collega che lo possiede (deve essere online e condividere la cartella). Restituisce il percorso locale e il testo estratto (primi 20.000 caratteri) |
| `inbox_review` | nessuno | Elenca i ricordi dubbi in attesa di decisione nell'inbox locale dell'utente. Sola lettura |
| `inbox_decide` | `id`, `decision` (`approve` \| `reject`), `title?`, `body?` | Approva (pubblica, eventualmente correggendo) o rifiuta. Va usato **solo dopo una decisione esplicita dell'utente** |

Dalla Fase 5 `recall` è una **ricerca ibrida**:
- unisce parole chiave (BM25) e significato (embedding locali, multilingue: una domanda in inglese trova ricordi in italiano);
- fonde le due classifiche con la Reciprocal Rank Fusion;
- a parità di pertinenza premia i ricordi con attivazione più alta, cioè usati di recente, votati utili, molto collegati o fissati.

Ogni risultato restituito conta come un "uso" del ricordo.

## Configurazione dei client

### Claude Code

```bash
micelio setup claude-code            # MCP (ambito utente) + hook di fine sessione
micelio setup claude-code --no-hook  # solo MCP
micelio setup claude-code --print    # mostra cosa farebbe, senza modificare nulla
```

Il comando esegue `claude mcp add --transport http --scope user micelio http://127.0.0.1:7337/mcp --header "Authorization: Bearer <token>"`. Poi, salvo `--no-hook`, aggiunge a `~/.claude/settings.json` (rispettando `CLAUDE_CONFIG_DIR`) un hook `SessionEnd` che avvisa il daemon a ogni fine sessione. Il file originale viene salvato in `settings.json.micelio-backup`. Rieseguire il comando è sicuro: sostituisce la configurazione precedente invece di duplicarla.

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
