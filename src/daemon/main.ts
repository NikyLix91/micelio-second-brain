/**
 * @file Avvio del daemon: nodo P2P + API locale + endpoint MCP in un'unica app NestJS.
 *
 * EN: Daemon startup: P2P node + local API + MCP endpoint in a single NestJS app.
 *
 * Viene caricato solo da `micelio daemon` (direttamente, o in background tramite `micelio start`)
 * e dai test d'integrazione. `reflect-metadata` deve essere importato prima di NestJS: serve
 * all'iniezione delle dipendenze basata sui tipi (emitDecoratorMetadata).
 *
 * EN: It is loaded only by `micelio daemon` (directly, or in the background via `micelio start`) and by the
 * integration tests. `reflect-metadata` must be imported before NestJS: it is needed for type-based
 * dependency injection (emitDecoratorMetadata).
 */
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { NestFactory } from '@nestjs/core'
import { nodePaths, type NodePaths } from '../core/paths'
import { loadConfig } from '../node/config'
import { MicelioModule } from './micelio.module'
import { shutdownSignal } from './shutdown'

/**
 * Crea e avvia il daemon.
 *
 * EN: Creates and starts the daemon.
 * @param paths percorsi del nodo (default: MICELIO_HOME o ~/.micelio)
 *              EN: node paths (default: MICELIO_HOME or ~/.micelio)
 * @returns l'app NestJS in ascolto (i test la chiudono con `app.close()`)
 *          EN: the listening NestJS app (the tests close it with `app.close()`)
 */
export async function startDaemon (paths: NodePaths = nodePaths()): Promise<NestExpressApplication> {
  const config = loadConfig(paths)
  const app = await NestFactory.create<NestExpressApplication>(
    // Nessun bootstrap globale: ogni team usa la rete delle sue impostazioni (B3)
    // EN: No global bootstrap: each team uses the network from its own settings (B3)
    MicelioModule.forRoot({ paths, config }),
    { logger: ['log', 'warn', 'error'], bodyParser: true }
  )
  // Limite più alto del default (100 kB): i ricordi possono arrivare a 20 kB di testo più metadati,
  // e il ripristino di un backup (B7) invia il file intero in base64 (pochi MB anche per migliaia
  // di ricordi). L'API ascolta solo su questo PC e vuole il token.
  // EN: Limit higher than the default (100 kB): memories can reach 20 kB of text plus metadata, and restoring
  //     a backup (B7) sends the whole file in base64 (a few MB even for thousands of memories). The API only
  //     listens on this PC and requires the token.
  app.useBodyParser('json', { limit: '200mb' })
  // Su macOS/Linux SIGINT/SIGTERM attivano la chiusura ordinata; su Windows vedi shutdown.ts.
  // EN: On macOS/Linux SIGINT/SIGTERM trigger the orderly shutdown; on Windows see shutdown.ts.
  app.enableShutdownHooks()
  await app.listen(config.port, config.host)

  const logger = new Logger('Micelio')
  logger.log(`daemon in ascolto su http://${config.host}:${config.port} (home: ${paths.home})`)
  shutdownSignal.once('shutdown', () => {
    logger.log('chiusura ordinata in corso')
    app.close().then(() => process.exit(0), (err) => { logger.error(err); process.exit(1) })
  })
  return app
}
