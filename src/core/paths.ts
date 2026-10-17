/**
 * @file Percorsi locali di un nodo (DESIGN §13).
 *
 * Tutti i dati di un nodo stanno sotto una sola cartella "home" (default `~/.micelio`).
 * La variabile MICELIO_HOME (o l'opzione `--home` della CLI) permette di avere più nodi sulla
 * stessa macchina senza interferenze: è così che girano i test e i container.
 */
import os from 'node:os'
import path from 'node:path'

/** Mappa dei file e delle cartelle di un nodo. */
export interface NodePaths {
  /** Cartella radice del nodo. */
  home: string
  /** Configurazione locale (porta, token, LLM, cartelle opt-in). Non replicata. */
  config: string
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
 * Calcola i percorsi del nodo.
 * @param home cartella radice; default MICELIO_HOME o ~/.micelio
 */
export function nodePaths (home = process.env.MICELIO_HOME || path.join(os.homedir(), '.micelio')): NodePaths {
  return {
    home,
    config: path.join(home, 'config.json'),
    state: path.join(home, 'state.json'),
    store: path.join(home, 'corestore'),
    index: path.join(home, 'view.db'),
    private: path.join(home, 'private.db'),
    export: path.join(home, 'export'),
    logs: path.join(home, 'logs')
  }
}
