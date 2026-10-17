# Micelio — Piano di lavoro

> Documento vivo: viene aggiornato a ogni avanzamento. Design di riferimento: [DESIGN.md](DESIGN.md). Indice della documentazione: [README.md](README.md).
> Ultimo aggiornamento: **2026-10-17**. Fase 1 completata, Fase 2 in attesa di approvazione.

## Stato

| Fase | Obiettivo | Stato |
|---|---|---|
| 0 — Spike | Ridurre i rischi tecnici | ✅ Completata |
| 1 — MVP | Brain condiviso minimo, usabile da Claude Code | ✅ Completata |
| 2 — Ingestione AI | Raccolta automatica con filtro privacy | ⏸️ In attesa di approvazione |
| 3 — Documenti | Cartelle sorvegliate (PDF, DOCX, XLSX…) | ⬜ Da fare |
| 4 — Priorità | Vettori, ricerca ibrida, attivazione | ⬜ Da fare |
| 5 — Dreaming | Consolidamento coordinato | ⬜ Da fare |
| 6 — Hardening | Offboarding, redazione, servizio di sistema, altri client | ⬜ Da fare |

---

## Decisioni prese

| # | Decisione | Esito |
|---|---|---|
| D1 | Linguaggio | TypeScript. Le parti web/HTTP usano **NestJS** |
| D2 | Consegna della chiave al nuovo membro | Blind-pairing con un membro online qualsiasi: il codice d'invito non contiene la chiave |
| D3 | Indexer | Gli admin sono gli indexer. Consigliati 2–3 admin |
| D4 | Cosa entra nell'MVP | Solo i salvataggi espliciti. "Come gestire l'esplicito" si definisce in Fase 2 (vedi D6) |
| D5 | Sistemi operativi | Tutti. Sviluppo su Windows, Linux verificato in Docker, macOS non ancora provato |

---

## Fase 0 — Spike ✅

Resoconto completo: [spike-fase-0.md](spike-fase-0.md). In sintesi: P2P 6/6 scenari, Claude CLI 5/5 classificazioni, embedding locali 4/4 query. Codex non è verificato (nessun abbonamento).

---

## Fase 1 — MVP ✅

| # | Attività | Stato |
|---|---|---|
| 1.1 | Setup del progetto: TypeScript 5.9, vitest + SWC, build | ✅ |
| 1.2 | `core/`: schemi zod degli eventi, id content-addressed | ✅ |
| 1.3 | `net/`: Autobase + Hyperswarm (refresh della discovery, wakeup), cifratura, admin = indexer | ✅ |
| 1.4 | Membership: init, invito blind-pairing (chi ha invitato può essere offline), espulsione e promozione solo admin, albero degli inviti | ✅ |
| 1.5 | `store/`: indice FTS5 su `node:sqlite` derivato dalla vista | ✅ |
| 1.6 | Daemon NestJS + CLI `micelio` | ✅ |
| 1.7 | MCP Streamable HTTP (`recall`, `remember`, `get`) + `micelio setup claude-code` | ✅ |
| 1.8 | Export Markdown in sola lettura | ✅ |
| 1.9 | Test: 25 di unità e integrazione + scenario Docker end-to-end (11 controlli) | ✅ |
| 1.10 | Documentazione: README, guida utente, guida per sviluppatori, MCP | ✅ |

**Criterio di completamento: raggiunto.**
- Un nodo sul PC Windows è entrato nel team di un nodo in container via DHT pubblica (14 s).
- Claude Code reale ha trovato con `recall` un ricordo scritto dal container.
- Claude Code ha salvato con `remember` una decisione, che il container ha visto subito.

**Problemi emersi e risolti durante la fase:**
1. Un invito creato da un nodo che va subito offline non è verificabile dagli altri. Ora `invite` attende che almeno un peer l'abbia ricevuto, altrimenti avvisa.
2. Con eventi concorrenti un'azione da admin emessa da un non-admin poteva diventare valida. Ora il nodo la rifiuta già in partenza (DESIGN §9).
3. Su Windows `SIGTERM` uccide il processo senza chiusura ordinata. Ora lo shutdown passa da un segnale interno.
4. L'albero degli inviti attribuiva l'invito a chi aveva accolto la richiesta. Ora lo attribuisce a chi l'ha creato.

**Osservazione importante per la Fase 2:** quando Claude salva un ricordo con `remember`, scrive lui il testo e **aggiunge dettagli non detti dall'utente** (visto anche nello spike B). Va affrontato insieme alla decisione D6.

**Non verificato:** `npm link` su macOS/Linux e il comando `micelio setup claude-code` sulla configurazione reale. Per non modificare la tua configurazione l'ho provato con un `--mcp-config` temporaneo.

---

## Fase 2 — Ingestione AI ⏸️ (proposta, da approvare)

