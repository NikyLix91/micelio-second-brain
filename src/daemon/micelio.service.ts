/**
 * @file Provider NestJS che possiede il MicelioHost (tutti i team del PC) e ne gestisce il ciclo di vita.
 *
 * EN: NestJS provider that owns the MicelioHost (all the PC's teams) and manages its lifecycle.
 *
 * NestJS chiama `onApplicationBootstrap` dopo aver creato tutti i moduli (avvio dei team: rete,
 * indici, worker di ingestione) e `onApplicationShutdown` alla chiusura dell'app (chiusura
 * ordinata). I controller accedono al nodo del team della richiesta con `this.micelio.node`
 * (vedi team-context.ts) e al padrone di casa con `this.micelio.host`.
 *
 * EN: NestJS calls `onApplicationBootstrap` after creating all modules (team startup: network,
 * indexes, ingestion workers) and `onApplicationShutdown` when the app closes (orderly
 * shutdown). Controllers reach the node of the request's team with `this.micelio.node`
 * (see team-context.ts) and the host with `this.micelio.host`.
 */
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common'
import { MicelioHost } from '../node/micelio-host'
import type { MicelioNode } from '../node/micelio-node'
import type { DaemonOptions } from './micelio.module'
import { teamContext } from './team-context'
import { DAEMON_OPTIONS } from './tokens'

@Injectable()
export class MicelioService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Micelio')
  readonly host: MicelioHost

  /** Le opzioni arrivano da MicelioModule.forRoot tramite il token DAEMON_OPTIONS. / EN: Options come from MicelioModule.forRoot through the DAEMON_OPTIONS token. */
  constructor (@Inject(DAEMON_OPTIONS) options: DaemonOptions) {
    this.host = new MicelioHost(options.paths, {
      // Bootstrap solo se imposto da fuori (test); altrimenti ogni team usa la sua rete
      // EN: Bootstrap only if forced from outside (tests); otherwise each team uses its own network
      bootstrap: options.bootstrap,
      // I log dei nodi finiscono nel logger di NestJS (console o daemon.log).
      // EN: Node logs go to the NestJS logger (console or daemon.log).
      log: (m) => this.logger.log(m)
    })
  }

  /** Nodo del team della richiesta in corso (intestazione x-micelio-team, o il predefinito). / EN: Node of the current request's team (x-micelio-team header, or the default one). */
  get node (): MicelioNode {
    return this.host.node(teamContext.getStore())
  }

  async onApplicationBootstrap (): Promise<void> {
    await this.host.start()
  }

  async onApplicationShutdown (): Promise<void> {
    await this.host.stop()
  }
}
