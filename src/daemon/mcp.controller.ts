/**
 * @file Endpoint MCP su Streamable HTTP (POST /mcp e POST /mcp/<team>).
 *
 * EN: MCP endpoint over Streamable HTTP (POST /mcp and POST /mcp/<team>).
 *
 * Più team (B3): `/mcp` lavora sul team predefinito; `/mcp/<team>` (id locale o nome) su un team
 * preciso. Per un progetto si registra `/mcp/<team>` nell'ambito "local" di Claude Code
 * (`micelio setup project`), così l'agente di quel progetto vede solo il suo team.
 *
 * EN: Multiple teams (B3): `/mcp` works on the default team; `/mcp/<team>` (local id or name) on a
 * specific team. For a project, `/mcp/<team>` is registered in Claude Code's "local" scope
 * (`micelio setup project`), so the agent of that project sees only its team.
 *
 * Lo shim stdio (`micelio mcp`, registrato da «Collega Claude Code») manda la cartella di lavoro
 * dell'agente nell'intestazione `x-micelio-cwd`: allora `/mcp` usa il team che possiede quella
 * cartella (vedi nodeForRequest), e solo in mancanza il predefinito.
 *
 * EN: The stdio shim (`micelio mcp`, registered by "Connect Claude Code") sends the agent's working
 * folder in the `x-micelio-cwd` header: then `/mcp` uses the team that owns that folder (see
 * nodeForRequest), and the default one only as a fallback.
 *
 * Modalità STATELESS: per ogni richiesta HTTP creiamo un McpServer e un trasporto nuovi, li
 * colleghiamo, gestiamo la richiesta e chiudiamo tutto quando la risposta è finita. Niente
 * sessioni da ricordare, niente stream SSE: per un servizio locale con pochi client è la
 * soluzione più semplice e robusta. L'SDK MCP lo supporta con `sessionIdGenerator: undefined`.
 *
 * EN: STATELESS mode: for each HTTP request we create a new McpServer and transport, connect
 * them, handle the request and close everything when the response is done. No sessions to
 * remember, no SSE streams: for a local service with few clients it is the simplest and most
 * robust solution. The MCP SDK supports it with `sessionIdGenerator: undefined`.
 *
 * L'autenticazione (token Bearer) la fa il TokenGuard globale, prima di arrivare qui.
 *
 * EN: Authentication (Bearer token) is done by the global TokenGuard, before reaching here.
 */
import { All, Controller, Param, Post, Req, Res } from '@nestjs/common'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Request, Response } from 'express'
import { createMcpServer } from '../mcp/mcp-server'
import { CWD_HEADER } from '../mcp/stdio-proxy'
import type { MicelioNode } from '../node/micelio-node'
import { MicelioService } from './micelio.service'

@Controller('mcp')
export class McpController {
  constructor (private readonly micelio: MicelioService) {}

  /**
   * Gestisce un messaggio JSON-RPC MCP. Usiamo @Res(): la risposta la scrive il trasporto MCP,
   * non NestJS (che altrimenti proverebbe a serializzare il valore di ritorno).
   *
   * EN: Handles an MCP JSON-RPC message. We use @Res(): the MCP transport writes the response,
   * not NestJS (which would otherwise try to serialize the return value).
   */
  @Post()
  async handle (@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.serve(this.nodeForRequest(req), req, res)
  }

  /**
   * Cartella di lavoro dell'agente mandata dallo shim stdio (`x-micelio-cwd`), null se assente o
   * malformata (registrazione HTTP vecchia o client diverso dallo shim).
   *
   * EN: The agent's working folder sent by the stdio shim (`x-micelio-cwd`), null if missing or
   * malformed (old HTTP registration or a client other than the shim).
   */
  private cwdOf (req: Request): string | null {
    const raw = req.headers[CWD_HEADER]
    const encoded = Array.isArray(raw) ? raw[0] : raw
    if (!encoded) return null
    try { return decodeURIComponent(encoded) } catch { return null }
  }

  /**
   * Team di una richiesta a `/mcp`. Se lo shim stdio ha mandato la cartella di lavoro
   * dell'agente (intestazione `x-micelio-cwd`), vale il team che la possiede, ricalcolato a ogni
   * richiesta: così vale anche una cartella abilitata a sessione già aperta. Altrimenti il team
   * dell'intestazione `x-micelio-team` o il predefinito, come prima.
   * Bug reale (2026-10-21): senza questa scelta i ricordi salvati da un progetto di un team
   * finivano nel team predefinito, visibili a colleghi che non dovevano vederli.
   *
   * EN: Team of a request to `/mcp`. If the stdio shim sent the agent's working folder
   * (`x-micelio-cwd` header), the team that owns it wins, recomputed on every request: so a
   * folder enabled while a session is already open works too. Otherwise the team from the
   * `x-micelio-team` header or the default one, as before.
   * Real bug (2026-10-21): without this choice, memories saved from a project of one team
   * ended up in the default team, visible to colleagues who should not see them.
   */
  private nodeForRequest (req: Request): MicelioNode {
    const cwd = this.cwdOf(req)
    const owner = cwd ? this.micelio.host.ownerOf(cwd) : null
    if (owner) return this.micelio.host.node(owner)
    return this.micelio.node
  }

  /** MCP di un team preciso: `/mcp/<id o nome del team>`. / EN: MCP of a specific team: `/mcp/<id o nome del team>`. */
  @Post(':team')
  async handleTeam (@Param('team') team: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    let node: MicelioNode
    try {
      node = this.micelio.host.node(team)
    } catch (err) {
      // Team sconosciuto: errore JSON-RPC leggibile dall'agente, invece di un 400 generico
      // EN: Unknown team: a JSON-RPC error the agent can read, instead of a generic 400
      res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: (err as Error).message }, id: null })
      return
    }
    await this.serve(node, req, res)
  }

  /** Collega un McpServer nuovo al nodo del team e gestisce la richiesta. / EN: Connects a new McpServer to the team node and handles the request. */
  private async serve (node: MicelioNode, req: Request, res: Response): Promise<void> {
    // `remember` controlla sempre che la cartella della sessione sia del team (0.6.1)
    // EN: `remember` always checks that the session's folder belongs to the team (0.6.1)
    const cwd = this.cwdOf(req)
    const server = createMcpServer(node, async (input) => await this.micelio.host.rememberFromAgent(node, input, cwd))
    // enableJsonResponse: risposta JSON semplice invece di uno stream SSE.
    // EN: enableJsonResponse: plain JSON response instead of an SSE stream.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    // Alla chiusura della risposta liberiamo server e trasporto di questa richiesta.
    // EN: When the response closes we release the server and transport of this request.
    res.on('close', () => {
      transport.close().catch(() => {})
      server.close().catch(() => {})
    })
    await server.connect(transport)
    // req.body è già stato parsato dal body parser JSON di NestJS: lo passiamo al trasporto.
    // EN: req.body was already parsed by the NestJS JSON body parser: we pass it to the transport.
    await transport.handleRequest(req, res, req.body)
  }

  /** In modalità stateless non esistono stream (GET) né sessioni da chiudere (DELETE): 405. / EN: In stateless mode there are no streams (GET) or sessions to close (DELETE): 405. */
  @All()
  notAllowed (@Res() res: Response): void {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null })
  }
}
