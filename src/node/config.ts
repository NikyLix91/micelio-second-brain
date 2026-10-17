// Configurazione locale del nodo (~/.micelio/config.json) e stato del team (state.json).
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { NodePaths } from '../core/paths'

export const DEFAULT_PORT = 7337

const Config = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(DEFAULT_PORT),
  /** Token per l'API locale e per MCP. Persistente, così la configurazione dei client resta valida. */
  token: z.string().min(32)
})
export type Config = z.infer<typeof Config>

const State = z.object({
  nodeName: z.string(),
  baseKey: z.string(),
  encryptionKey: z.string()
})
export type State = z.infer<typeof State>

function readJson (file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function writePrivate (file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // mode 0o600: leggibile solo dall'utente (ignorato su Windows, dove valgono le ACL del profilo).
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 })
}

/** Legge la config, creandola al primo avvio. Le variabili d'ambiente hanno la precedenza. */
export function loadConfig (paths: NodePaths): Config {
  const raw = (readJson(paths.config) ?? {}) as Record<string, unknown>
  if (typeof raw.token !== 'string') {
    raw.token = randomBytes(24).toString('hex')
    writePrivate(paths.config, Config.parse(raw))
  }
  const cfg = Config.parse(raw)
  if (process.env.MICELIO_HOST) cfg.host = process.env.MICELIO_HOST
  if (process.env.MICELIO_PORT) cfg.port = Number(process.env.MICELIO_PORT)
  return cfg
}

export function loadState (paths: NodePaths): State | null {
  const parsed = State.safeParse(readJson(paths.state))
  return parsed.success ? parsed.data : null
}

/** Lo stato contiene la chiave di cifratura del team: va protetto come una password. */
export function saveState (paths: NodePaths, state: State): void {
  writePrivate(paths.state, State.parse(state))
}

/** Nodi bootstrap DHT da MICELIO_DHT_BOOTSTRAP="host:port,host:port" (test o rete privata). */
export function bootstrapFromEnv (): { host: string, port: number }[] | undefined {
  const raw = process.env.MICELIO_DHT_BOOTSTRAP
  if (!raw) return undefined
  return raw.split(',').map((s) => {
    const [host, port] = s.trim().split(':')
    return { host, port: Number(port) }
  })
}
