/**
 * @file Shim MCP su stdio (Fase 7): `micelio mcp`.
 *
 * Alcuni client AI (o alcune loro versioni) supportano solo server MCP lanciati come processo e
 * collegati via stdin/stdout. Questo shim è quel processo: espone su stdio GLI STESSI tool del
 * daemon, inoltrando ogni richiesta all'endpoint HTTP locale (POST /mcp) con il token.
 *
 * Non contiene logica propria: elenco dei tool, descrizioni e istruzioni arrivano dal daemon,
 * quindi restano sempre allineati. Se il daemon non è attivo, il client vede un errore chiaro.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

/**
 * Avvia lo shim: collega un client MCP al daemon (HTTP) e un server MCP su stdio.
 * @param mcpUrl es. http://127.0.0.1:7337/mcp
 * @param token  token del daemon (da config.json)
 */
export async function runStdioProxy (mcpUrl: string, token: string): Promise<void> {
  const upstream = new Client({ name: 'micelio-stdio', version: '0.3.0' })
  try {
    await upstream.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
  } catch {
    // Su stdio non si può stampare liberamente (stdout è il canale MCP): l'errore va su stderr.
    process.stderr.write(`Micelio: il daemon non risponde su ${mcpUrl}. Avvialo con \`micelio start\`.\n`)
    process.exit(1)
  }

  const server = new Server(
    { name: 'micelio', version: '0.3.0' },
    { capabilities: { tools: {} }, instructions: upstream.getInstructions() }
  )
  // Inoltro puro: la risposta del daemon torna al client così com'è.
  server.setRequestHandler(ListToolsRequestSchema, async () => await upstream.listTools())
  server.setRequestHandler(CallToolRequestSchema, async (req) => await upstream.callTool(req.params) as any)
  await server.connect(new StdioServerTransport())
}
