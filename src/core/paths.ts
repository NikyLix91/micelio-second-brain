/**
 * @file Percorsi locali di un nodo (DESIGN §13).
 *
 * EN: Local paths of a node (DESIGN §13).
 *
 * Tutti i dati di un nodo stanno sotto una sola cartella "home" (default `~/.micelio`).
 * La variabile MICELIO_HOME (o l'opzione `--home` della CLI) permette di avere più nodi sulla
 * stessa macchina senza interferenze: è così che girano i test e i container.
 *
 * EN: All the data of a node lives under a single "home" folder (default `~/.micelio`).
 * The MICELIO_HOME variable (or the CLI `--home` option) lets you run several nodes on the
 * same machine without interference: that's how the tests and the containers run.
 *
 * Più team sulla stessa macchina (B3). Struttura della home:
 *
 *   ~/.micelio/
 *     config.json      impostazioni della MACCHINA: porta, token, LLM, embedding, team predefinito
 *     identity.json    chi sei: nome e chiavi della tua identità personale, uguale in tutti i team
 *     machine.db       budget giornaliero dell'LLM, condiviso da tutti i team (un solo abbonamento)
 *     logs/
 *     teams/<id>/      tutto ciò che riguarda UN team, separato dagli altri:
 *       settings.json  impostazioni locali del team: cartelle abilitate, rete (DHT), dreaming
 *       state.json     chiavi del team (cifratura compresa)
 *       corestore/  view.db  private.db  export/  sources/
 *
 * EN: Multiple teams on the same machine (B3). Layout of the home:
 *
 *   ~/.micelio/
 *     config.json      MACHINE settings: port, token, LLM, embedding, default team
 *     identity.json    who you are: name and keys of your personal identity, the same in every team
 *     machine.db       daily LLM budget, shared by all teams (a single subscription)
 *     logs/
 *     teams/<id>/      everything about ONE team, kept apart from the others:
 *       settings.json  local team settings: enabled folders, network (DHT), dreaming
 *       state.json     team keys (encryption key included)
 *       corestore/  view.db  private.db  export/  sources/
 *
 * `<id>` è un identificativo LOCALE (8 caratteri esadecimali casuali): non deriva dalle chiavi
 * del team, così il nome della cartella non rivela niente.
 * Prima di B3 i file di un team stavano direttamente nella home: `MicelioHost` li sposta in
 * `teams/<id>/` al primo avvio (vedi src/node/micelio-host.ts).
 *
 * EN: `<id>` is a LOCAL identifier (8 random hex characters): it is not derived from the team
 * keys, so the folder name reveals nothing.
 * Before B3 a team's files lived directly in the home: `MicelioHost` moves them to
 * `teams/<id>/` on first start (see src/node/micelio-host.ts).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Mappa dei file e delle cartelle di un nodo (di UN team). / EN: Map of the files and folders of a node (of ONE team). */
export interface NodePaths {
  /** Cartella del nodo: la home (struttura a un team) o `teams/<id>/`. / EN: Node folder: the home (single-team layout) or `teams/<id>/`. */
  home: string
  /** Configurazione della macchina (porta, token, LLM). Non replicata. / EN: Machine configuration (port, token, LLM). Not replicated. */
  config: string
  /**
   * Impostazioni locali del team (cartelle opt-in, rete, dreaming). Nella struttura a un solo
   * team coincide con `config`: tutto sta in config.json, come prima di B3.
   *
   * EN: Local team settings (opt-in folders, network, dreaming). In the single-team layout it is the same as
   * `config`: everything is in config.json, as before B3.
   */
  settings: string
  /** Chiavi del team (incluso quella di cifratura!). Da proteggere come una password. / EN: Team keys (including the encryption one!). Protect them like a password. */
  state: string
  /** Corestore: i feed Hypercore del team replicati da Autobase. / EN: Corestore: the team's Hypercore feeds replicated by Autobase. */
  store: string
  /** Indice di ricerca SQLite, DERIVATO dalla vista: si può cancellare e viene ricostruito. / EN: SQLite search index, DERIVED from the view: it can be deleted and gets rebuilt. */
  index: string
  /** Archivio privato SQLite: inbox, decisioni, coda lavori, budget. Mai replicato. / EN: SQLite private store: Inbox, decisions, job queue, budget. Never replicated. */
  private: string
  /** Export Markdown in sola lettura. / EN: Read-only Markdown export. */
  export: string
  /** Log del daemon quando è avviato in background. / EN: Daemon log when it runs in the background. */
  logs: string
}

