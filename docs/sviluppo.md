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
├─ privacy/    filtro deterministico: blocco HR/personale, redazione di segreti e dati personali,
│              file sensibili (.env, chiavi…) esclusi per intero (sensitive-files.ts)
├─ llm/        adapter verso le CLI AI (Claude), adapter finto per i test, runner con budget
├─ ingest/     pipeline di ingestione: trascrizioni, prompt, instradamento, inbox
├─ export/     export Markdown in sola lettura
├─ node/       MicelioHost (tutti i team del PC) e MicelioNode (un team): orchestratori senza
│              framework + config/stato, identità personale in core/identity.ts
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
| Lettura della trascrizione | `ingest/transcript-worker.ts` | `extractTranscript` gira in un worker thread (`readTranscript`), sia nella scansione periodica (solo misura, senza ricerca dei file sensibili) sia nella distillazione: una trascrizione da 200 MB costa ~6 s nel worker e blocca il thread principale per meno di 60 ms. La prima scansione parte 5 s dopo l'avvio, non durante |
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

## Più team (B3)

Un PC può stare in più team. I pezzi:

- **`MicelioHost`** (`src/node/micelio-host.ts`) apre un `MicelioNode` per ogni cartella `teams/<id>/` e tiene ciò che è unico per macchina: identità personale, `LlmRunner` (una coda e un budget, `machine.db`), embedder, team predefinito. Al primo avvio sposta in `teams/<id>/` i file di un nodo creato prima di B3 (`migrate`).
- **Percorsi** (`src/core/paths.ts`): `teamPaths(root, id)` dà a un nodo la sua cartella, ma `config` resta il `config.json` della radice. `settings` è il file delle impostazioni del team: `loadConfig` unisce i due file e `updateConfig` riscrive ogni sezione nel suo (`watch`, `network`, `dream` → `settings.json`). Nella struttura a un team (`nodePaths`, usata dai test di `MicelioNode`) i due coincidono.
- **Team della richiesta** (`src/daemon/team-context.ts`): il middleware legge `x-micelio-team` e lo mette in un `AsyncLocalStorage`; `MicelioService.node` restituisce il nodo di quel team (o del predefinito). Le rotte esistenti non cambiano. Fanno eccezione `team/init`, `team/join`, `teams/*` e `ingest/session`, che passano dall'host.
- **Cartelle**: l'host passa a ogni nodo `owns(dir)` (vince la cartella abilitata più specifica, `ownerOf`) e `claimFolder` (stessa cartella in due team vietata; cartelle di documenti annidate fra team vietate).
- **Identità** (`src/core/identity.ts`): `member.identity` firmato sulla chiave del feed, verificato in `apply`. `MicelioNode.linkIdentity` lo pubblica all'avvio se manca.
- **MCP**: `/mcp` = team della cartella in `x-micelio-cwd` (mandata dallo shim `micelio mcp`, `src/mcp/stdio-proxy.ts`) o il predefinito, `/mcp/:team` = team indicato (`mcp.controller.ts`, `nodeForRequest`). `registerMcp` registra lo shim stdio in ambito utente. `registerProjectMcp` lo registra con `claude mcp add --scope local` nella cartella del progetto.

Test: `test/integration/multi-team.test.ts` (migrazione, sapere separato, instradamento, riavvio, uscita), i casi multi-team in `daemon.test.ts`, `member.identity` in `test/unit/apply.test.ts`, `ui/src/__tests__/Teams.test.tsx`.

## Blocco B4: contesto, lacune, file per gli agenti, qualità, uso personale

Ogni funzione sta in un modulo suo; il nodo fa solo da collegamento.

