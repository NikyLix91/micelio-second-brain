/**
 * @file Endpoint MCP su Streamable HTTP (POST /mcp).
 *
 * Modalità STATELESS: per ogni richiesta HTTP creiamo un McpServer e un trasporto nuovi, li
 * colleghiamo, gestiamo la richiesta e chiudiamo tutto quando la risposta è finita. Niente
 * sessioni da ricordare, niente stream SSE: per un servizio locale con pochi client è la
 * soluzione più semplice e robusta. L'SDK MCP lo supporta con `sessionIdGenerator: undefined`.
 *
 * L'autenticazione (token Bearer) la fa il TokenGuard globale, prima di arrivare qui.
 */
import { All, Controller, Post, Req, Res } from '@nestjs/common'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Request, Response } from 'express'
import { createMcpServer } from '../mcp/mcp-server'
import { MicelioService } from './micelio.service'

@Controller('mcp')
export class McpController {
  constructor (private readonly micelio: MicelioService) {}

  /**
   * Gestisce un messaggio JSON-RPC MCP. Usiamo @Res(): la risposta la scrive il trasporto MCP,
   * non NestJS (che altrimenti proverebbe a serializzare il valore di ritorno).
   */
  @Post()
  async handle (@Req() req: Request, @Res() res: Response): Promise<void> {
    const server = createMcpServer(this.micelio.node)
    // enableJsonResponse: risposta JSON semplice invece di uno stream SSE.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    // Alla chiusura della risposta liberiamo server e trasporto di questa richiesta.
    res.on('close', () => {
      transport.close().catch(() => {})
      server.close().catch(() => {})
    })
    await server.connect(transport)
    // req.body è già stato parsato dal body parser JSON di NestJS: lo passiamo al trasporto.
    await transport.handleRequest(req, res, req.body)
  }

  /** In modalità stateless non esistono stream (GET) né sessioni da chiudere (DELETE): 405. */
  @All()
  notAllowed (@Res() res: Response): void {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null })
  }
}
