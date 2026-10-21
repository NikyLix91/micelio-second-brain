/**
 * @file Modulo NestJS del daemon.
 *
 * EN: NestJS module of the daemon.
 *
 * È un "dynamic module": `forRoot(options)` riceve percorsi, configurazione e bootstrap DHT al
 * momento dell'avvio (src/daemon/main.ts) e li rende iniettabili con il token DAEMON_OPTIONS.
 *
 * EN: It is a "dynamic module": `forRoot(options)` receives paths, configuration and DHT bootstrap at
 * startup (src/daemon/main.ts) and makes them injectable with the DAEMON_OPTIONS token.
 *
 * Registra globalmente:
 * - TokenGuard  (APP_GUARD):  ogni rotta dei controller richiede il token, salvo quelle marcate
 *   PUBLIC_ROUTE. NB: i file statici della UI non passano dai controller, quindi sono pubblici
 *   (contengono solo codice dell'interfaccia, nessun dato);
 * - ErrorFilter (APP_FILTER): errori → JSON `{ error }` con lo status giusto.
 *
 * EN: It registers globally:
 * - TokenGuard  (APP_GUARD):  every controller route requires the token, except those marked
 *   PUBLIC_ROUTE. Note: the UI static files do not go through the controllers, so they are public
 *   (they contain only interface code, no data);
 * - ErrorFilter (APP_FILTER): errors → JSON `{ error }` with the right status.
 *
 * La UI compilata (dist/ui, prodotta da `npm run build -w ui`) viene servita su /ui se esiste.
 * Nei test e nelle esecuzioni da sorgente la cartella non c'è e il modulo statico non si carica.
 *
 * EN: The built UI (dist/ui, produced by `npm run build -w ui`) is served on /ui if it exists.
 * In tests and when running from source the folder is missing and the static module is not loaded.
 */
import fs from 'node:fs'
import path from 'node:path'
import { type DynamicModule, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common'
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
import { teamMiddleware } from './team-context'
import { DAEMON_OPTIONS } from './tokens'
import { UiController } from './ui.controller'
import { UiLinkService } from './ui-link.service'

/** Parametri di avvio del daemon. / EN: Daemon startup parameters. */
export interface DaemonOptions {
  paths: NodePaths
  config: Config
  /**
   * Nodi bootstrap DHT per TUTTI i team (test). Assente = ognuno usa la rete scelta nelle sue
   * impostazioni (o MICELIO_DHT_BOOTSTRAP).
   *
   * EN: DHT bootstrap nodes for ALL teams (tests). Missing = each team uses the network chosen in its
   * settings (or MICELIO_DHT_BOOTSTRAP).
   */
  bootstrap?: { host: string, port: number }[]
}

/** Cartella della UI compilata: dist/ui, accanto a dist/daemon. / EN: Folder of the built UI: dist/ui, next to dist/daemon. */
export const UI_DIR = path.join(__dirname, '..', 'ui')

@Module({})
export class MicelioModule implements NestModule {
  /** Team della richiesta (intestazione x-micelio-team) per tutte le rotte: vedi team-context.ts. / EN: Request team (x-micelio-team header) for all routes: see team-context.ts. */
  configure (consumer: MiddlewareConsumer): void {
    consumer.apply(teamMiddleware).forRoutes('*')
  }

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
