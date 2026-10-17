# Micelio — Piano di lavoro

> Documento vivo: viene aggiornato a ogni avanzamento. Il design di riferimento è [DESIGN.md](DESIGN.md).
> Ultimo aggiornamento: **2026-10-17** — Fase 0 completata, Fase 1 in attesa di approvazione.

## Stato

| Fase | Obiettivo | Stato |
|---|---|---|
| 0 — Spike | Ridurre i rischi tecnici | ✅ Completata |
| 1 — MVP | Brain condiviso minimo, usabile da Claude Code | ⏸️ In attesa di approvazione |
| 2 — Ingestione AI | Raccolta automatica con filtro privacy | ⬜ Da fare |
| 3 — Documenti | Cartelle sorvegliate (PDF, DOCX, XLSX…) | ⬜ Da fare |
| 4 — Priorità | Vettori, ricerca ibrida, attivazione | ⬜ Da fare |
| 5 — Dreaming | Consolidamento coordinato | ⬜ Da fare |
| 6 — Hardening | Offboarding, redazione, servizio di sistema | ⬜ Da fare |

---

## Fase 0 — Spike ✅

| Spike | Esito | Dettaglio |
|---|---|---|
| **A — P2P** ([spikes/a-p2p](../spikes/a-p2p)) | ✅ 6/6 scenari | 3+1 nodi Docker su DHT pubblica: scritture concorrenti, deduplica, founder offline, partizione, rientro di un nodo offline, **ingresso di un nuovo membro con chi l'ha invitato offline**. Convergenza in 1–2 s, circa 40 MB di RAM per nodo |
| **B — Claude CLI** ([spikes/b-claude-cli](../spikes/b-claude-cli)) | ✅ 5/5 | `claude -p` headless con `--json-schema`. Haiku classifica correttamente 5 casi su 5 (mail HR e credenziali di un cliente → `private`) in circa 5 s per caso. Sonnet distilla ricordi di buona qualità |
| **C — Embedding** ([spikes/c-embeddings](../spikes/c-embeddings)) | ✅ 4/4 | `multilingual-e5-small` locale: primo risultato corretto in 4 query su 4, anche tra italiano e inglese. 3,3 ms per passaggio, ma circa 620 MB di RAM con il modello caricato |

**Problemi trovati e risolti durante gli spike** (riportati in DESIGN.md):

1. Autobase: serve `base.replicate()` e non `store.replicate()`, altrimenti i nuovi writer non vengono scoperti.
2. Hyperswarm: senza refresh periodico della discovery i nodi restano isolati quando cade il peer "ponte".
3. Claude CLI su Windows: lanciarlo senza shell (quoting) e con lo schema in JSON Schema draft-07.
4. Distillazione: il prompt deve imporre la fedeltà alla fonte (il modello ha aggiunto un dettaglio non presente).

**Non verificato:** `codex exec`, per mancanza di un abbonamento. Lo verificheremo quando sarà disponibile; l'adapter resta pluggable.

---

## Decisioni da confermare prima della Fase 1

| # | Decisione | Proposta |
|---|---|---|
| D1 | Linguaggio | **TypeScript** (ESM, Node ≥ 22). Gli spike sono in JS, il prodotto in TS |
| D2 | Consegna della chiave di cifratura al nuovo membro | **Blind-pairing con un membro online qualsiasi.** Il codice d'invito non contiene la chiave di team: se trapela, non basta per leggere i dati. Costo: per entrare serve almeno un membro online, anche diverso da chi ha invitato |
| D3 | Indexer di Autobase | **3–5 indexer** (gli admin e i nodi più spesso accesi). Gli altri sono writer normali |
| D4 | Filtro privacy nell'MVP | Nell'MVP entra nel brain **solo ciò che si salva esplicitamente** (tool `remember` o comando CLI). Raccolta automatica e filtri arrivano in Fase 2 |
| D5 | Sistemi operativi | Windows prioritario (sviluppo e test). macOS e Linux supportati, testati via Docker/CI. **Da confermare: che OS usa il team?** |

