# Guida per sviluppatori

## Requisiti

- Node.js ≥ 22.13 (si usa `node:sqlite`, integrato e senza dipendenze native)
- Docker, solo per i test end-to-end
- Claude Code installato e autenticato, solo per la valutazione con il LLM reale
- TypeScript 5.9 (fissato: NestJS richiede `emitDecoratorMetadata`)

```bash
npm ci
npm run build        # daemon (tsc → dist/) + UI (vite → dist/ui)
npm run typecheck    # tipi su src + test
npm test             # unità + integrazione, con LLM finto (circa 1 minuto)
npm run e2e:docker   # scenario a 4 container sulla DHT pubblica (circa 2 minuti)
npm run eval:ingest  # valutazione con Claude REALE: consuma circa 25 chiamate dell'abbonamento
npm run test:ui      # test dei componenti React (jsdom, nessun browser)
npm run desktop      # app desktop
npm run demo         # team dimostrativo locale (3 nodi, DHT privata, LLM finto)
```

Il repository è un **workspace npm**: radice = daemon e CLI; `ui/` = interfaccia React; `desktop/` = app Electron.

## Struttura

```
src/
├─ core/       schemi zod degli eventi, modello dei record, percorsi locali
├─ net/        UNICO modulo che parla con le librerie Holepunch
│  ├─ apply.ts        funzione deterministica eventi → vista (Hyperbee), con i permessi
│  ├─ team-node.ts    Autobase + Hyperswarm + blind-pairing
│  └─ diagnose.ts     `micelio network check`: ingresso nella DHT, IP pubblico, NAT
├─ store/
│  ├─ memory-index.ts indice di ricerca SQLite FTS5, derivato dalla vista
│  └─ private-store.ts archivio privato: coda, inbox, decisioni, budget (mai replicato)
├─ privacy/    filtro deterministico: blocco HR/personale, redazione di segreti e dati personali
├─ llm/        adapter verso le CLI AI (Claude), adapter finto per i test, runner con budget
├─ ingest/     pipeline di ingestione: trascrizioni, prompt, instradamento, inbox
├─ export/     export Markdown in sola lettura
├─ node/       MicelioNode: orchestratore senza framework + config/stato
├─ roots/      Radici (Fase 8): revisione manuale (codice, documenti, contraddizioni)
├─ mcp/        server MCP (recall, remember, get, architecture, mark_root, inbox_review, inbox_decide…)
├─ daemon/     app NestJS: API REST locale, endpoint MCP, guard del token
└─ cli/        comando `micelio` (commander), client HTTP verso il daemon, hook di Claude Code
src/graph/     costellazione: ricordi come nodi, correlazioni come collegamenti pesati

ui/src/          interfaccia React (Vite), servita dal daemon su /ui
├─ api/          client tipizzato (tipi importati dal daemon), autenticazione, eventi SSE
├─ pages/        schermate; nucleus/ = Nucleo 3D (three.js, caricato in modo pigro)
└─ components/   componenti di base (niente librerie di componenti)

desktop/src/     app Electron: avvio del daemon, finestra, area di notifica, notifiche
server/          micelio-server: DHT privata del team. Pacchetto SEPARATO (proprio package.json,
                 dipende solo da hyperdht), non è un workspace: si installa su Linux con install.sh
scripts/         team dimostrativo (demo-team.js)
```

### Flusso di una scrittura

```
CLI / MCP / hook ─▶ daemon (NestJS) ─▶ MicelioNode ─▶ IngestPipeline ─▶ filtro ─▶ Haiku ─▶ (Sonnet)
                                                                                        │ esito "team"
                                                                                        ▼
vista Hyperbee ◀── apply() ◀── linearizzazione dei feed ◀── replica P2P ◀── TeamNode.append (memory.add)
      │ evento 'update'
      ▼
MemoryIndex.rebuild (SQLite FTS5) + writeExport (Markdown)  ─▶  recall
```

### Pipeline di ingestione

Riferimenti: [src/ingest/pipeline.ts](../src/ingest/pipeline.ts), DESIGN §6.

| Passo | Dove | Note |
|---|---|---|
| Riassunto git | `ingest/git-changes.ts` | Solo sessioni in un repository git: commit del capitolo (dai `timestamp` della trascrizione, ±2 min) e lavoro non committato se il capitolo è finito da meno di 2 ore. Solo nomi di file, dichiarazioni e messaggi di commit, max 4.000 caratteri. Si accoda alla conversazione **prima** del filtro |
| Filtro deterministico | `privacy/filter.ts` | Gira **prima** di qualunque LLM. Blocca gli argomenti HR e redige i segreti |
| Classificazione | `ingest/prompts.ts` (Haiku) | Output strutturato validato con zod |
| Instradamento | `route()` in `pipeline.ts` | Funzione pura: team / inbox / private / discard. Soglia di confidenza 0,8 |
| Distillazione | `ingest/prompts.ts` (Sonnet) | Solo per sessioni (team o dubbie). Regola di **fedeltà alla fonte** |
| Secondo filtro | `filterMemory()` | Sui ricordi distillati, prima di pubblicarli |

