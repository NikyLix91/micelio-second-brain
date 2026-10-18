/**
 * @file Traduce le eccezioni in risposte HTTP JSON `{ error: "messaggio" }`.
 *
 * - HttpException (NestJS, es. 401 del guard) → il suo status;
 * - UserError (nodo non configurato, permessi, input non valido) → 400;
 * - ZodError (body non valido) → 400 con l'elenco dei campi sbagliati;
 * - qualunque altra cosa è un bug → 500, con lo stack nel log del daemon.
 *
 * Lingua: i messaggi per l'utente (LocalizedError) sono in italiano e in inglese; si sceglie con
 * l'intestazione `x-micelio-lang` che la UI invia con ogni richiesta (CLI e MCP: italiano).
 */
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common'
import type { Request, Response } from 'express'
import { LocalizedError } from '../core/errors'
import { ZodError } from 'zod'

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Api')

  catch (err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>()
    const lang = host.switchToHttp().getRequest<Request>()?.headers?.['x-micelio-lang'] as string | undefined
    // Se la risposta è già partita (es. MCP che scrive da sé) non possiamo più cambiarla.
    if (res.headersSent) return
    if (err instanceof HttpException) {
      res.status(err.getStatus()).json({ error: err.message })
    } else if (err instanceof LocalizedError) {
      // UserError e gli altri errori "per l'utente": 400 con il messaggio nella lingua richiesta
      res.status(400).json({ error: err.in(lang) })
    } else if (err instanceof ZodError) {
      res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
    } else {
      this.logger.error((err as Error)?.stack ?? String(err))
      res.status(500).json({ error: (err as Error)?.message ?? 'Errore interno' })
    }
  }
}
