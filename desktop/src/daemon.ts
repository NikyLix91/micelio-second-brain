/**
 * @file Collegamento dell'app desktop al daemon locale: configurazione, avvio, chiamate API.
 *
 * L'app NON contiene il nodo: lo avvia come processo separato (lo stesso `micelio daemon` della
 * CLI) se non è già in esecuzione. Così chiudere l'app non ferma la sincronizzazione, e CLI,
 * app e Claude Code parlano tutti con lo stesso daemon.
 *
 * Due situazioni:
 * - **da sorgente** (`npm run desktop`): daemon e CLI compilati stanno in `dist/` della repository;
 * - **installata** (installer di Windows, scripts/package-win.js): stanno in
 *   `resources/micelio/dist/`, con un Node.js incluso in `resources/node/` e il comando `micelio`
 *   in `resources/bin/`. Il Node incluso evita di dipendere da quello (se c'è) installato sul PC.
 *
 * EN: Connection of the desktop app to the local daemon: configuration, startup, API calls.
 *
 * EN: The app does NOT contain the node: it starts it as a separate process (the same `micelio daemon`
 * as the CLI) if it isn't already running. This way closing the app doesn't stop syncing, and the CLI,
 * the app and Claude Code all talk to the same daemon.
 *
 * EN: Two situations:
 * - **from source** (`npm run desktop`): the compiled daemon and CLI live in the repository's `dist/`;
 * - **installed** (Windows installer, scripts/package-win.js): they live in
 *   `resources/micelio/dist/`, with a bundled Node.js in `resources/node/` and the `micelio` command
 *   in `resources/bin/`. The bundled Node avoids depending on the one (if any) installed on the PC.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** Cartella `resources` dell'app installata (undefined da sorgente, cioè con Electron "nudo"). / EN: `resources` folder of the installed app (undefined from source, i.e. with "bare" Electron). */
const RESOURCES: string | undefined = (process as any).resourcesPath
/** true se l'app gira dall'installazione (i file di Micelio stanno in resources/micelio). / EN: true if the app runs from the installation (Micelio's files are in resources/micelio). */
export const PACKAGED = !!RESOURCES && fs.existsSync(path.join(RESOURCES, 'micelio', 'dist', 'cli', 'main.js'))

/**
 * Radice di Micelio: da qui si trovano dist/cli e dist/node.
 * Installata: resources/micelio; da sorgente: la repository (desktop/dist → ../..).
 *
 * EN: Micelio root: dist/cli and dist/node are found from here.
 * Installed: resources/micelio; from source: the repository (desktop/dist → ../..).
 */
const ROOT = PACKAGED ? path.join(RESOURCES!, 'micelio') : path.join(__dirname, '..', '..')
const CLI_MAIN = path.join(ROOT, 'dist', 'cli', 'main.js')
/** Node.js incluso nell'installazione: node.exe su Windows, node su Linux (null da sorgente o se manca). / EN: Node.js bundled with the installation: node.exe on Windows, node on Linux (null from source or if missing). */
const BUNDLED_NODE_PATH = PACKAGED ? path.join(RESOURCES!, 'node', process.platform === 'win32' ? 'node.exe' : 'node') : null
const BUNDLED_NODE = BUNDLED_NODE_PATH && fs.existsSync(BUNDLED_NODE_PATH) ? BUNDLED_NODE_PATH : null

// Riusiamo i moduli compilati del daemon per leggere percorsi e configurazione: una sola verità.
// EN: We reuse the daemon's compiled modules to read paths and configuration: a single source of truth.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { nodePaths } = require(path.join(ROOT, 'dist', 'core', 'paths.js'))
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadConfig } = require(path.join(ROOT, 'dist', 'node', 'config.js'))

export interface DaemonInfo {
  home: string
  baseUrl: string
  token: string
}

