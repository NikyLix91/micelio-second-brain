/**
 * @file Segnale interno di chiusura ordinata del daemon.
 *
 * Perché non usare i segnali del sistema operativo: su Windows `process.kill(pid, 'SIGTERM')`
 * termina il processo all'istante, senza eseguire alcun handler. Database e feed resterebbero
 * chiusi male. Quindi /api/shutdown emette questo evento e main.ts chiama `app.close()`, che
 * attiva gli hook di chiusura di NestJS (MicelioService.onApplicationShutdown).
 */
import { EventEmitter } from 'node:events'

export const shutdownSignal = new EventEmitter()
