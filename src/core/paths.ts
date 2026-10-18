/**
 * @file Percorsi locali di un nodo (DESIGN §13).
 *
 * Tutti i dati di un nodo stanno sotto una sola cartella "home" (default `~/.micelio`).
 * La variabile MICELIO_HOME (o l'opzione `--home` della CLI) permette di avere più nodi sulla
 * stessa macchina senza interferenze: è così che girano i test e i container.
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
 * `<id>` è un identificativo LOCALE (8 caratteri esadecimali casuali): non deriva dalle chiavi
 * del team, così il nome della cartella non rivela niente.
 * Prima di B3 i file di un team stavano direttamente nella home: `MicelioHost` li sposta in
 * `teams/<id>/` al primo avvio (vedi src/node/micelio-host.ts).
 */
import os from 'node:os'
import path from 'node:path'

/** Mappa dei file e delle cartelle di un nodo (di UN team). */
export interface NodePaths {
  /** Cartella del nodo: la home (struttura a un team) o `teams/<id>/`. */
  home: string
  /** Configurazione della macchina (porta, token, LLM). Non replicata. */
  config: string
  /**
   * Impostazioni locali del team (cartelle opt-in, rete, dreaming). Nella struttura a un solo
   * team coincide con `config`: tutto sta in config.json, come prima di B3.
   */
  settings: string
  /** Chiavi del team (incluso quella di cifratura!). Da proteggere come una password. */
  state: string
  /** Corestore: i feed Hypercore del team replicati da Autobase. */
  store: string
  /** Indice di ricerca SQLite, DERIVATO dalla vista: si può cancellare e viene ricostruito. */
  index: string
  /** Archivio privato SQLite: inbox, decisioni, coda lavori, budget. Mai replicato. */
  private: string
  /** Export Markdown in sola lettura. */
  export: string
  /** Log del daemon quando è avviato in background. */
  logs: string
}

/**
 * Calcola i percorsi del nodo nella struttura a un solo team (tutto nella home).
 * È anche la "radice" da cui partono `hostFiles` e `teamPaths`.
 * @param home cartella radice; default MICELIO_HOME o ~/.micelio
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

/** File della macchina che valgono per tutti i team (B3). */
export interface HostFiles {
  /** Identità personale: nome e coppia di chiavi (vedi src/node/identity.ts). */
  identity: string
  /** Budget giornaliero dell'LLM, condiviso da tutti i team. */
  machine: string
  /** Cartella che contiene una sottocartella per team. */
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
