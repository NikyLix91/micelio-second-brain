# Micelio

**Secondo cervello distribuito, peer-to-peer, per gli strumenti AI di un team di sviluppo.**

Ogni macchina del team esegue un nodo Micelio. I nodi si trovano da soli su internet e si scambiano la conoscenza del team senza alcun server centrale. A sincronizzazione completata **ogni nodo possiede il 100% del sapere condiviso**. Gli assistenti AI (Claude Code, e in futuro Codex, VS Code e WebStorm) leggono e scrivono questa memoria tramite **MCP**.

```
 PC di Alice            PC di Bob             Container "sempre acceso"
┌───────────┐  P2P   ┌───────────┐   P2P    ┌───────────┐
│  micelio  │◀──────▶│  micelio  │◀────────▶│  micelio  │
└─────▲─────┘        └─────▲─────┘          └───────────┘
      │ MCP                │ MCP
  Claude Code          Claude Code
```

> Stato: **Fase 3 completata**: team P2P, ricerca, MCP per Claude Code, raccolta automatica con filtro privacy e inbox, **app desktop** con il Nucleo 3D. Il piano è in [docs/PLAN.md](docs/PLAN.md).

![Il Nucleo: il sapere del team come ologramma 3D](docs/img/nucleo.png)

## Avvio rapido

```bash
npm ci && npm run build && npm link     # rende disponibile il comando `micelio`
npm run desktop                         # app desktop (avvia anche il daemon)
npm run demo                            # oppure: team dimostrativo con 3 nodi e ~50 ricordi

micelio start                           # avvia il daemon locale
micelio init "Team Dev" --name mio-pc   # crea un team (solo il primo nodo)
micelio invite                          # genera un codice per un collega
micelio setup claude-code               # collega Claude Code via MCP
```

Il collega, sulla sua macchina:

```bash
micelio start
micelio join <codice> --name suo-pc
micelio setup claude-code
```

Da quel momento, in Claude Code: *"cerca nella memoria del team come risolviamo X"* oppure *"salva nella memoria del team questa decisione"*.

## Documentazione

| Documento | Per chi |
|---|---|
| [Guida utente](docs/guida-utente.md) | Chi usa Micelio: installazione, team, inviti, ricordi, Claude Code |
| [App desktop e interfaccia](docs/app.md) | Il Nucleo 3D, le viste, le notifiche, il team demo |
| [Server MCP](docs/mcp.md) | Tool esposti agli agenti AI e configurazione dei client |
| [Guida per sviluppatori](docs/sviluppo.md) | Chi lavora sul codice: struttura, build, test, convenzioni |
| [Design](docs/DESIGN.md) | Architettura e decisioni |
| [Piano di lavoro](docs/PLAN.md) | Stato delle fasi e prossimi passi |
| [Spike della Fase 0](docs/spike-fase-0.md) | Esperimenti che hanno validato le scelte tecniche |

## Requisiti

Node.js ≥ 22.13 su Windows, macOS o Linux. Docker serve solo per i test end-to-end.
