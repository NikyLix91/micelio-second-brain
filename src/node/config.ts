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
  documents: z.array(z.object({ path: z.string(), shareable: z.boolean().default(false) })).default([]),
  /**
   * Raccolta delle sessioni IN CORSO e recupero di quelle perse (vedi src/ingest/session-scanner.ts):
   * ogni `intervalMinutes` si distilla la parte nuova delle sessioni in pausa da `idleMinutes`.
   */
  sessionScan: z.object({
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().int().min(1).default(15),
    idleMinutes: z.number().int().min(1).default(10),
    minUserTurns: z.number().int().min(1).default(4),
    minChars: z.number().int().min(100).default(6000),
    staleHours: z.number().min(1).default(6)
  }).prefault({}),
  /**
   * Distillazione consapevole delle modifiche (src/ingest/git-changes.ts): se la cartella della
   * sessione è un repository git, al materiale da distillare si aggiunge il riassunto di commit e
   * modifiche fatte durante il capitolo (file, classi, funzioni, endpoint).
   */
  gitChanges: z.boolean().default(true)
}).prefault({}) // prefault: il default {} passa dal parse, così si applicano i default interni

/** Embedding per la ricerca semantica (Fase 5). */
const EmbeddingsConfig = z.object({
  /** "local" = modello vero in locale (consigliato); "hash" = finto, solo test/demo; "none" = solo parole chiave. */
  adapter: z.enum(['local', 'hash', 'none']).default('local'),
  /** Modello: deve essere lo stesso su tutti i nodi del team, altrimenti i vettori non sono confrontabili. */
  model: z.string().default('Xenova/multilingual-e5-small')
}).prefault({})

/** Dreaming (Fase 6, DESIGN §10). */
const DreamConfig = z.object({
  /** Se false questo nodo non sogna mai (gli altri sì). */
  enabled: z.boolean().default(true),
  /** Ora locale da cui il primo nodo della turnazione può sognare (default 13: pausa pranzo). */
  hour: z.number().int().min(0).max(23).default(13),
  /** Minuti di attesa fra un turno e il successivo, se il nodo precedente non ha sognato. */
  slotMinutes: z.number().int().min(1).default(30)
}).prefault({})

/** Formato di un nodo di avvio: "host:porta" (host senza spazi né due punti). */
export const BOOTSTRAP_RE = /^[^\s:]+:\d{1,5}$/

/**
 * Rete P2P: dove i nodi del team si incontrano (vedi server/README.md).
 * TUTTI i membri del team devono usare gli stessi nodi di avvio, altrimenti stanno in DHT diverse
 * e non si trovano.
 */
const NetworkConfig = z.object({
  /**
   * "public" = DHT pubblica di Holepunch; "private" = DHT del team (nodi in `bootstrap`).
   * Facoltativo per compatibilità con i config.json scritti prima della scelta esplicita:
   * se manca vale "private" quando `bootstrap` non è vuota (vedi networkMode).
   */
  mode: z.enum(['public', 'private']).optional(),
  /**
   * Nodi di avvio della DHT privata, come "host:porta". Restano salvati anche passando alla
   * DHT pubblica, così si può tornare indietro senza riscriverli.
   * Con un server Micelio (cartella server/ della repo) il team usa una DHT tutta sua.
   */
  bootstrap: z.array(z.string().regex(BOOTSTRAP_RE, 'formato host:porta')).default([])
}).prefault({})
export type NetworkConfig = z.infer<typeof NetworkConfig>

const Config = z.object({
  /** Interfaccia di ascolto: 127.0.0.1 (solo questa macchina); 0.0.0.0 nei container. */
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(0).max(65535).default(DEFAULT_PORT),
  /** Token per l'API locale e per MCP. Persistente, così la configurazione dei client resta valida. */
  token: z.string().min(32),
  llm: LlmConfig,
  watch: WatchConfig,
  embeddings: EmbeddingsConfig,
  dream: DreamConfig,
  network: NetworkConfig
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
  // MICELIO_EMBEDDER: local | hash | none (test, e2e, demo)
  const emb = process.env.MICELIO_EMBEDDER
  if (emb === 'local' || emb === 'hash' || emb === 'none') cfg.embeddings.adapter = emb
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

/** Converte "host:porta" nella forma che si aspetta HyperDHT. */
export function parseBootstrap (list: string[]): { host: string, port: number }[] {
  return list.map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.lastIndexOf(':')
    return { host: s.slice(0, i), port: Number(s.slice(i + 1)) }
  })
}

/**
 * Nodi di avvio della DHT da usare, in ordine di precedenza:
 * 1. MICELIO_DHT_BOOTSTRAP="host:porta,host:porta" (test, demo, container);
 * 2. `network.bootstrap` in config.json (server del team, `micelio network set`);
 * 3. undefined = DHT pubblica di Holepunch.
 */
export function dhtBootstrap (config?: Config): { host: string, port: number }[] | undefined {
  const env = process.env.MICELIO_DHT_BOOTSTRAP
  if (env) return parseBootstrap(env.split(','))
  if (!config || networkMode(config.network) === 'public') return undefined
  return config.network.bootstrap.length ? parseBootstrap(config.network.bootstrap) : undefined
}

/** DHT scelta: esplicita se indicata, altrimenti dedotta dalla presenza di nodi di avvio. */
export function networkMode (n: NetworkConfig): 'public' | 'private' {
  return n.mode ?? (n.bootstrap.length ? 'private' : 'public')
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
