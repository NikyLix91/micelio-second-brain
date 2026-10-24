/**
 * @file Shim MCP su stdio (Fase 7): `micelio mcp`.
 *
 * EN: MCP shim over stdio (Phase 7): `micelio mcp`.
 *
 * Alcuni client AI (o alcune loro versioni) supportano solo server MCP lanciati come processo e
 * collegati via stdin/stdout. Questo shim è quel processo: espone su stdio GLI STESSI tool del
 * daemon, inoltrando ogni richiesta all'endpoint HTTP locale (POST /mcp) con il token.
 *
 * EN: Some AI clients (or some of their versions) only support MCP servers launched as a process
 * and connected over stdin/stdout. This shim is that process: it exposes THE SAME daemon tools
 * over stdio, forwarding every request to the local HTTP endpoint (POST /mcp) with the token.
 *
 * Non contiene logica propria: elenco dei tool, descrizioni e istruzioni arrivano dal daemon,
 * quindi restano sempre allineati. Se il daemon non è attivo, il client vede un errore chiaro.
 *
 * EN: It has no logic of its own: tool list, descriptions and instructions come from the daemon,
 * so they always stay aligned. If the daemon is not running, the client sees a clear error.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

/**
 * Intestazione con la cartella di lavoro dell'agente (codificata con encodeURIComponent).
 *
 * EN: Header carrying the agent's working folder (encoded with encodeURIComponent).
 */
export const CWD_HEADER = 'x-micelio-cwd'

/**
 * Avvia lo shim: collega un client MCP al daemon (HTTP) e un server MCP su stdio.
 *
 * EN: Starts the shim: connects an MCP client to the daemon (HTTP) and an MCP server over stdio.
 *
 * @param mcpUrl es. http://127.0.0.1:7337/mcp
 *               EN: e.g. http://127.0.0.1:7337/mcp
 * @param token  token del daemon (da config.json)
 *               EN: daemon token (from config.json)
 * @param cwd    cartella di lavoro dell'agente: va al daemon a ogni richiesta, che ne ricava il
 *               team (vedi McpController); con `--team` serve al controllo del team di `remember`.
 *               EN: the agent's working folder: it goes to the daemon on every request, which
 *               derives the team from it (see McpController); with `--team` it's used by the
 *               team check of `remember`.
 */
export async function runStdioProxy (mcpUrl: string, token: string, cwd?: string): Promise<void> {
  const upstream = new Client({ name: 'micelio-stdio', version: '0.3.0' })
  // Codificata: un'intestazione HTTP non può contenere lettere accentate
  // EN: Encoded: an HTTP header can't contain accented letters
  const headers: Record<string, string> = { authorization: `Bearer ${token}` }
  if (cwd) headers[CWD_HEADER] = encodeURIComponent(cwd)
  try {
    await upstream.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers } }))
  } catch {
    // Su stdio non si può stampare liberamente (stdout è il canale MCP): l'errore va su stderr.
    // EN: Over stdio we can't print freely (stdout is the MCP channel): the error goes to stderr.
    process.stderr.write(`Micelio: il daemon non risponde su ${mcpUrl}. Avvialo con \`micelio start\`.\n`)
    process.exit(1)
  }

  const server = new Server(
    { name: 'micelio', version: '0.3.0' },
    { capabilities: { tools: {} }, instructions: upstream.getInstructions() }
  )
  // Inoltro puro: la risposta del daemon torna al client così com'è.
  // EN: Pure forwarding: the daemon's response goes back to the client as is.
  server.setRequestHandler(ListToolsRequestSchema, async () => await upstream.listTools())
  server.setRequestHandler(CallToolRequestSchema, async (req) => await upstream.callTool(req.params) as any)
  await server.connect(new StdioServerTransport())
}
