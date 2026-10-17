# Micelio — Piano di lavoro

> Documento vivo: viene aggiornato a ogni avanzamento. Design di riferimento: [DESIGN.md](DESIGN.md). Indice della documentazione: [README.md](README.md).
> Ultimo aggiornamento: **2026-10-17**. Fase 3 in corso.

## Stato

| Fase | Obiettivo | Stato |
|---|---|---|
| 0 — Spike | Ridurre i rischi tecnici | ✅ Completata |
| 1 — MVP | Brain condiviso minimo, usabile da Claude Code | ✅ Completata |
| 2 — Ingestione AI | Raccolta automatica con filtro privacy | ✅ Completata |
| 3 — UI base | App desktop di monitoraggio, controllo e decisioni (React + Electron) | 🔄 In corso |
| 4 — Documenti | Cartelle sorvegliate + documento originale su richiesta | ⬜ Da fare |
| 5 — Priorità | Vettori, ricerca ibrida, attivazione | ⬜ Da fare |
| 6 — Dreaming | Consolidamento coordinato | ⬜ Da fare |
| 7 — Hardening | Offboarding, redazione, installer, altri client | ⬜ Da fare |

---

## Decisioni prese

| # | Decisione | Esito |
|---|---|---|
| D1 | Linguaggio | TypeScript. Le parti web/HTTP usano **NestJS** |
| D2 | Consegna della chiave al nuovo membro | Blind-pairing con un membro online qualsiasi: il codice d'invito non contiene la chiave |
| D3 | Indexer | Gli admin sono gli indexer. Consigliati 2–3 admin |
| D4 | Cosa entra nell'MVP | Solo i salvataggi espliciti. "Come gestire l'esplicito" si definisce in Fase 2 (vedi D6) |
| D5 | Sistemi operativi | Tutti. Sviluppo su Windows, Linux verificato in Docker, macOS non ancora provato |
| D6–D9 | Ingestione AI | Vedi Fase 2 |
| D10 | Consenso al download dell'originale di un documento | Automatico per cartella: "scaricabili su richiesta sì/no" scelto quando si aggiunge la cartella (DESIGN §12-bis) |
| D11 | Chi serve l'originale | Solo il nodo proprietario. Le copie scaricate restano in cache locale per 30 giorni e non vengono ri-servite |
| D12 | UI | Web app **React** servita dal daemon + guscio Electron (notifiche, icona nell'area di notifica, avvio automatico del daemon). Fase dedicata subito dopo la Fase 2 (DESIGN §12-ter). Inizialmente proposta in Angular; il team usa React |

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

## Fase 2 — Ingestione AI ✅

**Obiettivo:** il sapere entra anche senza `remember` esplicito, dalle sessioni di Claude Code, e **niente di personale o sensibile arriva al team**. Riferimenti: DESIGN §6–7.

### Decisioni

| # | Domanda | Esito |
|---|---|---|
| D6 | Come trattare i salvataggi espliciti (`remember`) | ✅ Passano **anche loro** dal filtro deterministico e dalla classificazione. Se sono puliti vanno al team, altrimenti in inbox. Il tool risponde mostrando il testo salvato, così l'utente vede subito cosa è stato scritto a suo nome |
| D7 | Raccolta automatica dalle sessioni di Claude Code | ✅ **Opt-in per progetto:** si attiva solo nelle cartelle elencate dall'utente (`micelio watch add <cartella>`) |
| D8 | Budget di chiamate LLM per nodo | ✅ Configurabile, default **300 chiamate al giorno**. Quando il budget finisce il lavoro resta in coda per il giorno dopo. Classificazione con Haiku, distillazione con Sonnet |
| D9 | Inbox | ✅ Raccoglie **solo i casi dubbi in ingresso** (contenuto misto, dati sensibili segnalati insieme a contenuto utile, classificatore poco sicuro). I contenuti puliti vanno al team senza approvazione, quelli chiaramente personali o HR restano privati. Revisione da CLI (`micelio inbox`) e da MCP; gli elementi scadono dopo 14 giorni. **Non** riguarda i ricordi diventati inutili: quelli li archivia il dreaming (Fase 6), in modo reversibile |

### Attività

| # | Attività | Stato |
|---|---|---|
| 2.1 | `llm/`: adapter Claude CLI (dallo spike B) dietro un'interfaccia comune, coda con concorrenza 1, budget giornaliero, retry su output non valido, anti-loop `MICELIO_INTERNAL` | ✅ |
| 2.2 | Archivio privato `private.db` (mai replicato) + inbox: CLI `micelio inbox [approve\|reject\|edit]` e tool MCP `inbox_review` / `inbox_decide` | ✅ |
| 2.3 | Filtro deterministico: percorsi, parole chiave (HR, valutazioni, retribuzioni…), pattern di dati personali (codice fiscale, IBAN, telefono, email), **redazione dei segreti** (chiavi API, token, password, stringhe di connessione). Regole di default + regole del team via `team.config` | ✅ (regole sui percorsi rinviate alla Fase 4, dove servono per le cartelle di documenti) |
| 2.4 | Classificazione con Haiku (schema e prompt dello spike B, set di casi di prova ampliato) | ✅ |
| 2.5 | Distillazione con Sonnet: 0..N ricordi atomici, **regola di fedeltà alla fonte**, lingua del team (`memory.language`) | ✅ |
| 2.6 | Hook `SessionEnd` di Claude Code installato da `micelio setup claude-code`: invia al daemon il percorso della trascrizione, solo per le cartelle opt-in (D7) | ✅ |
| 2.7 | `remember` esplicito attraverso filtro + classificazione (D6) | ✅ |
| 2.8 | Set di valutazione: 20–30 sessioni realistiche anonimizzate (tecniche, HR, miste, banali) con l'esito atteso, eseguibile con `npm run eval:ingest` | ✅ |
| 2.9 | Test e documentazione (guida utente: privacy e inbox; sviluppo: pipeline) | ✅ |

**Criterio di completamento:**
- Una sessione tecnica in una cartella opt-in produce ricordi nel team senza intervento.
- Una sessione su una mail di valutazione, o con credenziali, **non** produce nulla nel team (resta in privato o in inbox).
- Il set di valutazione passa almeno il 90% dei casi, e il 100% dei casi sensibili.

**Criterio di completamento: raggiunto**, con strumenti reali:
- una **sessione reale di Claude Code** in una cartella opt-in ha fatto scattare l'hook, è stata classificata (Haiku, 4,9 s) e distillata (Sonnet, 6,1 s), e ha prodotto un ricordo fedele, ritrovabile con `recall`;
- una **sessione reale** in cui si chiedeva la mail di valutazione di fine anno di un collega è stata bloccata dal filtro locale **senza alcuna chiamata a Claude**: il team è rimasto invariato e il registro privato riporta il motivo;
- **set di valutazione** con Claude reale: 22 casi su 22 corretti, 8 casi sensibili su 8 fuori dal team (`test/eval/report.md`);
- 66 test automatici e scenario Docker end-to-end (11/11) verdi.

**Problemi emersi e risolti durante la fase:**
1. **Windows, nomi corti 8.3:** Claude Code riporta la cartella di lavoro con il nome lungo, mentre la cartella abilitata poteva essere salvata con quello corto (`MARIOR~1.ROS`). Le sessioni venivano ignorate in silenzio. Ora i percorsi sono normalizzati.
2. **Hook silenzioso:** un errore dell'hook non lasciava traccia. Ora finisce in `logs/hook.log`, e le sessioni ignorate sono segnalate nel log del daemon.
3. **Schema degli eventi:** `source.type` era un enum rigido, quindi i nodi vecchi avrebbero ignorato i ricordi con sorgenti nuove. Ora è una stringa libera (compatibilità in avanti).
4. **Commenti nel codice:** su tua segnalazione, tutto il codice è stato riscritto con intestazioni, JSDoc e commenti sul perché. La regola è nelle convenzioni ([sviluppo.md](sviluppo.md)).
5. **Disco:** i rebuild Docker lasciavano immagini orfane (circa 480 MB ciascuna). Sono state rimosse, e ora lo scenario e2e ripulisce da solo le immagini di Micelio.

**Non coperto in Fase 2:** Codex CLI (serve un abbonamento per provarlo), cartelle di documenti (Fase 4).

---

## Fase 3 — UI base 🔄

**Obiettivo:** un'app desktop per monitorare il nodo, cercare nel sapere del team, prendere le decisioni (inbox, membri) e configurare la raccolta, senza usare il terminale. Riferimento: DESIGN §12-ter.

### Decisioni

| # | Domanda | Esito |
|---|---|---|
| D13 | Dove vive il codice | ✅ Stesso repository: `ui/` (React + Vite) e `desktop/` (Electron), come workspace npm. Il daemon serve la UI compilata su `http://127.0.0.1:7337/ui` |
| D14 | App o browser | ✅ Si preferisce l'**app desktop**, ma la stessa UI funziona anche nel browser: `micelio ui` apre un link monouso che consegna il token alla pagina. L'app Electron legge il token direttamente da `config.json` |
| D15 | Notifiche | ✅ Nuovi elementi in inbox, nodo isolato da più di 10 minuti, budget LLM quasi esaurito |
| D16 | Pacchetti di installazione | ✅ **Nessuno per ora**: l'app si avvia da console (`npm run desktop`). Installer per tutti i sistemi, e avvio automatico all'accesso, in Fase 7 |

### Attività

| # | Attività | Stato |
|---|---|---|
| 3.1 | Daemon: canale di eventi in tempo reale (SSE `/api/events`): sincronizzazione, nuovi ricordi, inbox, coda, peer | ⬜ |
| 3.2 | Daemon: pubblicazione della UI compilata e comando `micelio ui` con link monouso | ⬜ |
| 3.3 | React: scheletro, navigazione, tema chiaro/scuro, client API tipizzato, aggiornamenti in tempo reale | ⬜ |
| 3.4 | Schermata Dashboard: nodo, team, peer, sincronizzazione, LLM e budget, coda | ⬜ |
| 3.5 | Schermata Memoria: ricerca, dettaglio, autore, fonte | ⬜ |
| 3.6 | Schermata Inbox: anteprima, approva (con modifica), rifiuta | ⬜ |
| 3.7 | Schermata Team: albero degli inviti, crea e copia un invito, promuovi ed espelli (solo admin), impostazioni di team | ⬜ |
| 3.8 | Schermata Privato: registro delle decisioni | ⬜ |
| 3.9 | Schermata Impostazioni: cartelle abilitate, budget e modelli LLM, configurazione di Claude Code | ⬜ |
| 3.10 | Electron: avvio automatico del daemon, finestra, icona nell'area di notifica, notifiche (D15), avvio da console | ⬜ |
| 3.11 | Test: SSE e API (integrazione), componenti React principali (unità), screenshot delle schermate dall'app reale | ⬜ |
| 3.12 | Documentazione: guida all'app, sviluppo della UI | ⬜ |

**Criterio di completamento:** sul PC Windows, l'app desktop avvia da sola il daemon e permette, senza terminale, di:
- vedere lo stato del nodo;
- cercare un ricordo;
- approvare o rifiutare un elemento dell'inbox, ricevendone la notifica;
- creare un invito;
- abilitare una cartella per la raccolta.

La stessa UI funziona anche dal browser con `micelio ui`.

**Nota sul disco:** React, Vite ed Electron aggiungono circa 600–800 MB di dipendenze di sviluppo in `node_modules` (nessuna immagine Docker in più). Per i test della UI non userò Playwright, che scaricherebbe altri browser: bastano i test dei componenti e la verifica manuale nell'app.

---

## Fasi successive

- **Fase 3 — UI base:** web app React servita dal daemon + guscio Electron. Canale SSE di eventi. Schermate Dashboard (nodo, peer, sincronizzazione, coda e budget LLM), Memoria, Inbox, Team, Privato, Impostazioni. Notifiche, icona nell'area di notifica, avvio automatico del daemon. Comando `micelio ui`.
- **Fase 4 — Documenti:** watcher sulle cartelle (con il flag "scaricabili su richiesta"), estrazione PDF/DOCX/XLSX/PPTX, elaborazione incrementale per hash, stessa pipeline di filtro della Fase 2. **Documento originale su richiesta:** canale P2P dedicato, tool MCP `fetch_source`, `micelio fetch`, cache con scadenza, schermata Richieste.
- **Fase 5 — Priorità:** embedding in un worker su richiesta, sqlite-vec, ricerca ibrida RRF, `usage.report`, attivazione, voti e pin (anche dalla UI), indicizzazione incrementale.
- **Fase 6 — Dreaming:** elezione per epoca, consolidamento, contraddizioni, collegamenti, decadimento, diario dei sogni (schermata UI), budget.
- **Fase 7 — Hardening:** rotazione della chiave all'offboarding, redazione, `micelio setup` per Codex, VS Code e WebStorm, shim MCP stdio, installer dell'app desktop per Windows/macOS/Linux, test su macOS, osservabilità.

---

## Registro

| Data | Evento |
|---|---|
| 2026-10-17 | Design v0.1. Nodi su internet, 10–30 nodi, LLM via CLI senza API, solo conoscenza distillata, ambiti private + team, lingua configurabile per team, inviti aperti a tutti con espulsione riservata agli admin, un progetto = un team separato |
| 2026-10-17 | Fase 0 completata (spike A, B, C) |
| 2026-10-17 | Decisioni D1–D5 confermate. Fase 1 avviata |
| 2026-10-17 | Fase 1 completata: 25 test + e2e Docker 11/11 + prova reale Windows ↔ container con Claude Code. Documentazione in `docs/`. Fase 2 proposta (decisioni D6–D9) |
| 2026-10-17 | Decisioni D6–D9 confermate (budget LLM di default portato a 300 chiamate al giorno; inbox solo per i casi dubbi) |
| 2026-10-17 | Nuove funzioni: documento originale su richiesta (D10–D11, Fase 4) e UI desktop Electron (D12, nuova Fase 3). Fasi successive rinumerate. Fase 2 avviata |
| 2026-10-17 | Su richiesta: codice riscritto con commenti abbondanti (regola nelle convenzioni). Igiene di Docker: immagini orfane rimosse e pulizia automatica |
| 2026-10-17 | Fase 2 completata: 66 test + e2e 11/11 + valutazione con Claude reale 22/22 (sensibili 8/8) + prova reale dell'hook di Claude Code (sessione tecnica → ricordo; mail di valutazione → bloccata localmente). Fase 3 proposta (decisioni D13–D16) |
| 2026-10-17 | Decisioni D13–D16 confermate: **React** al posto di Angular, stessa repository, app desktop preferita (browser supportato), nessun installer per ora (avvio da console). Fase 3 avviata |
