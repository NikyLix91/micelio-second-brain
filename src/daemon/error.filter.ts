import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common'
import type { Response } from 'express'
import { ZodError } from 'zod'
import { UserError } from '../node/micelio-node'

/** Errori dell'utente → 400 con messaggio leggibile; il resto → 500 loggato. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Api')

  catch (err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>()
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
