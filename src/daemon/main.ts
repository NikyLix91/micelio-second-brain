/**
 * @file Avvio del daemon: nodo P2P + API locale + endpoint MCP in un'unica app NestJS.
 *
 * Viene caricato solo da `micelio daemon` (direttamente, o in background tramite `micelio start`)
 * e dai test d'integrazione. `reflect-metadata` deve essere importato prima di NestJS: serve
 * all'iniezione delle dipendenze basata sui tipi (emitDecoratorMetadata).
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
 * @param paths percorsi del nodo (default: MICELIO_HOME o ~/.micelio)
 * @returns l'app NestJS in ascolto (i test la chiudono con `app.close()`)
 */
export async function startDaemon (paths: NodePaths = nodePaths()): Promise<NestExpressApplication> {
  const config = loadConfig(paths)
  const app = await NestFactory.create<NestExpressApplication>(
    // Nessun bootstrap globale: ogni team usa la rete delle sue impostazioni (B3)
    MicelioModule.forRoot({ paths, config }),
    { logger: ['log', 'warn', 'error'], bodyParser: true }
  )
  // Limite più alto del default (100 kB): i ricordi possono arrivare a 20 kB di testo più metadati.
  app.useBodyParser('json', { limit: '1mb' })
  // Su macOS/Linux SIGINT/SIGTERM attivano la chiusura ordinata; su Windows vedi shutdown.ts.
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
