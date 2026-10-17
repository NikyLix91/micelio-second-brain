# Server MCP

Il daemon espone un server MCP su **Streamable HTTP**:

- URL: `http://127.0.0.1:7337/mcp` (porta configurabile in `~/.micelio/config.json`)
- Autenticazione: header `Authorization: Bearer <token>`, con il token preso da `~/.micelio/config.json`
- Modalità **stateless**: ogni richiesta è indipendente, senza sessioni né stream SSE

Il server invia agli agenti delle **istruzioni**: cercare con `recall` prima dei task non banali, salvare con `remember` solo conoscenza tecnica riutilizzabile, mai dati personali, HR, credenziali o dati di clienti.

## Tool

| Tool | Parametri | Effetto |
|---|---|---|
| `recall` | `query` (parole chiave), `limit?` (1–20, default 5) | Ricerca full-text nella memoria del team, ordinata per rilevanza (BM25: il titolo pesa più dei tag, i tag più del corpo). Ignora gli accenti e accetta prefissi. Sola lettura |
| `remember` | `title`, `body` (Markdown), `kind?`, `tags?` | Salva un ricordo nel team. Se identico a uno esistente risponde "Già presente". Errore leggibile se i dati non sono validi |
| `get` | `id` (anche abbreviato, min 6 caratteri) | Ricordo completo. Sola lettura |

Nella Fase 5 `recall` diventerà ibrido (full-text + semantico) e terrà conto della priorità (attivazione).

## Configurazione dei client

### Claude Code

```bash
micelio setup claude-code          # esegue `claude mcp add` in ambito utente
micelio setup claude-code --print  # mostra solo il comando
```

Il comando eseguito è:

```bash
claude mcp add --transport http --scope user micelio http://127.0.0.1:7337/mcp \
  --header "Authorization: Bearer <token>"
```

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
