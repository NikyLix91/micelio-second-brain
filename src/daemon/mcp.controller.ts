// Endpoint MCP su Streamable HTTP, in modalità stateless: ogni richiesta crea un server e un
// trasporto nuovi. Semplice e robusto per un servizio locale con pochi client.
import { All, Controller, Post, Req, Res } from '@nestjs/common'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Request, Response } from 'express'
import { createMcpServer } from '../mcp/mcp-server'
import { MicelioService } from './micelio.service'

@Controller('mcp')
export class McpController {
  constructor (private readonly micelio: MicelioService) {}

  @Post()
  async handle (@Req() req: Request, @Res() res: Response): Promise<void> {
    const server = createMcpServer(this.micelio.node)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      transport.close().catch(() => {})
      server.close().catch(() => {})
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  }

  /** In modalità stateless non esistono stream SSE (GET) né sessioni da chiudere (DELETE). */
  @All()
  notAllowed (@Res() res: Response): void {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null })
  }
}
