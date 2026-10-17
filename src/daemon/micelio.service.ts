/**
 * @file Provider NestJS che possiede il MicelioNode e ne gestisce il ciclo di vita.
 *
 * NestJS chiama `onApplicationBootstrap` dopo aver creato tutti i moduli (avvio del nodo: rete,
 * indice, worker di ingestione) e `onApplicationShutdown` alla chiusura dell'app (chiusura
 * ordinata: worker, rete, database). I controller accedono al nodo tramite `this.micelio.node`.
 */
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common'
import { MicelioNode } from '../node/micelio-node'
import type { DaemonOptions } from './micelio.module'
import { DAEMON_OPTIONS } from './tokens'

@Injectable()
export class MicelioService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Micelio')
  readonly node: MicelioNode

  /** Le opzioni arrivano da MicelioModule.forRoot tramite il token DAEMON_OPTIONS. */
  constructor (@Inject(DAEMON_OPTIONS) options: DaemonOptions) {
    this.node = new MicelioNode(options.paths, {
      bootstrap: options.bootstrap,
      // I log del nodo finiscono nel logger di NestJS (console o daemon.log).
      log: (m) => this.logger.log(m)
    })
  }

  async onApplicationBootstrap (): Promise<void> {
    await this.node.start()
  }

  async onApplicationShutdown (): Promise<void> {
    await this.node.stop()
  }
}