| Funzione | Moduli | Note |
|---|---|---|
| Contesto automatico | `src/context/agent-context.ts`, `MicelioNode.agentContext`, `MicelioHost.agentContext`, `POST /api/context`, `micelio hook session-start\|prompt` | Hook installati da `installHooks` (`src/node/integrations.ts`). Impostazioni della macchina `context.*` |
| Lacune e riepilogo | `src/insight/gaps.ts`, `src/insight/digest.ts`, eventi `gap.report` / `gap.close` | Ricerche senza risultato in `private.db` (`search_misses`); notifica del lunedì in `desktop/src/notifications.ts` |
| File per gli agenti, import | `src/roots/agent-files.ts`, `src/roots/import.ts` | Elenco dei file tenuti aggiornati: `agentFiles` in `settings.json` del team; riscritti dopo ogni `materialize` solo se cambiano |
| Aggiornare invece di aggiungere | `src/ingest/write-update.ts`, `MicelioNode.publish` / `writeDecision` | Compito LLM `write-update` (modello di classificazione); `memory.supersede` per l'aggiornamento; team config `memory.updateOnWrite` |
| Codice cambiato | `src/rank/code-staleness.ts` | `private.db` (`code_staleness`); `activationOf` moltiplica per `stalenessFactor` |
| Solo locale | `TeamNodeOptions.offline`, `network.mode = 'local'` | Niente swarm né pairing; `invite` rifiutato con spiegazione |
| Ricordi personali | `private.db` (`personal`), `MicelioNode.personalIds` | Nell'indice insieme a quelli del team; `teamMemories()` li esclude da costellazione, dreaming, metriche, scansioni |

Regola: le operazioni di team (voto, pin, Radice, redazione) passano da `requireMemory`, che rifiuta i ricordi personali. L'adapter finto (`src/llm/fake.ts`) conosce anche `write-update`: `[aggiorna]` e `[duplicato]` nel testo guidano la decisione nei test.

## Regole d'oro

1. **`apply` è deterministica.** Dipende solo dagli eventi e dalla vista: niente `Date.now()`, rete, file o variabili globali. Autobase può annullare e riapplicare blocchi quando cambia l'ordinamento, e ogni nodo deve arrivare alla stessa vista. La scadenza degli inviti, per esempio, si controlla nel pairing e non in `apply`.
2. **L'autore viene dal feed, non dal payload.** In `apply` l'autore è `node.from.key`, quindi non è falsificabile.
3. **I permessi si verificano due volte.** In `apply`, che è la difesa definitiva, e prima di emettere l'evento (`MicelioNode.requireAdmin`), per via degli eventi concorrenti (DESIGN §9).
4. **Tutto ciò che è derivato si ricostruisce.** `view.db` ed `export/` si possono cancellare in qualunque momento. `private.db` invece **no**: contiene inbox e coda.
5. **Le librerie Holepunch restano dentro `src/net`.** Non hanno tipi (vedi `src/types/holepunch.d.ts`) e la loro API evolve.
6. **Niente lascia la macchina prima del filtro.** Ogni nuovo ingresso di contenuti deve passare da `IngestPipeline`, mai da `TeamNode.append` diretto.
7. **Gli schemi degli eventi sono un contratto tra versioni.** I campi "aperti" sono stringhe libere e non enum: un nodo vecchio deve accettare valori nuovi.
8. **Ogni funzione nasce bilingue e con la sua guida in linea.** Una funzione è finita solo quando i suoi testi esistono in italiano e in inglese e ha la voce nella guida in linea, che spiega anche come funziona dietro. Vedi «Lingue dell'interfaccia».

## Lingue dell'interfaccia (italiano / inglese)

**Testi della UI.** Ogni componente dichiara i suoi testi accanto al codice:

```tsx
const S = defineStrings({
  it: { title: 'Memoria del team', found: (n: number) => `${n} ricordi trovati` },
  en: { title: 'Team memory', found: (n: number) => `${n} memories found` }
})
const s = useStrings(S)  // → s.title, s.found(3)
```

`defineStrings` obbliga la versione inglese ad avere la stessa forma di quella italiana: stesse chiavi, stessi parametri. Se manca un testo, **TypeScript non compila**. Si trova in `ui/src/i18n/index.tsx`, che contiene anche `LangSwitch` (il selettore IT/EN), `byLang` (tabelle di etichette come `KIND_LABEL`) e `currentLang`/`currentLocale` per il codice fuori da React.

**Formattazione.** Le funzioni di `ui/src/format.ts` (date, byte, percentuali) usano il locale della lingua scelta.