Le sessioni sono lavori in una **coda persistente** (`private.db`, tabella `jobs`), eseguiti da un worker ogni 3 s:
- budget esaurito → il lavoro passa al giorno dopo senza consumare tentativi;
- CLI non disponibile → nuovo tentativo dopo 10 minuti;
- altri errori → 3 tentativi, poi `failed`.

## Regole d'oro

1. **`apply` è deterministica.** Dipende solo dagli eventi e dalla vista: niente `Date.now()`, rete, file o variabili globali. Autobase può annullare e riapplicare blocchi quando cambia l'ordinamento, e ogni nodo deve arrivare alla stessa vista. La scadenza degli inviti, per esempio, si controlla nel pairing e non in `apply`.
2. **L'autore viene dal feed, non dal payload.** In `apply` l'autore è `node.from.key`, quindi non è falsificabile.
3. **I permessi si verificano due volte.** In `apply`, che è la difesa definitiva, e prima di emettere l'evento (`MicelioNode.requireAdmin`), per via degli eventi concorrenti (DESIGN §9).
4. **Tutto ciò che è derivato si ricostruisce.** `view.db` ed `export/` si possono cancellare in qualunque momento. `private.db` invece **no**: contiene inbox e coda.
5. **Le librerie Holepunch restano dentro `src/net`.** Non hanno tipi (vedi `src/types/holepunch.d.ts`) e la loro API evolve.
6. **Niente lascia la macchina prima del filtro.** Ogni nuovo ingresso di contenuti deve passare da `IngestPipeline`, mai da `TeamNode.append` diretto.
7. **Gli schemi degli eventi sono un contratto tra versioni.** I campi "aperti" sono stringhe libere e non enum: un nodo vecchio deve accettare valori nuovi.

## Convenzioni di codice

- **Commenti abbondanti, sempre:**
  - ogni file inizia con un'intestazione `@file` che spiega il ruolo del modulo e i suoi confini;
  - classi, metodi pubblici e parametri non ovvi hanno JSDoc;
  - ogni blocco di logica non ovvio ha un commento che spiega **perché** (vincoli, casi limite, bug passati, riferimenti a DESIGN §x).

  Chi legge il codice per la prima volta deve poterlo modificare senza ricostruire le decisioni da zero.
- Commenti, messaggi e documentazione in italiano. Identificatori in inglese.
- Errori causati dall'utente → `UserError` (HTTP 400 con messaggio leggibile). Tutto il resto è un bug (500).
- Input esterni (HTTP, MCP, file, output dei LLM) sempre validati con zod.

## Aggiungere un tipo di evento

1. Aggiungi lo schema a `TeamEvent` in [src/core/events.ts](../src/core/events.ts).
2. Gestiscilo in `applyEvent` in [src/net/apply.ts](../src/net/apply.ts), rispettando le regole d'oro e con il controllo dei permessi.
3. Aggiungi i casi in [test/unit/apply.test.ts](../test/unit/apply.test.ts), compresi quelli vietati.
4. Esponi l'operazione in `MicelioNode`, poi in API, CLI o MCP.

Un evento sconosciuto o malformato viene **ignorato** da `apply`. I nodi con versioni vecchie non si bloccano, ma non vedono gli effetti dei nuovi eventi finché non vengono aggiornati.

## Modificare prompt o filtro

I prompt ([src/ingest/prompts.ts](../src/ingest/prompts.ts)) e le regole del filtro decidono cosa arriva a tutto il team. Dopo ogni modifica:

1. `npm test`: la logica, con LLM finto;
2. `npm run eval:ingest`: la qualità, con Claude reale. Il report va in `test/eval/report.md`; obiettivi ≥ 90% di casi corretti e 100% dei casi sensibili fuori dal team;
3. se emerge un caso nuovo, aggiungilo a [test/eval/ingest-cases.ts](../test/eval/ingest-cases.ts).

## Test

