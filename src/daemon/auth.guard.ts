/**
 * @file Guard globale: ogni rotta (API e MCP) richiede `Authorization: Bearer <token>`.
 *
 * Il token sta in ~/.micelio/config.json. Protegge da due cose:
 * - altri utenti o processi della stessa macchina che non possono leggere quel file;
 * - pagine web aperte nel browser: una pagina può fare richieste a 127.0.0.1, ma non può
 *   aggiungere l'header Authorization senza un preflight CORS, che il daemon non concede.
 */
import { timingSafeEqual } from 'node:crypto'
import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import type { DaemonOptions } from './micelio.module'
import { DAEMON_OPTIONS, PUBLIC_ROUTE } from './tokens'

@Injectable()
export class TokenGuard implements CanActivate {
  /** Valore atteso dell'header, precalcolato una volta sola. */
  private readonly expected: Buffer

  constructor (@Inject(DAEMON_OPTIONS) options: DaemonOptions, private readonly reflector: Reflector) {
    this.expected = Buffer.from(`Bearer ${options.config.token}`)
  }

  canActivate (ctx: ExecutionContext): boolean {
    // Rotte marcate pubbliche sul metodo o sulla classe del controller.
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [ctx.getHandler(), ctx.getClass()])) return true
    const header = Buffer.from(ctx.switchToHttp().getRequest<Request>().headers.authorization ?? '')
    // timingSafeEqual: confronto a tempo costante, così il tempo di risposta non rivela quanti
    // caratteri del token sono corretti. Richiede buffer della stessa lunghezza.
    if (header.length === this.expected.length && timingSafeEqual(header, this.expected)) return true
    throw new UnauthorizedException('Token Micelio mancante o non valido')
  }
}
