/**
 * @file Rotte di servizio della UI: link monouso per il browser e redirect della radice.
 * I file statici della UI (cartella dist/ui) li serve ServeStaticModule (vedi micelio.module.ts).
 *
 * EN: UI service routes: one-time links for the browser and the root redirect.
 * The UI static files (dist/ui folder) are served by ServeStaticModule (see micelio.module.ts).
 */
import { Body, Controller, Get, HttpCode, Inject, Post, Res, SetMetadata, UnauthorizedException } from '@nestjs/common'
import type { Response } from 'express'
import { z } from 'zod'
import type { DaemonOptions } from './micelio.module'
import { DAEMON_OPTIONS, PUBLIC_ROUTE } from './tokens'
import { UiLinkService } from './ui-link.service'

const ExchangeBody = z.object({ code: z.string().min(16).max(64) })

@Controller()
export class UiController {
  constructor (
    @Inject(DAEMON_OPTIONS) private readonly options: DaemonOptions,
    private readonly links: UiLinkService
  ) {}

  /** La radice porta alla UI: aprire http://127.0.0.1:7337 nel browser "funziona". / EN: The root leads to the UI: opening http://127.0.0.1:7337 in the browser "just works". */
  @Get()
  @SetMetadata(PUBLIC_ROUTE, true)
  root (@Res() res: Response): void {
    res.redirect('/ui/')
  }

  /**
   * Crea un link monouso per aprire la UI nel browser (richiede il token: lo chiama la CLI).
   * L'URL usa 127.0.0.1 anche se il daemon ascolta su 0.0.0.0 (container).
   *
   * EN: Creates a one-time link to open the UI in the browser (requires the token: the CLI calls it).
   * The URL uses 127.0.0.1 even if the daemon listens on 0.0.0.0 (container).
   */
  @Post('api/ui/link')
  @HttpCode(200)
  link (): { url: string } {
    const { host, port } = this.options.config
    const h = host === '0.0.0.0' ? '127.0.0.1' : host
    return { url: `http://${h}:${port}/ui/?code=${this.links.create()}` }
  }

  /** Scambia un codice monouso con il token. Pubblica per forza: la pagina non ha ancora il token. / EN: Exchanges a one-time code for the token. Necessarily public: the page doesn't have the token yet. */
  @Post('api/ui/exchange')
  @HttpCode(200)
  @SetMetadata(PUBLIC_ROUTE, true)
  exchange (@Body() body: unknown): { token: string } {
    const { code } = ExchangeBody.parse(body)
    if (!this.links.consume(code)) throw new UnauthorizedException('Link scaduto o già usato: riesegui `micelio ui`')
    return { token: this.options.config.token }
  }
}
