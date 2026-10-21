/**
 * @file Traduce le eccezioni in risposte HTTP JSON `{ error: "messaggio" }`.
 *
 * EN: Turns exceptions into JSON HTTP responses `{ error: "messaggio" }`.
 *
 * - HttpException (NestJS, es. 401 del guard) → il suo status;
 * - UserError (nodo non configurato, permessi, input non valido) → 400;
 * - ZodError (body non valido) → 400 con l'elenco dei campi sbagliati;
 * - qualunque altra cosa è un bug → 500, con lo stack nel log del daemon.
 *
 * EN:
 * - HttpException (NestJS, e.g. the guard's 401) → its own status;
 * - UserError (node not configured, permissions, invalid input) → 400;
 * - ZodError (invalid body) → 400 with the list of wrong fields;
 * - anything else is a bug → 500, with the stack in the daemon log.
 *
 * Lingua: i messaggi per l'utente (LocalizedError) sono in italiano e in inglese; si sceglie con
 * l'intestazione `x-micelio-lang` che la UI invia con ogni richiesta (CLI e MCP: italiano).
 *
 * EN: Language: user-facing messages (LocalizedError) exist in Italian and English. The choice comes
 * from the `x-micelio-lang` header the UI sends with every request (CLI and MCP: Italian).
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
    // EN: If the response has already started (e.g. MCP writing on its own) we can no longer change it.
    if (res.headersSent) return
    if (err instanceof HttpException) {
      res.status(err.getStatus()).json({ error: err.message })
    } else if (err instanceof LocalizedError) {
      // UserError e gli altri errori "per l'utente": 400 con il messaggio nella lingua richiesta
      // EN: UserError and the other "user-facing" errors: 400 with the message in the requested language
      res.status(400).json({ error: err.in(lang) })
    } else if (err instanceof ZodError) {
      res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
    } else {
      this.logger.error((err as Error)?.stack ?? String(err))
      res.status(500).json({ error: (err as Error)?.message ?? 'Errore interno' })
    }
  }
}