| Livello | Dove | Cosa copre |
|---|---|---|
| Unità | `test/unit/apply.test.ts` | Permessi, inviti monouso, idempotenza, determinismo |
| Unità | `test/unit/memory-index.test.ts` | Ricerca: accenti, prefissi, input ostili |
| Unità | `test/unit/filter.test.ts` | Blocco HR, redazione di 11 tipi di segreti e dati personali, falsi positivi |
| Unità | `test/unit/transcript.test.ts` | Lettura delle trascrizioni di Claude Code, sessioni riprese, troncamento |
| Unità | `test/unit/pipeline.test.ts` | Instradamento, esplicito, inbox, sessioni, budget (LLM finto) |
| Integrazione | `test/integration/team.test.ts` | 3 nodi reali su **DHT locale**: ingresso, convergenza, permessi |
| Integrazione | `test/integration/daemon.test.ts` | Daemon NestJS: token, API, **client MCP reale**, ingestione via hook, inbox, riavvio |
| End-to-end | `test/e2e/docker/` | 4 container sulla **DHT pubblica** (LLM finto) |
| Valutazione | `test/eval/` | Classificazione e distillazione con **Claude reale** |

- `MICELIO_TEST_LOG=1 npm test` mostra i log dei nodi.
- L'adapter finto ([src/llm/fake.ts](../src/llm/fake.ts)) ha regole semplici e documentate: per esempio "LEZIONE: titolo | corpo" nel testo produce un ricordo.

## UI e app desktop

- La UI importa i **tipi** dal daemon (`import type … from '../../../src/…'`): una forma che cambia da una parte viene segnalata da TypeScript anche dall'altra, senza duplicare definizioni.
- Gli aggiornamenti in tempo reale passano da `GET /api/events` (SSE). Ogni argomento invalida precise query di TanStack Query (`ui/src/api/live.ts`, `TOPIC_QUERIES`). Una nuova schermata deve usare chiavi coerenti con quella mappa.
- **Verifica visiva senza tester:** `npm run screenshots -w desktop -- <cartella>` apre l'app nascosta, cattura ogni schermata in PNG ed esce.
  - `MICELIO_SCREENSHOT_ONLY=nucleo,team` limita le catture ad alcune schermate.
  - `MICELIO_SCREENSHOT_EXTRA="/?bloom=0|/?tour=1"` aggiunge rotte da catturare. **Da Git Bash** serve `MSYS_NO_PATHCONV=1`, altrimenti le rotte che iniziano con `/` diventano percorsi Windows e la cattura mostra una pagina vuota.
  - Gli errori della pagina finiscono nel log delle catture (`pagina: …`).
  - Le immagini in `docs/img/` sono state prodotte così, sul team demo.
- **Nucleo 3D e colori:** con la catena di post-processing (bloom) ogni colore di fondo diverso dal nero viene schiarito (grigio-blu). Lo sfondo resta quindi nero puro, e il bloom va inserito prima dell'eventuale `OutputPass` (vedi commenti in `Nucleus.tsx`).
- **Electron dal terminale di VS Code:** la variabile `ELECTRON_RUN_AS_NODE` ereditata fa partire Electron senza finestre. `desktop/launch.js` la rimuove: usare sempre `npm run desktop`.

## Variabili d'ambiente

| Variabile | Uso |
|---|---|
| `MICELIO_HOME` | Cartella dati del nodo (default `~/.micelio`) |
| `MICELIO_PORT` / `MICELIO_HOST` | Porta e interfaccia dell'API locale (prevalgono su `config.json`, ma **non** vengono salvate: l'hook di Claude Code non le vede) |
| `MICELIO_DHT_BOOTSTRAP` | `host:port,...` per una DHT privata o di test. Prevale su `network.bootstrap` di `config.json` (impostato con `micelio network set`); se mancano entrambi, DHT pubblica |
| `MICELIO_LLM_ADAPTER` | `claude` \| `none` \| `fake` (test ed e2e) |
| `MICELIO_INTERNAL` | Impostata da Micelio sulle proprie chiamate a Claude: l'hook le ignora (anti-loop) |

## Docker

Il [Dockerfile](../Dockerfile) alla radice produce un nodo completo (`micelio daemon`, dati in `/data`, API su `0.0.0.0:7337`). Serve per i test e per un eventuale nodo "sempre acceso" che tenga il sapere disponibile quando i PC sono spenti.

```bash
docker build -t micelio-node .
docker run -d --name micelio-peer -v micelio-data:/data micelio-node
docker exec micelio-peer micelio init "Team Dev" --name server
```

**Igiene del disco:** ogni rebuild lascia orfana l'immagine precedente (circa 480 MB). L'immagine ha l'etichetta `org.micelio.image=node`. Lo scenario e2e esegue da solo, a fine esecuzione:

```bash
docker image prune -f --filter label=org.micelio.image=node
```

Dopo un build manuale va eseguito a mano. Il comando tocca solo le immagini orfane di Micelio, mai quelle di altri progetti.
