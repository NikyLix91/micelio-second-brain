/**
 * @file Traduce le eccezioni in risposte HTTP JSON `{ error: "messaggio" }`.
 *
 * - HttpException (NestJS, es. 401 del guard) → il suo status;
 * - UserError (nodo non configurato, permessi, input non valido) → 400;
 * - ZodError (body non valido) → 400 con l'elenco dei campi sbagliati;
 * - qualunque altra cosa è un bug → 500, con lo stack nel log del daemon.
 */
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common'
import type { Response } from 'express'
import { ZodError } from 'zod'
import { UserError } from '../node/micelio-node'

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Api')

  catch (err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>()
    // Se la risposta è già partita (es. MCP che scrive da sé) non possiamo più cambiarla.
    if (res.headersSent) return
    if (err instanceof HttpException) {
      res.status(err.getStatus()).json({ error: err.message })
    } else if (err instanceof UserError) {
      res.status(400).json({ error: err.message })
    } else if (err instanceof ZodError) {
      res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
    } else {
      this.logger.error((err as Error)?.stack ?? String(err))
      res.status(500).json({ error: (err as Error)?.message ?? 'Errore interno' })
    }
  }
}
