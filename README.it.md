**Italiano** | [English](README.md)

# Micelio

**Un secondo cervello distribuito e peer-to-peer per gli strumenti AI di un team di sviluppo.**

[![CI](https://github.com/salvatorestracquadanio86/micelio-second-brain/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/salvatorestracquadanio86/micelio-second-brain/actions/workflows/ci.yml)
[![Licenza: AGPL-3.0](https://img.shields.io/badge/licenza-AGPL--3.0-blue.svg)](LICENSE)
![Versione](https://img.shields.io/badge/versione-0.7.0-green.svg)
![Piattaforme](https://img.shields.io/badge/piattaforme-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)

L'assistente AI di ogni sviluppatore impara qualcosa in ogni sessione: come si è sistemato un test instabile, perché si è scelta una libreria, quale endpoint ha una trappola. Poi la sessione finisce e quel sapere si perde. Il collega successivo, o la sessione successiva, riparte da zero.

Micelio lo conserva. Ogni PC del team ha un nodo Micelio: distilla quello che le sessioni AI hanno scoperto in **ricordi** brevi, tiene fuori tutto ciò che è privato e li condivide con il resto del team **direttamente fra i PC**, senza server centrale e senza cloud. Gli assistenti come Claude Code leggono e scrivono questa memoria via **MCP**, e ricevono in automatico i ricordi pertinenti all'inizio di ogni richiesta.

```
  PC di Alice           PC di Bob             Nodo sempre acceso (facoltativo)
┌───────────┐  P2P   ┌───────────┐   P2P    ┌───────────┐
│  micelio  │◀──────▶│  micelio  │◀────────▶│  micelio  │
└─────▲─────┘        └─────▲─────┘          └───────────┘
      │ MCP                │ MCP
  Claude Code          Claude Code
```

![Il Nucleo: il sapere del team come ologramma 3D](docs/img/nucleo.png)

## Cosa fa

- **Peer-to-peer, senza server.** Costruito sullo stack [Holepunch](https://holepunch.to) (Hyperswarm, Autobase, Hyperbee). Una volta sincronizzato ogni nodo ha tutto il sapere condiviso e funziona anche offline. Un server del team, facoltativo, può offrire una DHT privata e un relay.
- **Raccolta automatica.** Le sessioni di Claude Code nelle cartelle che abiliti diventano ricordi (soluzioni, decisioni, gotcha, procedure), con i riferimenti al codice: file, simboli e commit.
- **Prima la privacy.** Un filtro locale tiene sul tuo PC dati personali, questioni HR, segreti e dati dei clienti; i casi dubbi finiscono nella tua Inbox. I segreti vengono redatti prima che qualcosa lasci la macchina.
- **Contesto per gli agenti.** Tool MCP (`recall`, `remember`, `architecture`, ...) e hook che inseriscono in ogni richiesta il sapere fondante del team (le **Radici**) e i ricordi più pertinenti.
- **Memoria che impara dall'uso.** I ricordi che servono salgono, quelli sempre ignorati scendono, quelli che servono insieme si legano, e le scoperte sudate pesano di più.
- **Dreaming.** Un consolidamento periodico unisce i doppioni, segna i ricordi superati e collega quelli affini.
- **App desktop.** Nucleo 3D e mappa 2D del sapere, chat sulla memoria con mappa mentale, Inbox, misure di efficacia, backup, redazione con ricevuta firmata, più team sullo stesso PC. Interfaccia e guida in linea in italiano e in inglese.
- **Usa il tuo abbonamento.** La distillazione passa dalla CLI di Claude Code già installata sul PC: nessuna chiave API.

## Installazione

**Windows:** scarica `Micelio-Setup-<versione>.exe` dalla pagina [Releases](https://github.com/salvatorestracquadanio86/micelio-second-brain/releases). Si installa per l'utente corrente, senza diritti di amministratore.

**Linux:** AppImage e pacchetto `.deb` sono nella stessa pagina.

**Dal sorgente** (Windows, macOS, Linux; Node.js ≥ 22.13):

```bash
npm ci && npm run build && npm link     # rende disponibile il comando `micelio`
npm run desktop                         # app desktop (avvia anche il daemon)
npm run demo                            # oppure: team dimostrativo con 3 nodi e ~50 ricordi
```

## Per iniziare

```bash
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

Tutto si può fare anche dall'app desktop. Da quel momento, in Claude Code: *"cerca nella memoria del team come risolviamo X"* oppure *"salva questa decisione nella memoria del team"*.

## Documentazione

| Documento | Per chi |
|---|---|
| [Guida utente](docs/guida-utente.md) | Chi usa Micelio: installazione, team, inviti, ricordi, Claude Code |
| [App desktop e interfaccia](docs/app.md) | Il Nucleo 3D, le viste, le notifiche, il team dimostrativo |
| [Server MCP](docs/mcp.md) | Tool esposti agli agenti AI e configurazione dei client |
| [Server del team](server/README.md) | DHT privata e relay su una macchina Linux |
| [Guida per sviluppatori](docs/sviluppo.md) | Chi lavora sul codice: struttura, build, test, convenzioni |
| [Design](docs/DESIGN.md) | Architettura e decisioni |
| [Piano di lavoro](docs/PLAN.md) | Stato delle fasi e prossimi passi |
| [Changelog](CHANGELOG.md) | Cosa è cambiato in ogni versione (in inglese) |

## Stato

Micelio è giovane (prima versione: ottobre 2026) ed è usato ogni giorno da alcuni team di sviluppo. Il formato dei dati è stabile e ogni cambiamento viene migrato in automatico, ma qualche spigolo c'è ancora. Le segnalazioni di bug sono benvenute.

## Contribuire

I contributi sono benvenuti: vedi [CONTRIBUTING.md](CONTRIBUTING.md). Prima che la tua prima pull request venga unita ti verrà chiesto di accettare il [Contributor License Agreement](CLA.md), con un clic. Rispetta il [Codice di condotta](CODE_OF_CONDUCT.md). Per segnalare una vulnerabilità vedi [SECURITY.md](SECURITY.md).

## Licenza

Copyright © 2026 Salvatore Stracquadanio.

Micelio è software libero: puoi ridistribuirlo e/o modificarlo secondo i termini della [GNU Affero General Public License v3.0](LICENSE). In breve: puoi usarlo gratis, anche in azienda, e modificarlo; se distribuisci una versione modificata o la offri come servizio in rete, devi pubblicarne il codice sorgente con la stessa licenza.
