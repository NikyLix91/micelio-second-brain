import { EventEmitter } from 'node:events'

/**
 * Segnale di chiusura ordinata. Su Windows process.kill(pid, 'SIGTERM') termina il processo
 * all'istante (niente handler), quindi l'endpoint /api/shutdown emette qui e main.ts chiude l'app.
 */
export const shutdownSignal = new EventEmitter()
