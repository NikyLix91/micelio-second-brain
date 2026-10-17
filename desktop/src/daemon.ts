/**
 * @file Collegamento dell'app desktop al daemon locale: configurazione, avvio, chiamate API.
 *
 * L'app NON contiene il nodo: lo avvia come processo separato (lo stesso `micelio daemon` della
 * CLI) se non è già in esecuzione. Così chiudere l'app non ferma la sincronizzazione, e CLI,
 * app e Claude Code parlano tutti con lo stesso daemon.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** Radice del progetto (desktop/dist → ../..): da qui si trovano dist/cli e dist/node. */
const ROOT = path.join(__dirname, '..', '..')
const CLI_MAIN = path.join(ROOT, 'dist', 'cli', 'main.js')

// Riusiamo i moduli compilati del daemon per leggere percorsi e configurazione: una sola verità.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { nodePaths } = require(path.join(ROOT, 'dist', 'core', 'paths.js'))
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadConfig } = require(path.join(ROOT, 'dist', 'node', 'config.js'))

export interface DaemonInfo {
  home: string
  baseUrl: string
  token: string
}

/** Percorsi, URL e token del nodo locale (rispetta MICELIO_HOME). */
export function daemonInfo (): DaemonInfo {
  if (!fs.existsSync(CLI_MAIN)) throw new Error(`Daemon non compilato: esegui \`npm run build\` nella cartella del progetto (manca ${CLI_MAIN})`)
  const paths = nodePaths()
  const cfg = loadConfig(paths)
  const host = cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host
  return { home: paths.home, baseUrl: `http://${host}:${cfg.port}`, token: cfg.token }
}

/** true se il daemon risponde. */
export async function isUp (info: DaemonInfo): Promise<boolean> {
  try {
    const res = await fetch(`${info.baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Quale Node usare per il daemon: quello di sistema se c'è (lo stesso della CLI), altrimenti
 * il Node incluso in Electron in modalità "solo Node" (ELECTRON_RUN_AS_NODE). Electron 38
 * include Node 22, sufficiente per `node:sqlite`.
 */
function nodeRuntime (): { cmd: string, env: NodeJS.ProcessEnv } {
  const probe = spawnSync('node', ['--version'], { encoding: 'utf8', windowsHide: true })
  if (!probe.error && probe.status === 0) return { cmd: 'node', env: {} }
  return { cmd: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }
}

/**
 * Avvia il daemon in background se non è già attivo, e attende che risponda (max 30 s).
 * Il processo è staccato dall'app: sopravvive alla sua chiusura, come con `micelio start`.
 */
export async function ensureDaemon (info: DaemonInfo, log: (m: string) => void): Promise<void> {
  if (await isUp(info)) return
  const { cmd, env } = nodeRuntime()
  const logs = path.join(info.home, 'logs')
  fs.mkdirSync(logs, { recursive: true })
  const out = fs.openSync(path.join(logs, 'daemon.log'), 'a')
  log(`avvio del daemon con ${cmd === 'node' ? 'node di sistema' : 'Node di Electron'}`)
  spawn(cmd, [CLI_MAIN, 'daemon'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, ...env, MICELIO_HOME: info.home, NO_COLOR: '1' },
    windowsHide: true
  }).unref()
  for (let i = 0; i < 60; i++) {
    if (await isUp(info)) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Il daemon non è partito entro 30 secondi: controlla ${path.join(logs, 'daemon.log')}`)
}

/** Chiamata GET all'API con il token. */
export async function get<T> (info: DaemonInfo, route: string): Promise<T> {
  const res = await fetch(`${info.baseUrl}${route}`, { headers: { authorization: `Bearer ${info.token}` } })
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${route}`)
  return await res.json() as T
}
