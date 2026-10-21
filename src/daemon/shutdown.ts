/**
 * @file Segnale interno di chiusura ordinata del daemon.
 *
 * EN: Internal signal for an orderly daemon shutdown.
 *
 * Perché non usare i segnali del sistema operativo: su Windows `process.kill(pid, 'SIGTERM')`
 * termina il processo all'istante, senza eseguire alcun handler. Database e feed resterebbero
 * chiusi male. Quindi /api/shutdown emette questo evento e main.ts chiama `app.close()`, che
 * attiva gli hook di chiusura di NestJS (MicelioService.onApplicationShutdown).
 *
 * EN: Why not use OS signals: on Windows `process.kill(pid, 'SIGTERM')` kills the process
 * instantly, without running any handler. Databases and feeds would be left improperly closed.
 * So /api/shutdown emits this event and main.ts calls `app.close()`, which triggers the NestJS
 * shutdown hooks (MicelioService.onApplicationShutdown).
 */
import { EventEmitter } from 'node:events'

export const shutdownSignal = new EventEmitter()
