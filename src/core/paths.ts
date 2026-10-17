// Percorsi locali del nodo (DESIGN §13). MICELIO_HOME permette più nodi sulla stessa macchina
// (test, Docker) senza interferenze.
import os from 'node:os'
import path from 'node:path'

export interface NodePaths {
  home: string
  config: string
  state: string
  store: string
  index: string
  export: string
  logs: string
}

export function nodePaths (home = process.env.MICELIO_HOME || path.join(os.homedir(), '.micelio')): NodePaths {
  return {
    home,
    config: path.join(home, 'config.json'),
    state: path.join(home, 'state.json'),
    store: path.join(home, 'corestore'),
    index: path.join(home, 'view.db'),
    export: path.join(home, 'export'),
    logs: path.join(home, 'logs')
  }
}
