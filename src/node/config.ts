/**
 * @file Configurazione locale del nodo (config.json) e stato del team (state.json).
 *
 * Due file distinti perché hanno sensibilità diverse:
 * - `config.json`: impostazioni della macchina (porta, token dell'API, LLM, cartelle opt-in).
 *   Il token va protetto, ma perderlo non compromette il team.
 * - `state.json`: chiavi del team, inclusa quella di CIFRATURA. Chi lo copia può leggere tutto
 *   il sapere del team: va trattato come una password.
 *
 * Nessuno dei due viene mai replicato. Le impostazioni CONDIVISE dal team (lingua dei ricordi,
 * parole chiave del filtro) stanno invece nel log, come eventi `team.config`.
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { NodePaths } from '../core/paths'

/** Porta di default dell'API locale e dell'endpoint MCP. */
export const DEFAULT_PORT = 7337

/** Impostazioni dei modelli usati via CLI (DESIGN §7, decisione D8). */
const LlmConfig = z.object({
  /**
   * Quale CLI usare: "claude" (Claude Code), "none" (nessuna intelligenza: i contenuti dubbi
   * vanno tutti in inbox) oppure "fake" (deterministico, SOLO per test ed e2e).
   */
  adapter: z.enum(['claude', 'none', 'fake']).default('claude'),
  /** Eseguibile da lanciare (utile se `claude` non è nel PATH). */
  command: z.string().default('claude'),
  /** Modello per la classificazione: veloce ed economico. */
  classifyModel: z.string().default('haiku'),
  /** Modello per la distillazione: più capace, scrive i ricordi. */
  distillModel: z.string().default('sonnet'),
  /** Numero massimo di chiamate al giorno; oltre, il lavoro aspetta il giorno dopo. */
  dailyBudget: z.number().int().min(0).default(300),
  /** Timeout di una singola chiamata alla CLI. */
  timeoutMs: z.number().int().min(10_000).default(180_000)
}).prefault({}) // prefault: il default {} passa dal parse, così si applicano i default interni

/** Cartelle in cui la raccolta automatica è attiva (decisione D7, opt-in). */
const WatchConfig = z.object({
  /** Progetti per cui le sessioni di Claude Code vengono elaborate. */
  sessions: z.array(z.string()).default([]),
  /**
   * Cartelle di documenti sorvegliate (Fase 4). `shareable`: se true, gli originali dei documenti
   * possono essere scaricati dai membri del team su richiesta (decisione D10).
   */
  documents: z.array(z.object({ path: z.string(), shareable: z.boolean().default(false) })).default([])
}).prefault({}) // prefault: il default {} passa dal parse, così si applicano i default interni

const Config = z.object({
  /** Interfaccia di ascolto: 127.0.0.1 (solo questa macchina); 0.0.0.0 nei container. */
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(0).max(65535).default(DEFAULT_PORT),
  /** Token per l'API locale e per MCP. Persistente, così la configurazione dei client resta valida. */
  token: z.string().min(32),
  llm: LlmConfig,
  watch: WatchConfig
})
export type Config = z.infer<typeof Config>

/** Contenuto di state.json: chi è questo nodo e a quale team appartiene. */
const State = z.object({
  nodeName: z.string(),
  baseKey: z.string(),
  encryptionKey: z.string()
})
export type State = z.infer<typeof State>

/** Legge un JSON; null se il file non esiste o non è valido. */
function readJson (file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/**
 * Scrive un file leggibile solo dall'utente corrente.
 * `mode: 0o600` vale su macOS/Linux; su Windows è ignorato e valgono le ACL del profilo utente.
 */
function writePrivate (file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 })
}

/**
 * Legge la configurazione, creandola al primo avvio (con un token casuale).
 *
 * Le variabili d'ambiente prevalgono sul file ma NON vengono salvate: servono per test,
 * container ed esecuzioni temporanee.
 * - MICELIO_HOST, MICELIO_PORT: interfaccia e porta dell'API
 * - MICELIO_LLM_ADAPTER: claude | none | fake
 */
export function loadConfig (paths: NodePaths): Config {
  const raw = (readJson(paths.config) ?? {}) as Record<string, unknown>
  if (typeof raw.token !== 'string') {
    raw.token = randomBytes(24).toString('hex')
    writePrivate(paths.config, Config.parse(raw))
  }
  const cfg = Config.parse(raw)
  if (process.env.MICELIO_HOST) cfg.host = process.env.MICELIO_HOST
  if (process.env.MICELIO_PORT) cfg.port = Number(process.env.MICELIO_PORT)
  const adapter = process.env.MICELIO_LLM_ADAPTER
  if (adapter === 'claude' || adapter === 'none' || adapter === 'fake') cfg.llm.adapter = adapter
  return cfg
}

/**
 * Modifica e salva la configurazione su disco.
 * Rilegge il file (non la config in memoria) per non salvare gli override delle variabili d'ambiente.
 * @param mutate funzione che modifica l'oggetto letto dal file
 * @returns la configurazione aggiornata, con gli override d'ambiente riapplicati
 */
export function updateConfig (paths: NodePaths, mutate: (cfg: Config) => void): Config {
  loadConfig(paths) // garantisce che il file esista
  const onDisk = Config.parse(readJson(paths.config))
  mutate(onDisk)
  writePrivate(paths.config, Config.parse(onDisk))
  return loadConfig(paths)
}

/** Stato del team, o null se il nodo non ha ancora fatto `init` / `join`. */
export function loadState (paths: NodePaths): State | null {
  const parsed = State.safeParse(readJson(paths.state))
  return parsed.success ? parsed.data : null
}

/** Salva lo stato del team. Contiene la chiave di cifratura: protetto come una password. */
export function saveState (paths: NodePaths, state: State): void {
  writePrivate(paths.state, State.parse(state))
}

/**
 * Nodi bootstrap della DHT da MICELIO_DHT_BOOTSTRAP="host:port,host:port".
 * Serve per i test (DHT locale) o per una rete privata; assente = DHT pubblica.
 */
export function bootstrapFromEnv (): { host: string, port: number }[] | undefined {
  const raw = process.env.MICELIO_DHT_BOOTSTRAP
  if (!raw) return undefined
  return raw.split(',').map((s) => {
    const [host, port] = s.trim().split(':')
    return { host, port: Number(port) }
  })
}

/**
 * Forma canonica di un percorso, per confrontarlo con altri.
 *
 * `realpathSync.native` risolve i link simbolici e, su Windows, espande i nomi corti 8.3
 * (es. `C:\Users\MARIOR~1.ROS` → `C:\Users\mario.rossi`). Bug reale trovato in Fase 2:
 * Claude Code riporta la cartella di lavoro con il nome lungo, mentre la cartella abilitata
 * poteva essere salvata con quello corto, e il confronto falliva in silenzio.
 * Se il percorso non esiste (cartella cancellata) si ripiega su `path.resolve`.
 */
export function canonicalPath (p: string): string {
  try {
    return fs.realpathSync.native(path.resolve(p))
  } catch {
    return path.resolve(p)
  }
}

/**
 * true se `dir` è una delle cartelle opt-in o una loro sottocartella.
 * Confronto sui percorsi canonici, case-insensitive su Windows (dove le maiuscole non contano).
 */
export function isInsideWatched (dir: string, watched: string[]): boolean {
  const norm = (p: string) => {
    const r = canonicalPath(p)
    return process.platform === 'win32' ? r.toLowerCase() : r
  }
  const target = norm(dir)
  return watched.some((w) => {
    const base = norm(w)
    return target === base || target.startsWith(base.endsWith(path.sep) ? base : base + path.sep)
  })
}
