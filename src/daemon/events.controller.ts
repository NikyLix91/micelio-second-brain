/**
 * @file Canale di eventi in tempo reale per la UI: GET /api/events (Server-Sent Events).
 *
 * EN: Real-time event channel for the UI: GET /api/events (Server-Sent Events).
 *
 * Il MicelioNode emette `change` con un argomento (ChangeTopic: memories, inbox, jobs…) ogni
 * volta che il suo stato cambia. Qui li inoltriamo a ogni client connesso come eventi SSE:
 *
 * EN: The MicelioNode emits `change` with a topic (ChangeTopic: memories, inbox, jobs…) every
 * time its state changes. Here we forward them to every connected client as SSE events:
 *
 *   event: change
 *   data: {"topic":"inbox"}
 *
 * La UI reagisce ricaricando SOLO i dati di quell'argomento (niente polling continuo).
 *
 * EN: The UI reacts by reloading ONLY the data of that topic (no continuous polling).
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
 *
 * EN: Notes:
 * - authentication is the usual Bearer header (TokenGuard): the UI uses streaming `fetch`
 *   and not `EventSource`, which doesn't allow setting headers. This way the token never ends
 *   up in a URL;
 * - every 25 s we send a comment (`: ping`) to keep the connection alive through any proxies
 *   and to notice clients that have gone away;
 * - with several teams (B3) the stream concerns the team of the request (x-micelio-team header):
 *   only its events arrive, plus `teams` when the team list changes (name, role, team added
 *   or removed), which the team selector needs.
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

  /** Apre lo stream. Resta aperto finché il client non si disconnette. / EN: Opens the stream. It stays open until the client disconnects. */
  @Get('events')
  stream (@Req() req: Request, @Res() res: Response): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })
    // Primo evento: conferma al client che lo stream è attivo.
    // EN: First event: confirms to the client that the stream is active.
    res.write('event: hello\ndata: {}\n\n')

    // Il team dello stream si risolve a ogni evento: il predefinito può cambiare mentre è aperto.
    // EN: The stream's team is resolved on every event: the default one can change while it is open.
    const ref = teamContext.getStore()
    const nodeOf = (team?: string | null): MicelioNode | null => { try { return this.micelio.host.node(team) } catch { return null } }
    const onChange = ({ team, topic }: HostChange) => {
      if (team !== null && nodeOf(team) !== nodeOf(ref)) return
      res.write(`event: change\ndata: ${JSON.stringify({ topic })}\n\n`)
    }
    this.micelio.host.on('change', onChange)
    const ping = setInterval(() => res.write(': ping\n\n'), PING_INTERVAL_MS)

    // Alla disconnessione del client togliamo listener e timer.
    // EN: When the client disconnects we remove the listener and the timer.
    req.on('close', () => {
      clearInterval(ping)
      this.micelio.host.off('change', onChange)
    })
  }
}