---

## Fase 1 — MVP ⏸️

**Obiettivo:** due persone (o due macchine) condividono un brain. In Claude Code, sulla macchina A si salva un ricordo con `remember`; sulla macchina B Claude lo ritrova con `recall`.

| # | Attività | Stato |
|---|---|---|
| 1.1 | Setup del progetto: TypeScript, struttura `src/` (DESIGN §14), vitest, build | ⬜ |
| 1.2 | `core/`: schemi zod degli eventi (envelope, `memory.add`, `invite.*`, `member.*`, `team.config`), id content-addressed | ⬜ |
| 1.3 | `net/`: wrapper Autobase con `apply` deterministico, Hyperswarm con refresh della discovery, cifratura, politica degli indexer (D3) | ⬜ |
| 1.4 | Membership: `init` del team, `invite`, `join` con blocco optimistic + consegna della chiave (D2), `member.remove` riservato agli admin, albero degli inviti | ⬜ |
| 1.5 | `store/`: indice SQLite (better-sqlite3 + FTS5) derivato dalla vista Hyperbee, con aggiornamento incrementale tramite diff della vista e ricostruzione da zero | ⬜ |
| 1.6 | Daemon + CLI: `micelio init / invite / join / start / stop / status / remember / recall / members`, config in `~/.micelio` | ⬜ |
| 1.7 | `mcp/`: server MCP su HTTP locale (con token) + shim stdio; tool `remember`, `recall`, `get`; `micelio setup claude-code` | ⬜ |
| 1.8 | `export/`: vista Markdown in sola lettura | ⬜ |
| 1.9 | Test: unità (determinismo di `apply`), integrazione multi-nodo in-process su testnet DHT locale, scenario end-to-end Docker (riuso dello spike A) | ⬜ |

**Criterio di completamento:**
- il PC Windows e un nodo in container sono nello stesso team;
- un ricordo salvato da Claude Code su uno dei due compare nel `recall` dell'altro entro pochi secondi;
- lo scenario Docker dello spike A passa sul codice di prodotto.

---

## Fasi successive (dettaglio quando ci arriviamo)

- **Fase 2 — Ingestione AI:** hook `SessionEnd` di Claude Code, filtro deterministico (percorsi, parole chiave, dati personali, redazione dei segreti), classificazione Haiku, distillazione Sonnet, archivio privato + inbox, coda LLM con budget, anti-loop `MICELIO_INTERNAL`. Adapter Codex quando disponibile.
- **Fase 3 — Documenti:** watcher sulle cartelle, estrazione PDF/DOCX/XLSX/PPTX, elaborazione incrementale per hash.
- **Fase 4 — Priorità:** embedding in un worker caricato su richiesta, sqlite-vec, ricerca ibrida RRF, `usage.report`, attivazione, voti e pin, taratura delle soglie.
- **Fase 5 — Dreaming:** elezione per epoca, fasi di consolidamento, contraddizioni, collegamenti, decadimento, diario dei sogni, budget di chiamate.
- **Fase 6 — Hardening:** rotazione della chiave all'offboarding, redazione, `micelio setup` per Codex, VS Code e WebStorm, avvio come servizio di sistema, osservabilità.

---

## Registro

| Data | Evento |
|---|---|
| 2026-10-17 | Design v0.1 ([DESIGN.md](DESIGN.md)). Decisioni: nodi su internet, 10–30 nodi, LLM via CLI senza API, solo conoscenza distillata, ambiti private + team, lingua configurabile per team, inviti aperti a tutti con rimozione riservata agli admin, un progetto con persone diverse = un team separato |
| 2026-10-17 | Fase 0 completata: spike A, B e C superati. DESIGN.md aggiornato con le lezioni apprese. Piano della Fase 1 pronto per l'approvazione |