/**
 * Calcola i percorsi del nodo nella struttura a un solo team (tutto nella home).
 * È anche la "radice" da cui partono `hostFiles` e `teamPaths`.
 *
 * EN: Computes the node paths in the single-team layout (everything in the home). It is also the "root" that
 * `hostFiles` and `teamPaths` start from.
 * @param home cartella radice; default MICELIO_HOME o ~/.micelio
 *             EN: root folder; default MICELIO_HOME or ~/.micelio
 */
export function nodePaths (home = process.env.MICELIO_HOME || path.join(os.homedir(), '.micelio')): NodePaths {
  return {
    home,
    config: path.join(home, 'config.json'),
    settings: path.join(home, 'config.json'),
    state: path.join(home, 'state.json'),
    store: path.join(home, 'corestore'),
    index: path.join(home, 'view.db'),
    private: path.join(home, 'private.db'),
    export: path.join(home, 'export'),
    logs: path.join(home, 'logs')
  }
}

/** File della macchina che valgono per tutti i team (B3). / EN: Machine files that apply to all teams (B3). */
export interface HostFiles {
  /** Identità personale: nome e coppia di chiavi (vedi src/node/identity.ts). / EN: Personal identity: name and key pair (see src/node/identity.ts). */
  identity: string
  /** Budget giornaliero dell'LLM, condiviso da tutti i team. / EN: Daily LLM budget, shared by all teams. */
  machine: string
  /** Cartella che contiene una sottocartella per team. / EN: Folder holding one subfolder per team. */
  teams: string
}

export function hostFiles (root: NodePaths): HostFiles {
  return {
    identity: path.join(root.home, 'identity.json'),
    machine: path.join(root.home, 'machine.db'),
    teams: path.join(root.home, 'teams')
  }
}

/**
 * Percorsi di un team nella struttura a più team: dati in `teams/<id>/`, ma configurazione
 * della macchina e log restano quelli della radice.
 *
 * EN: Paths of a team in the multi-team layout: data in `teams/<id>/`, but the machine configuration and the
 * logs stay those of the root.
 */
export function teamPaths (root: NodePaths, id: string): NodePaths {
  const dir = path.join(hostFiles(root).teams, id)
  return {
    home: dir,
    config: root.config,
    settings: path.join(dir, 'settings.json'),
    state: path.join(dir, 'state.json'),
    store: path.join(dir, 'corestore'),
    index: path.join(dir, 'view.db'),
    private: path.join(dir, 'private.db'),
    export: path.join(dir, 'export'),
    logs: root.logs
  }
}

/**
 * Rende la cartella di Micelio accessibile solo all'utente corrente (0700) su macOS e Linux, anche
 * se esisteva già con permessi più larghi. Basta la cartella: senza il permesso di attraversarla
 * gli altri utenti non raggiungono nessun file dentro, qualunque sia il suo modo. Su Windows non
 * fa niente: la cartella sta nel profilo utente, protetto dalle sue ACL.
 *
 * EN: Makes Micelio's folder accessible only to the current user (0700) on macOS and Linux, even
 * if it already existed with looser permissions. The folder is enough: without the permission to
 * traverse it, other users can't reach any file inside, whatever its mode. On Windows it does
 * nothing: the folder is in the user profile, protected by its ACLs.
 *
 * Revisione di sicurezza 2026-10-26: i ricordi in chiaro (view.db, private.db) erano leggibili
 * dagli altri utenti dello stesso PC, con l'umask predefinito.
 *
 * EN: Security review 2026-10-26: the plain-text memories (view.db, private.db) were readable by
 * other users of the same PC, with the default umask.
 */
export function protectHome (home: string, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') return
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  fs.chmodSync(home, 0o700)
}