**Errori del daemon.** Si lanciano con il testo inglese accanto: `new UserError('Operazione riservata agli admin del team', 'Only team admins can do this')`. La classe base è `LocalizedError` (`src/core/errors.ts`). La UI manda la lingua con l'intestazione `x-micelio-lang`, e `ErrorFilter` risponde in quella lingua; CLI e MCP ricevono l'italiano.

**Testi composti dal daemon** (indicazioni, note di revisione…). Si restituiscono **un codice e i valori** insieme al testo italiano, e la UI compone la frase nella sua lingua. Esempi: `advice.code/params` della qualità della distillazione, `notes[].code/params` della revisione delle Radici.

**App desktop.** I testi del menu dell'icona e delle notifiche stanno in `desktop/src/strings.ts`. La lingua iniziale è quella del sistema; poi la UI comunica quella scelta con `window.micelio.setLang`.

**Cosa resta nella lingua d'origine.** Sono **dati del team**, non testi dell'app: titoli e contenuti dei ricordi (nella lingua di team `memory.language`), motivi delle segnalazioni sulle Radici, riassunti dei sogni, motivi nel registro privato. Restano in italiano anche CLI e risposte MCP.

## Guida in linea

I contenuti sono file Markdown, uno per argomento e per lingua: `ui/src/help/content/it/<argomento>.md` e `ui/src/help/content/en/<argomento>.md`. Vite li include nel pacchetto della UI (`import.meta.glob` in `ui/src/help/index.tsx`), quindi la guida funziona anche senza rete.

Formato di un file:

```md
# Titolo dell'argomento

Introduzione.

## Titolo di una sezione {#ancora}

Testo della sezione.
```

- L'**ancora** identifica la sezione: è la stessa nelle due lingue, e i pulsanti «?» la usano (`help='roots#review'`).
- L'ordine dell'indice è `TOPIC_ORDER` in `ui/src/help/index.tsx`: un argomento nuovo va aggiunto lì.
- Nelle pagine: `<PageHeader help='argomento' …>` e `<Card help='argomento#ancora' …>` mostrano il «?»; altrove si usa `<HelpButton topic='…' />`.
- F1 apre l'argomento della pagina corrente: mappa `PAGE_TOPIC` in `ui/src/App.tsx`.
- `ui/src/__tests__/help.test.tsx` fallisce se un argomento manca in una lingua, se le ancore non coincidono o se un «?» punta a una sezione inesistente.

