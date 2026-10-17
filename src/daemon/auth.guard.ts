import { timingSafeEqual } from 'node:crypto'
import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import type { DaemonOptions } from './micelio.module'
import { DAEMON_OPTIONS, PUBLIC_ROUTE } from './tokens'

/**
 * Tutte le rotte (API e MCP) richiedono `Authorization: Bearer <token>`. Il token sta in
 * ~/.micelio/config.json. Oltre a proteggere da altri utenti della macchina, impedisce a una
 * pagina web di usare il daemon locale (il browser non può aggiungere l'header senza CORS).
 */
@Injectable()
export class TokenGuard implements CanActivate {
  private readonly expected: Buffer

  constructor (@Inject(DAEMON_OPTIONS) options: DaemonOptions, private readonly reflector: Reflector) {
    this.expected = Buffer.from(`Bearer ${options.config.token}`)
  }

  canActivate (ctx: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [ctx.getHandler(), ctx.getClass()])) return true
    const header = Buffer.from(ctx.switchToHttp().getRequest<Request>().headers.authorization ?? '')
    if (header.length === this.expected.length && timingSafeEqual(header, this.expected)) return true
    throw new UnauthorizedException('Token Micelio mancante o non valido')
  }
}
