# Guida per sviluppatori

## Requisiti

- Node.js ≥ 22.13 (si usa `node:sqlite`, integrato e senza dipendenze native)
- Docker, solo per i test end-to-end
- TypeScript 5.9 (fissato: NestJS richiede `emitDecoratorMetadata`)

```bash
npm ci
npm run build        # tsc → dist/
npm run typecheck    # tipi su src + test
npm test             # unità + integrazione (circa 1 minuto)
npm run e2e:docker   # scenario a 4 container sulla DHT pubblica (circa 2 minuti)
```

## Struttura

```
src/
├─ core/      schemi zod degli eventi, modello dei record, percorsi locali
├─ net/       UNICO modulo che parla con le librerie Holepunch
│  ├─ apply.ts       funzione deterministica eventi → vista (Hyperbee)
│  └─ team-node.ts   Autobase + Hyperswarm + blind-pairing
├─ store/     indice di ricerca SQLite FTS5, derivato dalla vista
├─ export/    export Markdown in sola lettura
├─ node/      MicelioNode: orchestratore senza framework + config/stato
├─ mcp/       server MCP (tool recall/remember/get), indipendente dal trasporto
├─ daemon/    app NestJS: API REST locale, endpoint MCP, guard del token
└─ cli/       comando `micelio` (commander), client HTTP verso il daemon
```

Flusso di una scrittura:

```
CLI / MCP ─▶ daemon (NestJS) ─▶ MicelioNode.remember ─▶ TeamNode.append ─▶ Autobase (feed locale)
                                                                                 │ replica P2P
vista Hyperbee ◀── apply() ◀── linearizzazione causale dei feed di tutti i membri ◀┘
      │ evento 'update'
      ▼
MemoryIndex.rebuild (SQLite FTS5) + writeExport (Markdown)  ─▶  recall
```

## Regole d'oro

1. **`apply` è deterministica.** Dipende solo dagli eventi e dalla vista: niente `Date.now()`, rete, file o variabili globali. Autobase può annullare e riapplicare blocchi quando cambia l'ordinamento, e ogni nodo deve arrivare alla stessa vista. La scadenza degli inviti, per esempio, si controlla nel pairing e non in `apply`.
2. **L'autore viene dal feed, non dal payload.** In `apply` l'autore è `node.from.key`, quindi non è falsificabile.
3. **I permessi si verificano due volte.** In `apply`, che è la difesa definitiva, e prima di emettere l'evento (`MicelioNode.requireAdmin`). Il secondo controllo serve perché, con eventi concorrenti, un'azione emessa da un non-admin potrebbe essere ordinata *dopo* la sua promozione e risultare valida.
4. **Tutto ciò che è derivato si ricostruisce.** `view.db` ed `export/` si possono cancellare in qualunque momento.
5. **Le librerie Holepunch restano dentro `src/net`.** Non hanno tipi (vedi `src/types/holepunch.d.ts`) e la loro API evolve: il resto del codice usa solo le interfacce tipizzate di `TeamNode`.

## Aggiungere un tipo di evento

1. Aggiungi lo schema a `TeamEvent` in [src/core/events.ts](../src/core/events.ts).
2. Gestiscilo in `applyEvent` in [src/net/apply.ts](../src/net/apply.ts), rispettando le regole d'oro, con il controllo dei permessi.
3. Aggiungi i casi in [test/unit/apply.test.ts](../test/unit/apply.test.ts), compresi quelli vietati.
4. Esponi l'operazione in `MicelioNode`, poi in API, CLI o MCP.

Un evento sconosciuto o malformato viene **ignorato** da `apply`. I nodi con versioni vecchie non si bloccano, ma non vedono gli effetti dei nuovi eventi finché non vengono aggiornati.

## Test

| Livello | Dove | Cosa copre |
|---|---|---|
| Unità | `test/unit/` | `apply` (permessi, inviti monouso, idempotenza, determinismo), indice FTS (accenti, prefissi, input ostili) |
| Integrazione | `test/integration/team.test.ts` | 3 nodi reali su **DHT locale** (`hyperdht/testnet`): creazione, ingresso, convergenza, deduplica, ingresso con chi ha invitato offline, permessi |
| Integrazione | `test/integration/daemon.test.ts` | Daemon NestJS: token, errori 400, API, **client MCP reale**, persistenza dopo riavvio |
| End-to-end | `test/e2e/docker/` | 4 container sulla **DHT pubblica**: inviti, scritture concorrenti, nodi offline, rientri, espulsione |

`MICELIO_TEST_LOG=1 npm test` mostra i log dei nodi durante i test.

## Variabili d'ambiente

| Variabile | Uso |
|---|---|
| `MICELIO_HOME` | Cartella dati del nodo (default `~/.micelio`) |
| `MICELIO_PORT` / `MICELIO_HOST` | Porta e interfaccia dell'API locale (prevalgono su `config.json`) |
| `MICELIO_DHT_BOOTSTRAP` | `host:port,...` per una DHT privata o di test (default: DHT pubblica) |

## Immagine Docker

Il [Dockerfile](../Dockerfile) alla radice produce un nodo completo (`micelio daemon`, dati in `/data`, API su `0.0.0.0:7337`). Serve per i test e per un eventuale nodo "sempre acceso" che tenga il sapere disponibile quando i PC sono spenti.

```bash
docker build -t micelio-node .
docker run -d --name micelio-peer -v micelio-data:/data micelio-node
docker exec micelio-peer micelio init "Team Dev" --name server
```
