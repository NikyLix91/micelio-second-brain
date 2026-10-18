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
 *   eventuali proxy e per accorgerci dei client che se ne sono andati;
 * - con più team (B3) lo stream riguarda il team della richiesta (intestazione x-micelio-team):
 *   arrivano solo i suoi eventi, più `teams` quando cambia l'elenco dei team (nome, ruolo,
 *   team aggiunto o tolto), che serve al selettore dei team.
 */
import { Controller, Get, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import type { HostChange } from '../node/micelio-host'
import type { MicelioNode } from '../node/micelio-node'
import { MicelioService } from './micelio.service'
import { teamContext } from './team-context'

const PING_INTERVAL_MS = 25_000

@Controller('api')
export class EventsController {
  constructor (private readonly micelio: MicelioService) {}

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

    // Il team dello stream si risolve a ogni evento: il predefinito può cambiare mentre è aperto.
    const ref = teamContext.getStore()
    const nodeOf = (team?: string | null): MicelioNode | null => { try { return this.micelio.host.node(team) } catch { return null } }
    const onChange = ({ team, topic }: HostChange) => {
      if (team !== null && nodeOf(team) !== nodeOf(ref)) return
      res.write(`event: change\ndata: ${JSON.stringify({ topic })}\n\n`)
    }
    this.micelio.host.on('change', onChange)
    const ping = setInterval(() => res.write(': ping\n\n'), PING_INTERVAL_MS)

    // Alla disconnessione del client togliamo listener e timer.
    req.on('close', () => {
      clearInterval(ping)
      this.micelio.host.off('change', onChange)
    })
  }
}