/** Percorsi, URL e token del nodo locale (rispetta MICELIO_HOME). / EN: Paths, URL and token of the local node (honors MICELIO_HOME). */
export function daemonInfo (): DaemonInfo {
  if (!fs.existsSync(CLI_MAIN)) throw new Error(PACKAGED ? `Installazione incompleta: manca ${CLI_MAIN}. Reinstalla Micelio.` : `Daemon non compilato: esegui \`npm run build\` nella cartella del progetto (manca ${CLI_MAIN})`)
  const paths = nodePaths()
  const cfg = loadConfig(paths)
  const host = cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host
  return { home: paths.home, baseUrl: `http://${host}:${cfg.port}`, token: cfg.token }
}

/** true se il daemon risponde. / EN: true if the daemon responds. */
export async function isUp (info: DaemonInfo): Promise<boolean> {
  try {
    const res = await fetch(`${info.baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Quale Node usare per il daemon:
 * 1. installata: il Node incluso (stessa versione con cui Micelio è stato provato);
 * 2. quello di sistema se c'è (lo stesso della CLI);
 * 3. il Node di Electron in modalità "solo Node" (ELECTRON_RUN_AS_NODE). Electron 38 include
 *    Node 22, sufficiente per `node:sqlite`.
 *
 * EN: Which Node to use for the daemon:
 * 1. installed: the bundled Node (the same version Micelio was tested with);
 * 2. the system one, if present (the same as the CLI);
 * 3. Electron's Node in "Node only" mode (ELECTRON_RUN_AS_NODE). Electron 38 includes
 *    Node 22, enough for `node:sqlite`.
 */
function nodeRuntime (): { cmd: string, env: NodeJS.ProcessEnv } {
  if (BUNDLED_NODE) return { cmd: BUNDLED_NODE, env: {} }
  const probe = spawnSync('node', ['--version'], { encoding: 'utf8', windowsHide: true })
  if (!probe.error && probe.status === 0) return { cmd: 'node', env: {} }
  return { cmd: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }
}

/**
 * Avvia il daemon in background se non è già attivo, e attende che risponda (max 90 s).
 * L'avvio normale dura pochi secondi; il margine è per i PC lenti o molto carichi, perché
 * un errore «daemon non attivo» quando il daemon sta solo partendo confonde l'utente.
 * Il processo è staccato dall'app: sopravvive alla sua chiusura, come con `micelio start`.
 *
 * EN: Starts the daemon in the background if it isn't already running, and waits until it responds (max 90 s).
 * A normal startup takes a few seconds; the margin is for slow or very busy PCs, because a
 * "daemon not running" error while the daemon is only starting confuses the user.
 * The process is detached from the app: it survives the app closing, as with `micelio start`.
 */
export async function ensureDaemon (info: DaemonInfo, log: (m: string) => void): Promise<void> {
  if (await isUp(info)) return
  const { cmd, env } = nodeRuntime()
  const logs = path.join(info.home, 'logs')
  fs.mkdirSync(logs, { recursive: true })
  const out = fs.openSync(path.join(logs, 'daemon.log'), 'a')
  log(`avvio del daemon con ${cmd === BUNDLED_NODE ? 'il Node incluso' : cmd === 'node' ? 'node di sistema' : 'Node di Electron'}`)
  spawn(cmd, [CLI_MAIN, 'daemon'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, ...env, MICELIO_HOME: info.home, NO_COLOR: '1' },
    windowsHide: true
  }).unref()
  for (let i = 0; i < 180; i++) {
    if (await isUp(info)) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Il daemon non è partito entro 90 secondi: controlla ${path.join(logs, 'daemon.log')}`)
}

/** Chiamata GET all'API con il token. / EN: GET call to the API with the token. */
export async function get<T> (info: DaemonInfo, route: string): Promise<T> {
  const res = await fetch(`${info.baseUrl}${route}`, { headers: { authorization: `Bearer ${info.token}` } })
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${route}`)
  return await res.json() as T
}
