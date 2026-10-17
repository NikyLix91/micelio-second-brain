import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common'
import { MicelioNode } from '../node/micelio-node'
import type { DaemonOptions } from './micelio.module'
import { DAEMON_OPTIONS } from './tokens'

/** Ciclo di vita del nodo Micelio dentro il daemon NestJS. */
@Injectable()
export class MicelioService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Micelio')
  readonly node: MicelioNode

  constructor (@Inject(DAEMON_OPTIONS) private readonly options: DaemonOptions) {
    this.node = new MicelioNode(options.paths, {
      bootstrap: options.bootstrap,
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
