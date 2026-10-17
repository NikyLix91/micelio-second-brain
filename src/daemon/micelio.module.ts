import { type DynamicModule, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import type { NodePaths } from '../core/paths'
import type { Config } from '../node/config'
import { ApiController } from './api.controller'
import { TokenGuard } from './auth.guard'
import { ErrorFilter } from './error.filter'
import { McpController } from './mcp.controller'
import { MicelioService } from './micelio.service'
import { DAEMON_OPTIONS } from './tokens'

export interface DaemonOptions {
  paths: NodePaths
  config: Config
  bootstrap?: { host: string, port: number }[]
}

@Module({})
export class MicelioModule {
  static forRoot (options: DaemonOptions): DynamicModule {
    return {
      module: MicelioModule,
      controllers: [ApiController, McpController],
      providers: [
        { provide: DAEMON_OPTIONS, useValue: options },
        MicelioService,
        { provide: APP_GUARD, useClass: TokenGuard },
        { provide: APP_FILTER, useClass: ErrorFilter }
      ]
    }
  }
}
