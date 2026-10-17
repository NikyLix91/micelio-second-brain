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
| `inbox_review` | nessuno | Elenca i ricordi dubbi in attesa di decisione nell'inbox locale dell'utente. Sola lettura |
| `inbox_decide` | `id`, `decision` (`approve` \| `reject`), `title?`, `body?` | Approva (pubblica, eventualmente correggendo) o rifiuta. Va usato **solo dopo una decisione esplicita dell'utente** |

Nella Fase 5 `recall` diventerà ibrido (full-text + semantico) e terrà conto della priorità (attivazione).

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

`micelio setup` per questi client è previsto in Fase 7. Nel frattempo, ogni client che supporta MCP su HTTP si configura a mano con lo stesso URL e lo stesso header.

## Sicurezza

- Il daemon ascolta solo su `127.0.0.1`, salvo `MICELIO_HOST` (es. nei container).
- Senza token valido tutte le rotte rispondono `401`, tranne `/api/health`.
- L'header di autenticazione impedisce anche a una pagina web aperta nel browser di usare il daemon locale.
- Chi possiede il token può leggere e scrivere la memoria del team **da quella macchina**: il file `config.json` va protetto come una credenziale.