**Obiettivo:** il sapere entra anche senza `remember` esplicito, dalle sessioni di Claude Code, e **niente di personale o sensibile arriva al team**. Riferimenti: DESIGN §6–7.

### Decisioni da prendere

| # | Domanda | Proposta |
|---|---|---|
| D6 | Come trattare i salvataggi espliciti (`remember`) | Passano **anche loro** dal filtro deterministico e dalla classificazione. Se sono puliti vanno al team, altrimenti in inbox. Il tool risponde mostrando il testo salvato, così l'utente vede subito cosa è stato scritto a suo nome |
| D7 | Raccolta automatica dalle sessioni di Claude Code | **Opt-in per progetto:** si attiva solo nelle cartelle elencate dall'utente (`micelio watch add <cartella>`), non su tutto ciò che fa con Claude |
| D8 | Budget di chiamate LLM per nodo | Default **40 chiamate al giorno**, configurabile. Classificazione con Haiku, distillazione con Sonnet |
| D9 | Revisione dell'inbox | Da CLI (`micelio inbox`) e da MCP (Claude può proporre "ho 3 ricordi in attesa, li rivediamo?"). Gli elementi scadono dopo 14 giorni |

### Attività

| # | Attività |
|---|---|
| 2.1 | `llm/`: adapter Claude CLI (dallo spike B) dietro un'interfaccia comune, coda con concorrenza 1, budget giornaliero, retry su output non valido, anti-loop `MICELIO_INTERNAL` |
| 2.2 | Archivio privato `private.db` (mai replicato) + inbox: CLI `micelio inbox [approve\|reject\|edit]` e tool MCP `inbox_review` / `inbox_decide` |
| 2.3 | Filtro deterministico: percorsi, parole chiave (HR, valutazioni, retribuzioni…), pattern di dati personali (codice fiscale, IBAN, telefono, email), **redazione dei segreti** (chiavi API, token, password, stringhe di connessione). Regole di default + regole del team via `team.config` |
| 2.4 | Classificazione con Haiku (schema e prompt dello spike B, set di casi di prova ampliato) |
| 2.5 | Distillazione con Sonnet: 0..N ricordi atomici, **regola di fedeltà alla fonte**, lingua del team (`memory.language`) |
| 2.6 | Hook `SessionEnd` di Claude Code installato da `micelio setup claude-code`: invia al daemon il percorso della trascrizione, solo per le cartelle opt-in (D7) |
| 2.7 | `remember` esplicito attraverso filtro + classificazione (D6) |
| 2.8 | Set di valutazione: 20–30 sessioni realistiche anonimizzate (tecniche, HR, miste, banali) con l'esito atteso, eseguibile con `npm run eval:ingest` |
| 2.9 | Test e documentazione (guida utente: privacy e inbox; sviluppo: pipeline) |

**Criterio di completamento:**
- Una sessione tecnica in una cartella opt-in produce ricordi nel team senza intervento.
- Una sessione su una mail di valutazione, o con credenziali, **non** produce nulla nel team (resta in privato o in inbox).
- Il set di valutazione passa almeno il 90% dei casi, e il 100% dei casi sensibili.

**Non coperto in Fase 2:** Codex CLI (serve un abbonamento per provarlo), cartelle di documenti (Fase 3).

---

## Fasi successive

- **Fase 3 — Documenti:** watcher sulle cartelle, estrazione PDF/DOCX/XLSX/PPTX, elaborazione incrementale per hash, stessa pipeline di filtro della Fase 2.
- **Fase 4 — Priorità:** embedding in un worker su richiesta, sqlite-vec, ricerca ibrida RRF, `usage.report`, attivazione, voti e pin, indicizzazione incrementale.
- **Fase 5 — Dreaming:** elezione per epoca, consolidamento, contraddizioni, collegamenti, decadimento, diario dei sogni, budget.
- **Fase 6 — Hardening:** rotazione della chiave all'offboarding, redazione, `micelio setup` per Codex, VS Code e WebStorm, shim MCP stdio, avvio come servizio di sistema, test su macOS, osservabilità.

---

## Registro

| Data | Evento |
|---|---|
| 2026-10-17 | Design v0.1. Nodi su internet, 10–30 nodi, LLM via CLI senza API, solo conoscenza distillata, ambiti private + team, lingua configurabile per team, inviti aperti a tutti con espulsione riservata agli admin, un progetto = un team separato |
| 2026-10-17 | Fase 0 completata (spike A, B, C) |
| 2026-10-17 | Decisioni D1–D5 confermate. Fase 1 avviata |
| 2026-10-17 | Fase 1 completata: 25 test + e2e Docker 11/11 + prova reale Windows ↔ container con Claude Code. Documentazione in `docs/`. Fase 2 proposta (decisioni D6–D9) |
