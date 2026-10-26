/**
 * @file Client HTTP della CLI verso il daemon locale.
 *
 * EN: HTTP client from the CLI to the local daemon.
 *
 * La CLI non apre mai la rete P2P né i database: parla sempre con il daemon, che è l'unico
 * processo che li possiede. Così CLI, MCP e (in futuro) UI vedono lo stesso stato e non si
 * contendono i file.
 *
 * EN: The CLI never opens the P2P network or the databases: it always talks to the daemon, which
 * is the only process that owns them. This way CLI, MCP and (in the future) UI see the same state
 * and don't fight over the files.
 */
import { impostorMessage, verifyDaemon } from '../core/daemon-proof'
import type { NodePaths } from '../core/paths'
import { loadConfig, type Config } from '../node/config'

/** Intestazione con cui si indica il team della richiesta (vedi src/daemon/team-context.ts). / EN: Header that names the team of the request (see src/daemon/team-context.ts). */
const TEAM_HEADER = 'x-micelio-team'

/** Errore da mostrare all'utente così com'è (senza stack trace). / EN: Error to show to the user as is (without stack trace). */
export class DaemonError extends Error {}

export class DaemonClient {
  readonly config: Config
  /** URL base del daemon, es. http://127.0.0.1:7337 / EN: Base URL of the daemon, e.g. http://127.0.0.1:7337 */
  readonly baseUrl: string

  /**
   * @param team team su cui lavorare (id o nome, opzione `--team`); assente = il predefinito
   *             EN: team to work on (id or name, `--team` option); missing = the default one
   */
  constructor (paths: NodePaths, readonly team?: string) {
    this.config = loadConfig(paths)
    // Un daemon in ascolto su 0.0.0.0 (container) si raggiunge comunque via 127.0.0.1.
    // EN: A daemon listening on 0.0.0.0 (container) is still reachable via 127.0.0.1.
    const host = this.config.host === '0.0.0.0' ? '127.0.0.1' : this.config.host
    this.baseUrl = `http://${host}:${this.config.port}`
  }

  /**
   * URL dell'endpoint MCP, da dare ai client AI: `/mcp` (team predefinito) o, con `--team`,
   * `/mcp/<team>` (B3).
   *
   * EN: URL of the MCP endpoint, to give to AI clients: `/mcp` (default team) or, with `--team`,
   * `/mcp/<team>` (B3).
   */
  get mcpUrl (): string { return `${this.baseUrl}/mcp${this.team ? '/' + encodeURIComponent(this.team) : ''}` }

  /** true se il daemon risponde entro 1 secondo. Non richiede il token. / EN: true if the daemon answers within 1 second. Doesn't require the token. */
  async health (): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) })
      return res.ok
    } catch {
      return false
    }
  }

  /**
   * Verifica che sulla porta risponda il daemon di questo utente prima di mandargli il token.
   *
   * EN: Checks that this user's daemon answers on the port before sending it the token.
   * @throws DaemonError se non risponde nessuno, o se risponde un impostore
   *         EN: if nobody answers, or if an impostor answers
   */
  async requireOwnDaemon (): Promise<void> {
    if (await verifyDaemon(this.baseUrl, this.config.token)) return
    if (!(await this.health())) throw new DaemonError(`Il daemon Micelio non risponde su ${this.baseUrl}. Avvialo con \`micelio start\`.`)
    throw new DaemonError(impostorMessage(this.baseUrl).it)
  }

  /**
   * Chiama una rotta dell'API con il token.
   *
   * EN: Calls an API route with the token.
   *
   * @param timeoutMs il default è alto perché `join` può attendere fino a 2 minuti un membro online
   *                  EN: the default is high because `join` can wait up to 2 minutes for an online member
   * @throws DaemonError con il messaggio del daemon, o con istruzioni se il daemon non risponde
   *         EN: with the daemon's message, or with instructions if the daemon doesn't answer
   */
  async call<T = any> (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, timeoutMs = 180_000): Promise<T> {
    // Il token parte solo verso il NOSTRO daemon (0.6.2, vedi src/core/daemon-proof.ts)
    // EN: The token goes only to OUR daemon (0.6.2, see src/core/daemon-proof.ts)
    await this.requireOwnDaemon()
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.config.token}`,
          ...(this.team ? { [TEAM_HEADER]: this.team } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch {
      throw new DaemonError(`Il daemon Micelio non risponde su ${this.baseUrl}. Avvialo con \`micelio start\`.`)
    }
    const data = await res.json().catch(() => ({})) as any
    if (!res.ok) throw new DaemonError(data?.error ?? `HTTP ${res.status}`)
    return data as T
  }
}
