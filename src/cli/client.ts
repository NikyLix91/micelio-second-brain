// Client HTTP verso il daemon locale, usato dalla CLI.
import type { NodePaths } from '../core/paths'
import { loadConfig, type Config } from '../node/config'

export class DaemonError extends Error {}

export class DaemonClient {
  readonly config: Config
  readonly baseUrl: string

  constructor (paths: NodePaths) {
    this.config = loadConfig(paths)
    const host = this.config.host === '0.0.0.0' ? '127.0.0.1' : this.config.host
    this.baseUrl = `http://${host}:${this.config.port}`
  }

  get mcpUrl (): string { return `${this.baseUrl}/mcp` }

  async health (): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) })
      return res.ok
    } catch {
      return false
    }
  }

  async call<T = any> (method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.config.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(180_000) // il join può richiedere tempo
      })
    } catch {
      throw new DaemonError(`Il daemon Micelio non risponde su ${this.baseUrl}. Avvialo con \`micelio start\`.`)
    }
    const data = await res.json().catch(() => ({})) as any
    if (!res.ok) throw new DaemonError(data?.error ?? `HTTP ${res.status}`)
    return data as T
  }
}