La guida spiega anche **come funziona dietro**: dove stanno i file, in che formato, come arrivano agli altri. Una funzione nuova aggiorna la sua voce (regola d'oro 8).

**Catture in una lingua precisa:** `#/…?lang=en` nell'indirizzo forza la lingua, per esempio `MICELIO_SCREENSHOT_EXTRA="/stato?lang=en"`.

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

## Integrazione continua (CI)

I workflow di GitHub Actions sono in [.github/workflows/](../.github/workflows/).

| Workflow | Quando | Cosa fa |
|---|---|---|
| `ci.yml` | push su `main`/`develop`, pull request verso di loro, a mano | `npm ci`, `typecheck`, `build`, `npm test`, `test:ui` su **Linux, Windows e macOS** con Node 22 (più Node 24 su Linux); build del server del team (`server/`); sulle pull request, *dependency review* delle dipendenze nuove (blocca vulnerabilità alte o critiche) |
| `codeql.yml` | come sopra, più ogni lunedì | Analisi di sicurezza CodeQL del codice TypeScript e dei workflow; risultati in *Security → Code scanning* |
| `cla.yml` | pull request e commenti | Controlla che chi contribuisce abbia accettato il [CLA](../CLA.md) |
| `release.yml` | tag `v*`; prova a secco sulle PR che toccano i pacchetti | Costruisce installer e pacchetti e crea la release in bozza: vedi [Rilasciare una versione](#rilasciare-una-versione) |

Fuori dalla CI, da lanciare a mano: lo scenario Docker (`npm run e2e:docker`, usa la DHT pubblica e dipende da internet) e il set di valutazione (`npm run eval:ingest`, usa Claude reale).

Regole dei workflow, perché la repository è pubblica:
- **permessi minimi** (`contents: read`), alzati solo nel job che ne ha bisogno (CodeQL: `security-events: write`; release: `contents: write` e attestazione);
- **azioni fissate allo SHA del commit**, con la versione in commento (`@<sha> # v7.0.1`): un tag si può spostare, uno SHA no. Le aggiorna Dependabot ([.github/dependabot.yml](../.github/dependabot.yml)), che apre ogni settimana PR verso `develop` anche per le dipendenze npm (minori e patch raggruppate);
- **`pull_request`, mai `pull_request_target` con checkout del codice della PR**: il codice di un fork gira senza segreti e con un token in sola lettura (l'unica eccezione è `cla.yml`, che non esegue codice della PR);
- `persist-credentials: false` nel checkout;
- in CI il binario di Electron non si scarica mai: da Electron 42 `npm ci` non lo scarica (lo fa il primo avvio), e tipi, build e test non lo avviano.

**Versioni forzate (`overrides` in `package.json`).** `multer` è fissato a `^2.5.0` perché anche la `@nestjs/platform-express` più recente richiede la 2.4.0, che ha una vulnerabilità nota (negazione del servizio). Quando NestJS richiederà da sola la 2.5.0 o superiore, l'override va tolto. `package.json` non ammette commenti: il motivo di ogni override sta qui.

Se un test fallisce solo su un sistema, la matrice non si ferma (`fail-fast: false`): il riepilogo dell'esecuzione mostra quali sistemi sono rotti.

## UI e app desktop

- La UI importa i **tipi** dal daemon (`import type … from '../../../src/…'`): una forma che cambia da una parte viene segnalata da TypeScript anche dall'altra, senza duplicare definizioni.
- Gli aggiornamenti in tempo reale passano da `GET /api/events` (SSE). Ogni argomento invalida precise query di TanStack Query (`ui/src/api/live.ts`, `TOPIC_QUERIES`). Una nuova schermata deve usare chiavi coerenti con quella mappa.
- **Verifica visiva senza tester:** `npm run screenshots -w desktop -- <cartella>` apre l'app nascosta, cattura ogni schermata in PNG ed esce.
  - `MICELIO_SCREENSHOT_ONLY=nucleo,team` limita le catture ad alcune schermate.
  - `MICELIO_SCREENSHOT_EXTRA="/?bloom=0|/?tour=1"` aggiunge rotte da catturare. **Da Git Bash** serve `MSYS_NO_PATHCONV=1`, altrimenti le rotte che iniziano con `/` diventano percorsi Windows e la cattura mostra una pagina vuota.
  - Gli errori della pagina finiscono nel log delle catture (`pagina: …`).
  - Le immagini in `docs/img/` sono state prodotte così, sul team demo.
- **Nucleo 3D e colori:** con la catena di post-processing (bloom) ogni colore di fondo diverso dal nero viene schiarito (grigio-blu). Lo sfondo resta quindi nero puro, e il bloom va inserito prima dell'eventuale `OutputPass` (vedi commenti in `Nucleus.tsx`).
- **Electron dal terminale di VS Code:** la variabile `ELECTRON_RUN_AS_NODE` ereditata fa partire Electron senza finestre. `desktop/launch.js` la rimuove: usare sempre `npm run desktop`. Lo stesso vale per provare l'app impacchettata dal terminale: `env -u ELECTRON_RUN_AS_NODE build/win/out/win-unpacked/Micelio.exe`.

## Installer di Windows

`npm run package:win` (solo su Windows) produce `build/win/out/Micelio-Setup-<versione>.exe` con electron-builder (NSIS, per utente, x64). Lo script è `scripts/package-win.js`; i passi aggiuntivi dell'installer sono in `desktop/build/installer.nsh`.

| Nell'installazione | Da dove |
|---|---|
| `Micelio.exe`, `resources/app.asar` | app desktop (`desktop/dist`), senza `node_modules` |
| `resources/micelio/` | `dist/` + dipendenze di produzione del daemon **copiate** da `node_modules` (elenco da `npm ls --omit=dev --workspaces=false`: stesse versioni dei test, nessun download), senza binari per altre piattaforme |
| `resources/node/node.exe` | il Node.js che esegue lo script (stessa versione dei test) |
| `resources/bin/micelio.cmd` | il comando `micelio` (Node incluso + CLI); aggiunto al PATH dell'utente dall'installer |

Cose da sapere, imparate costruendolo:
- le risorse extra di electron-builder **escludono sempre** le cartelle `node_modules`: `resources/micelio` si copia nell'hook `afterPack`;
- in una repository a workspace electron-builder metterebbe il `node_modules` della radice in `app.asar` (850 MB): `files` lo esclude;
- Windows Defender analizza `Micelio.exe` appena creato e a volte lo tiene aperto («UNKNOWN: unknown error, open …Micelio.exe»): lo script riprova fino a 3 volte;
- l'app desktop riconosce l'installazione da `process.resourcesPath` (`desktop/src/daemon.ts`, `PACKAGED`) e avvia il daemon con il Node incluso;
- gli hook di Claude Code usano percorsi assoluti (`process.execPath` del daemon e la CLI dell'installazione), quindi funzionano anche senza PATH;
- l'installer non è firmato (SmartScreen avvisa). Per una distribuzione vera serve un certificato di firma del codice.

## Pacchetti per Linux

`npm run package:linux` produce in `build/linux/out/` un **AppImage** (`Micelio-<versione>-x86_64.AppImage`) e un **.deb** (`micelio_<versione>_amd64.deb`). Lo script è `scripts/package-linux.js`; le parti comuni con Windows (compilazione, copia delle dipendenze, Node incluso, icona, configurazione di electron-builder) sono in `scripts/package-common.js`.

**Va eseguito su Linux** (va bene anche WSL2 o un container), dopo `npm ci` fatto da Linux: i moduli nativi in `node_modules` sono quelli del sistema su cui npm li ha installati e finiscono nel pacchetto così come sono. L'architettura è quella del Node che esegue lo script (x64 o arm64). Senza una macchina Linux, dalla radice della repo:

```bash
git archive HEAD | docker run -i --name micelio-linux-build node:24-bookworm bash -c   "mkdir /src && tar -x -C /src && cd /src && npm ci && npm run package:linux"
docker cp micelio-linux-build:/src/build/linux/out ./build/linux/
docker rm micelio-linux-build
```

| Nel pacchetto (`/opt/Micelio` con il .deb) | Da dove |
|---|---|
| `micelio-desktop` | l'app desktop (Electron). Non si chiama `micelio`, che è il comando della CLI |
| `resources/micelio/` | `dist/` + dipendenze di produzione del daemon, copiate da `node_modules` |
| `resources/node/node` | il Node.js che esegue lo script |
| `resources/bin/micelio` | il comando `micelio`. Il .deb lo collega in `/usr/bin/micelio` |

Cose da sapere:
- gli script di installazione del .deb sono quelli **predefiniti** di electron-builder (collegamento in `/usr/bin`, sandbox di Chromium, profilo AppArmor per Ubuntu 24+), con in coda il collegamento di `micelio`. Sostituirli del tutto avrebbe perso quei passi. La rimozione toglie il collegamento solo se è il nostro, e non durante un aggiornamento;
- fra le dipendenze del .deb c'è anche la libreria audio (`libasound2t64 | libasound2`): Electron la carica all'avvio, e su un sistema minimo l'app non partiva;
- con l'AppImage il comando `micelio` resta dentro l'immagine: per la CLI va usato il .deb (o i sorgenti);
- `desktop/package.json` ha `homepage`: il .deb la richiede.

Verificato (2026-10-19, Debian 12 pulito in un container, senza Node di sistema): installazione del .deb con le dipendenze, `micelio` nel PATH, daemon con il Node incluso, team e ricordo, app desktop su uno schermo virtuale (avvia il daemon, interfaccia disegnata), rimozione pulita. Non provati: desktop Linux reale con icona nell'area di notifica, Ubuntu 24 con AppArmor, arm64.

## Rilasciare una versione

Le release le costruisce GitHub Actions ([.github/workflows/release.yml](../.github/workflows/release.yml)) quando si pubblica un tag `vX.Y.Z` su `main`: nessun installer si costruisce più a mano sul proprio PC. Il workflow crea una release in **bozza**; la pubblica una persona, dopo averla guardata.

**Passi** (esempio con la 0.7.1):

1. Da `develop` aggiornato, un branch per la versione:
   ```bash
   git checkout develop && git pull
   git checkout -b release/0.7.1
   ```
2. Controlla che in `CHANGELOG.md` la sezione **Unreleased** descriva tutto ciò che entra nella versione, poi:
   ```bash
   npm run version:set 0.7.1
   ```
   Lo script ([scripts/set-version.js](../scripts/set-version.js)) porta a 0.7.1 `package.json`, `desktop/package.json` e `package-lock.json`, e sposta il contenuto di Unreleased sotto `## [0.7.1] - <oggi>`. Se Unreleased è vuota si ferma senza toccare nulla.
3. Commit `Release 0.7.1`, push, PR verso `develop`; a CI verde, merge.
4. PR da `develop` verso `main`; a CI verde, merge.
5. Il tag, sul `main` appena aggiornato:
   ```bash
   git checkout main && git pull
   git tag v0.7.1
   git push origin v0.7.1
   ```
6. In *Actions → Release* il workflow:
   - controlla che il tag sia uguale alla versione dei `package.json`, che il commit sia su `main` e che il CHANGELOG abbia la sezione;
   - rifà tutta la CI sul commit del tag;
   - costruisce l'installer di Windows (su Windows) e AppImage e .deb (su Linux), con il Node di `.nvmrc`, che è quello che finisce dentro i pacchetti;
   - calcola `SHA256SUMS.txt` e firma la **provenienza** dei pacchetti (attestazione di GitHub: chiunque può verificare che il file viene da questo workflow, su questo commit);
   - crea la release in bozza, con le note prese dal CHANGELOG.
7. In *Releases* apri la bozza, controlla note e file, e premi **Publish release**.

Una versione con suffisso (`0.8.0-rc.1`) è una **pre-release**: lo script non tocca il CHANGELOG, le note vengono da Unreleased e la release è marcata come pre-release.

**Prova a secco.** Senza tag il workflow costruisce tutto e lascia i file come artefatto dell'esecuzione, senza attestazione né release. Parte da solo sulle pull request che toccano il modo in cui si costruiscono i pacchetti (`release.yml`, `.nvmrc`, `scripts/package-*.js`, `scripts/set-version.js`, `desktop/build/`), e a mano da *Actions → Release → Run workflow*.

Cose da sapere:
- `electron-builder` gira con `publish: 'never'` (`BUILD_OPTIONS` in `scripts/package-common.js`): in CI su un tag proverebbe a pubblicare da solo. `latest.yml` e `latest-linux.yml`, che serviranno agli aggiornamenti automatici, si generano comunque e finiscono nella release;
- solo l'ultimo job del workflow può scrivere nella repository, e non esegue codice: scarica i file già costruiti;
- il tag va creato **dopo** il merge in `main` (passo 4): GitHub esegue il `release.yml` del commit del tag, e su un commit vecchio non parte nulla o parte una versione vecchia del workflow;
- un tag sbagliato si cancella con `git push --delete origin vX.Y.Z` (e `git tag -d vX.Y.Z`), insieme alla bozza;
- i tag `v*` sono protetti da un ruleset: solo l'amministratore li crea, li sposta o li cancella;
- fuori per ora: pacchetto per macOS, firma del codice su Windows (SmartScreen avvisa, le note della release spiegano come procedere), immagine Docker del server.

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

**Sicurezza:** dentro il container l'API ascolta su tutte le interfacce, ma non è pubblicata: si usa con `docker exec`. Se serve raggiungerla dall'host, pubblicala solo in locale con `-p 127.0.0.1:7337:7337`. Con `-p 7337:7337` sarebbe raggiungibile dalla rete in HTTP semplice, e il token si potrebbe intercettare.

**Igiene del disco:** ogni rebuild lascia orfana l'immagine precedente (circa 480 MB). L'immagine ha l'etichetta `org.micelio.image=node`. Lo scenario e2e esegue da solo, a fine esecuzione:

```bash
docker image prune -f --filter label=org.micelio.image=node
```

Dopo un build manuale va eseguito a mano. Il comando tocca solo le immagini orfane di Micelio, mai quelle di altri progetti.
