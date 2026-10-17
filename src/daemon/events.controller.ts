/**
 * @file Canale di eventi in tempo reale per la UI: GET /api/events (Server-Sent Events).
 *
 * Il MicelioNode emette `change` con un argomento (ChangeTopic: memories, inbox, jobs…) ogni
 * volta che il suo stato cambia. Qui li inoltriamo a ogni client connesso come eventi SSE:
 *
 *   event: change
 *   data: {"topic":"inbox"}
 *
 * La UI reagisce ricaricando SOLO i dati di quell'argomento (niente polling continuo).
 *
 * Note:
 * - l'autenticazione è il normale header Bearer (TokenGuard): la UI usa `fetch` in streaming
 *   e non `EventSource`, che non permette di impostare header. Così il token non finisce mai
 *   in un URL;
 * - ogni 25 s inviamo un commento (`: ping`) per tenere viva la connessione attraverso
 *   eventuali proxy e per accorgerci dei client che se ne sono andati.
 */
import { Controller, Get, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import type { ChangeTopic } from '../node/micelio-node'
import { MicelioService } from './micelio.service'

const PING_INTERVAL_MS = 25_000

@Controller('api')
export class EventsController {
  constructor (private readonly micelio: MicelioService) {
    // Ogni client SSE aggiunge un listener: alziamo il limite che fa scattare l'avviso di
    // "possibile memory leak" di EventEmitter (10 di default).
    this.micelio.node.setMaxListeners(100)
  }

  /** Apre lo stream. Resta aperto finché il client non si disconnette. */
  @Get('events')
  stream (@Req() req: Request, @Res() res: Response): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })
    // Primo evento: conferma al client che lo stream è attivo.
    res.write('event: hello\ndata: {}\n\n')

    const onChange = (topic: ChangeTopic) => res.write(`event: change\ndata: ${JSON.stringify({ topic })}\n\n`)
    this.micelio.node.on('change', onChange)
    const ping = setInterval(() => res.write(': ping\n\n'), PING_INTERVAL_MS)

    // Alla disconnessione del client togliamo listener e timer.
    req.on('close', () => {
      clearInterval(ping)
      this.micelio.node.off('change', onChange)
    })
  }
}
