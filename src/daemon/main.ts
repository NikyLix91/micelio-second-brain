import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { NestFactory } from '@nestjs/core'
import { nodePaths, type NodePaths } from '../core/paths'
import { bootstrapFromEnv, loadConfig } from '../node/config'
import { MicelioModule } from './micelio.module'
import { shutdownSignal } from './shutdown'

/** Avvia il daemon: nodo P2P + API locale + MCP. */
export async function startDaemon (paths: NodePaths = nodePaths()): Promise<NestExpressApplication> {
  const config = loadConfig(paths)
  const app = await NestFactory.create<NestExpressApplication>(
    MicelioModule.forRoot({ paths, config, bootstrap: bootstrapFromEnv() }),
    { logger: ['log', 'warn', 'error'], bodyParser: true }
  )
  app.useBodyParser('json', { limit: '1mb' })
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
