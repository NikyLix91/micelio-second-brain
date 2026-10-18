/**
 * @file Client HTTP della CLI verso il daemon locale.
 *
 * La CLI non apre mai la rete P2P né i database: parla sempre con il daemon, che è l'unico
 * processo che li possiede. Così CLI, MCP e (in futuro) UI vedono lo stesso stato e non si
 * contendono i file.
 */
import type { NodePaths } from '../core/paths'
import { loadConfig, type Config } from '../node/config'

/** Errore da mostrare all'utente così com'è (senza stack trace). */
export class DaemonError extends Error {}

export class DaemonClient {
  readonly config: Config
  /** URL base del daemon, es. http://127.0.0.1:7337 */
  readonly baseUrl: string

  constructor (paths: NodePaths) {
    this.config = loadConfig(paths)
    // Un daemon in ascolto su 0.0.0.0 (container) si raggiunge comunque via 127.0.0.1.
    const host = this.config.host === '0.0.0.0' ? '127.0.0.1' : this.config.host
    this.baseUrl = `http://${host}:${this.config.port}`
  }

  /** URL dell'endpoint MCP, da dare ai client AI. */
  get mcpUrl (): string { return `${this.baseUrl}/mcp` }

  /** true se il daemon risponde entro 1 secondo. Non richiede il token. */
  async health (): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) })
      return res.ok
    } catch {
      return false
    }
  }

  /**
   * Chiama una rotta dell'API con il token.
   * @param timeoutMs il default è alto perché `join` può attendere fino a 2 minuti un membro online
   * @throws DaemonError con il messaggio del daemon, o con istruzioni se il daemon non risponde
   */
  async call<T = any> (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, timeoutMs = 180_000): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.config.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
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
