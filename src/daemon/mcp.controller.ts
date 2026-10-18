/**
 * @file Endpoint MCP su Streamable HTTP (POST /mcp e POST /mcp/<team>).
 *
 * Più team (B3): `/mcp` lavora sul team predefinito; `/mcp/<team>` (id locale o nome) su un team
 * preciso. Per un progetto si registra `/mcp/<team>` nell'ambito "local" di Claude Code
 * (`micelio setup project`), così l'agente di quel progetto vede solo il suo team.
 *
 * Modalità STATELESS: per ogni richiesta HTTP creiamo un McpServer e un trasporto nuovi, li
 * colleghiamo, gestiamo la richiesta e chiudiamo tutto quando la risposta è finita. Niente
 * sessioni da ricordare, niente stream SSE: per un servizio locale con pochi client è la
 * soluzione più semplice e robusta. L'SDK MCP lo supporta con `sessionIdGenerator: undefined`.
 *
 * L'autenticazione (token Bearer) la fa il TokenGuard globale, prima di arrivare qui.
 */
import { All, Controller, Param, Post, Req, Res } from '@nestjs/common'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Request, Response } from 'express'
import { createMcpServer } from '../mcp/mcp-server'
import type { MicelioNode } from '../node/micelio-node'
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
    await this.serve(this.micelio.node, req, res)
  }

  /** MCP di un team preciso: `/mcp/<id o nome del team>`. */
  @Post(':team')
  async handleTeam (@Param('team') team: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    let node: MicelioNode
    try {
      node = this.micelio.host.node(team)
    } catch (err) {
      // Team sconosciuto: errore JSON-RPC leggibile dall'agente, invece di un 400 generico
      res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: (err as Error).message }, id: null })
      return
    }
    await this.serve(node, req, res)
  }

  /** Collega un McpServer nuovo al nodo del team e gestisce la richiesta. */
  private async serve (node: MicelioNode, req: Request, res: Response): Promise<void> {
    const server = createMcpServer(node)
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
