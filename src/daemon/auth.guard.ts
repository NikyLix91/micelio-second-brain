/**
 * @file Guard globale: ogni rotta (API e MCP) richiede `Authorization: Bearer <token>`.
 *
 * EN: Global guard: every route (API and MCP) requires `Authorization: Bearer <token>`.
 *
 * Il token sta in ~/.micelio/config.json. Protegge da due cose:
 * - altri utenti o processi della stessa macchina che non possono leggere quel file;
 * - pagine web aperte nel browser: una pagina può fare richieste a 127.0.0.1, ma non può
 *   aggiungere l'header Authorization senza un preflight CORS, che il daemon non concede.
 *
 * EN: The token lives in ~/.micelio/config.json. It protects against two things:
 * - other users or processes on the same machine that cannot read that file;
 * - web pages open in the browser: a page can send requests to 127.0.0.1, but it cannot
 *   add the Authorization header without a CORS preflight, which the daemon does not grant.
 */
import { timingSafeEqual } from 'node:crypto'
import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import type { DaemonOptions } from './micelio.module'
import { DAEMON_OPTIONS, PUBLIC_ROUTE } from './tokens'

@Injectable()
export class TokenGuard implements CanActivate {
  /** Valore atteso dell'header, precalcolato una volta sola. / EN: Expected header value, computed once. */
  private readonly expected: Buffer

  constructor (@Inject(DAEMON_OPTIONS) options: DaemonOptions, private readonly reflector: Reflector) {
    this.expected = Buffer.from(`Bearer ${options.config.token}`)
  }

  canActivate (ctx: ExecutionContext): boolean {
    // Rotte marcate pubbliche sul metodo o sulla classe del controller.
    // EN: Routes marked public on the controller method or class.
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [ctx.getHandler(), ctx.getClass()])) return true
    const header = Buffer.from(ctx.switchToHttp().getRequest<Request>().headers.authorization ?? '')
    // timingSafeEqual: confronto a tempo costante, così il tempo di risposta non rivela quanti
    // caratteri del token sono corretti. Richiede buffer della stessa lunghezza.
    // EN: timingSafeEqual: constant-time comparison, so the response time does not reveal how many
    //     token characters are correct. It needs buffers of the same length.
    if (header.length === this.expected.length && timingSafeEqual(header, this.expected)) return true
    throw new UnauthorizedException('Token Micelio mancante o non valido')
  }
}
