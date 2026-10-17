/**
 * @file Modulo NestJS del daemon.
 *
 * È un "dynamic module": `forRoot(options)` riceve percorsi, configurazione e bootstrap DHT al
 * momento dell'avvio (src/daemon/main.ts) e li rende iniettabili con il token DAEMON_OPTIONS.
 *
 * Registra globalmente:
 * - TokenGuard  (APP_GUARD):  ogni rotta dei controller richiede il token, salvo quelle marcate
 *   PUBLIC_ROUTE. NB: i file statici della UI non passano dai controller, quindi sono pubblici
 *   (contengono solo codice dell'interfaccia, nessun dato);
 * - ErrorFilter (APP_FILTER): errori → JSON `{ error }` con lo status giusto.
 *
 * La UI compilata (dist/ui, prodotta da `npm run build -w ui`) viene servita su /ui se esiste.
 * Nei test e nelle esecuzioni da sorgente la cartella non c'è e il modulo statico non si carica.
 */
import fs from 'node:fs'
import path from 'node:path'
import { type DynamicModule, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { ServeStaticModule } from '@nestjs/serve-static'
import type { NodePaths } from '../core/paths'
import type { Config } from '../node/config'
import { ApiController } from './api.controller'
import { TokenGuard } from './auth.guard'
import { ErrorFilter } from './error.filter'
import { EventsController } from './events.controller'
import { McpController } from './mcp.controller'
import { MicelioService } from './micelio.service'
import { DAEMON_OPTIONS } from './tokens'
import { UiController } from './ui.controller'
import { UiLinkService } from './ui-link.service'

/** Parametri di avvio del daemon. */
export interface DaemonOptions {
  paths: NodePaths
  config: Config
  /** Nodi bootstrap DHT (test o rete privata). */
  bootstrap?: { host: string, port: number }[]
}

/** Cartella della UI compilata: dist/ui, accanto a dist/daemon. */
export const UI_DIR = path.join(__dirname, '..', 'ui')

@Module({})
export class MicelioModule {
  static forRoot (options: DaemonOptions): DynamicModule {
    const hasUi = fs.existsSync(path.join(UI_DIR, 'index.html'))
    return {
      module: MicelioModule,
      imports: hasUi ? [ServeStaticModule.forRoot({ rootPath: UI_DIR, serveRoot: '/ui' })] : [],
      controllers: [ApiController, EventsController, UiController, McpController],
      providers: [
        { provide: DAEMON_OPTIONS, useValue: options },
        MicelioService,
        UiLinkService,
        { provide: APP_GUARD, useClass: TokenGuard },
        { provide: APP_FILTER, useClass: ErrorFilter }
      ]
    }
  }
}
