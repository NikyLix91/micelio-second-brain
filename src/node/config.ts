/**
 * @file Configurazione locale del nodo (config.json) e stato del team (state.json).
 *
 * EN: Local node configuration (config.json) and team state (state.json).
 *
 * Due file distinti perché hanno sensibilità diverse:
 * - `config.json`: impostazioni della macchina (porta, token dell'API, LLM, cartelle opt-in).
 *   Il token va protetto, ma perderlo non compromette il team.
 * - `state.json`: chiavi del team, inclusa quella di CIFRATURA. Chi lo copia può leggere tutto
 *   il sapere del team: va trattato come una password.
 *
 * EN: Two separate files because they have different sensitivity:
 * - `config.json`: machine settings (port, API token, LLM, opt-in folders).
 *   The token must be protected, but losing it does not compromise the team.
 * - `state.json`: team keys, including the ENCRYPTION key. Whoever copies it can read all
 *   the team's knowledge: treat it like a password.
 *
 * Nessuno dei due viene mai replicato. Le impostazioni CONDIVISE dal team (lingua dei ricordi,
 * parole chiave del filtro) stanno invece nel log, come eventi `team.config`.
 *
 * EN: Neither is ever replicated. Settings SHARED by the team (memory language,
 * filter keywords) live in the log instead, as `team.config` events.
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { NodePaths } from '../core/paths'

/** Porta di default dell'API locale e dell'endpoint MCP. / EN: Default port of the local API and of the MCP endpoint. */
export const DEFAULT_PORT = 7337

/** Impostazioni dei modelli usati via CLI (DESIGN §7, decisione D8). / EN: Settings of the models used through the CLI (DESIGN §7, decision D8). */
const LlmConfig = z.object({
  /**
   * Quale CLI usare: "claude" (Claude Code), "none" (nessuna intelligenza: i contenuti dubbi
   * vanno tutti in inbox) oppure "fake" (deterministico, SOLO per test ed e2e).
   *
   * EN: Which CLI to use: "claude" (Claude Code), "none" (no intelligence: all doubtful content
   * goes to the Inbox) or "fake" (deterministic, ONLY for tests and e2e).
   */
  adapter: z.enum(['claude', 'none', 'fake']).default('claude'),
  /** Eseguibile da lanciare (utile se `claude` non è nel PATH). / EN: Executable to launch (useful if `claude` is not in the PATH). */
  command: z.string().default('claude'),
  /** Modello per la classificazione: veloce ed economico. / EN: Model for classification: fast and cheap. */
  classifyModel: z.string().default('haiku'),
  /** Modello per la distillazione: più capace, scrive i ricordi. / EN: Model for distillation: more capable, it writes the memories. */
  distillModel: z.string().default('sonnet'),
  /** Numero massimo di chiamate al giorno; oltre, il lavoro aspetta il giorno dopo. / EN: Maximum number of calls per day; beyond that, work waits for the next day. */
  dailyBudget: z.number().int().min(0).default(300),
  /** Timeout di una singola chiamata alla CLI. / EN: Timeout of a single CLI call. */
  timeoutMs: z.number().int().min(10_000).default(180_000)
}).prefault({}) // prefault: il default {} passa dal parse, così si applicano i default interni / EN: prefault: the {} default goes through parse, so the inner defaults apply

/** Cartelle in cui la raccolta automatica è attiva (decisione D7, opt-in). / EN: Folders where automatic collection is active (decision D7, opt-in). */
const WatchConfig = z.object({
  /** Progetti per cui le sessioni di Claude Code vengono elaborate. / EN: Projects whose Claude Code sessions are processed. */
  sessions: z.array(z.string()).default([]),
  /**
   * Cartelle di documenti sorvegliate (Fase 4). `shareable`: se true, gli originali dei documenti
   * possono essere scaricati dai membri del team su richiesta (decisione D10).
   *
   * EN: Watched document folders (Phase 4). `shareable`: if true, the original documents
   * can be downloaded by team members on request (decision D10).
   */
  documents: z.array(z.object({
    path: z.string(),
    shareable: z.boolean().default(false),
    /**
     * Cartella "di Radici" (Fase 8): i ricordi distillati dai suoi documenti diventano Radici
     * automaticamente (es. la cartella dell'architettura, delle policy, il vault delle regole).
     *
     * EN: "Roots" folder (Phase 8): memories distilled from its documents become Roots
     * automatically (e.g. the architecture folder, the policies folder, the rules vault).
     */
    roots: z.boolean().default(false)
  })).default([]),
  /**
   * Raccolta delle sessioni IN CORSO e recupero di quelle perse (vedi src/ingest/session-scanner.ts):
   * ogni `intervalMinutes` si distilla la parte nuova delle sessioni in pausa da `idleMinutes`.
   *
   * EN: Collection of ONGOING sessions and recovery of missed ones (see src/ingest/session-scanner.ts):
   * every `intervalMinutes`, the new part of sessions idle for `idleMinutes` is distilled.
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
   *
   * EN: Change-aware distillation (src/ingest/git-changes.ts): if the session folder is a git
   * repository, a summary of the commits and changes made during the chapter (files, classes,
   * functions, endpoints) is added to the material to distill.
   */
  gitChanges: z.boolean().default(true)
}).prefault({}) // prefault: il default {} passa dal parse, così si applicano i default interni / EN: prefault: the {} default goes through parse, so the inner defaults apply

/** Embedding per la ricerca semantica (Fase 5). / EN: Embeddings for semantic search (Phase 5). */
const EmbeddingsConfig = z.object({
  /** "local" = modello vero in locale (consigliato); "hash" = finto, solo test/demo; "none" = solo parole chiave. / EN: "local" = real local model (recommended); "hash" = fake, tests/demo only; "none" = keywords only. */
  adapter: z.enum(['local', 'hash', 'none']).default('local'),
  /** Modello: deve essere lo stesso su tutti i nodi del team, altrimenti i vettori non sono confrontabili. / EN: Model: must be the same on all team nodes, otherwise vectors are not comparable. */
  model: z.string().default('Xenova/multilingual-e5-small')
}).prefault({})

/** Dreaming (Fase 6, DESIGN §10). / EN: Dreaming (Phase 6, DESIGN §10). */
const DreamConfig = z.object({
  /** Se false questo nodo non sogna mai (gli altri sì). / EN: If false this node never dreams (the others do). */
  enabled: z.boolean().default(true),
  /** Ora locale da cui il primo nodo della turnazione può sognare (default 13: pausa pranzo). / EN: Local hour from which the first node in the rotation may dream (default 13: lunch break). */
  hour: z.number().int().min(0).max(23).default(13),
  /** Minuti di attesa fra un turno e il successivo, se il nodo precedente non ha sognato. / EN: Minutes to wait between one turn and the next, if the previous node did not dream. */
  slotMinutes: z.number().int().min(1).default(30)
}).prefault({})

/**
 * Contesto automatico per gli agenti (B4, src/context/agent-context.ts): cosa inseriscono gli
 * hook di Claude Code. Vale per la macchina (gli hook sono dell'utente, non di un team).
 *
 * EN: Automatic context for agents (B4, src/context/agent-context.ts): what the Claude Code
 * hooks inject. Machine-wide (hooks belong to the user, not to a team).
 */
const ContextConfig = z.object({
  /** A inizio sessione: Radici e ricordi più utili del progetto. / EN: At session start: the project's Roots and most useful memories. */
  sessionStart: z.boolean().default(true),
  /** A ogni richiesta: ricordi e Radici pertinenti al testo, se lo sono davvero. / EN: On every prompt: memories and Roots relevant to the text, if they really are. */
  prompt: z.boolean().default(true),
  /** Caratteri massimi inseriti ogni volta. / EN: Maximum characters injected each time. */
  maxChars: z.number().int().min(500).max(20_000).default(4000)
}).prefault({})

/**
 * Backup automatici del sapere del team (B7, src/backup): uno al giorno nella cartella scelta, si
 * tengono gli ultimi `keep`. Impostazione del team (ogni team ha la sua), spenta di default.
 * La password resta su questo PC: i dati del team qui sono già in chiaro, e la cifratura protegge
 * le copie nella cartella dei backup (che può essere condivisa o di rete).
 *
 * EN: Automatic backups of the team's knowledge (B7, src/backup): one per day in the chosen folder,
 * keeping the last `keep`. Team setting (each team has its own), off by default.
 * The password stays on this PC: the team data here is already in clear text, and encryption protects
 * the copies in the backup folder (which may be shared or on the network).
 */
const BackupConfig = z.object({
  enabled: z.boolean().default(false),
  folder: z.string().default(''),
  keep: z.number().int().min(1).max(365).default(7),
  password: z.string().default('')
}).prefault({})
export type BackupConfig = z.infer<typeof BackupConfig>

/** Formato di un nodo di avvio: "host:porta" (host senza spazi né due punti). / EN: Format of a bootstrap node: "host:port" (host without spaces or colons). */
export const BOOTSTRAP_RE = /^[^\s:]+:\d{1,5}$/

/**
 * Rete P2P: dove i nodi del team si incontrano (vedi server/README.md).
 * TUTTI i membri del team devono usare gli stessi nodi di avvio, altrimenti stanno in DHT diverse
 * e non si trovano.
 *
 * EN: P2P network: where the team's nodes meet (see server/README.md).
 * ALL team members must use the same bootstrap nodes, otherwise they end up in different DHTs
 * and cannot find each other.
 */
const NetworkConfig = z.object({
  /**
   * "public" = DHT pubblica di Holepunch; "private" = DHT del team (nodi in `bootstrap`);
   * "local" = SOLO LOCALE (B4): nessuna rete, per chi usa Micelio da solo finché non invita qualcuno.
   * Facoltativo per compatibilità con i config.json scritti prima della scelta esplicita:
   * se manca vale "private" quando `bootstrap` non è vuota (vedi networkMode).
   *
   * EN: "public" = Holepunch public DHT; "private" = the team's DHT (nodes in `bootstrap`);
   * "local" = LOCAL ONLY (B4): no network, for people using Micelio alone until they invite someone.
   * Optional for compatibility with config.json files written before the explicit choice:
   * if missing, it is "private" when `bootstrap` is not empty (see networkMode).
   */
  mode: z.enum(['public', 'private', 'local']).optional(),
  /**
   * Nodi di avvio della DHT privata, come "host:porta". Restano salvati anche passando alla
   * DHT pubblica, così si può tornare indietro senza riscriverli.
   * Con un server Micelio (cartella server/ della repo) il team usa una DHT tutta sua.
   *
   * EN: Bootstrap nodes of the private DHT, as "host:port". They stay saved even when switching to
   * the public DHT, so you can switch back without retyping them.
   * With a Micelio server (the repo's server/ folder) the team uses a DHT of its own.
   */
  bootstrap: z.array(z.string().regex(BOOTSTRAP_RE, 'formato host:porta')).default([])
}).prefault({})
export type NetworkConfig = z.infer<typeof NetworkConfig>
/** Rete di un team: DHT pubblica, DHT privata del team o nessuna rete (solo locale). / EN: A team's network: public DHT, the team's private DHT or no network (local only). */
export type NetworkMode = 'public' | 'private' | 'local'

const Config = z.object({
  /** Interfaccia di ascolto: 127.0.0.1 (solo questa macchina); 0.0.0.0 nei container. / EN: Listen interface: 127.0.0.1 (this machine only); 0.0.0.0 in containers. */
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(0).max(65535).default(DEFAULT_PORT),
  /** Token per l'API locale e per MCP. Persistente, così la configurazione dei client resta valida. / EN: Token for the local API and MCP. Persistent, so client configuration stays valid. */
  token: z.string().min(32),
  llm: LlmConfig,
  watch: WatchConfig,
  embeddings: EmbeddingsConfig,
  dream: DreamConfig,
  network: NetworkConfig,
  context: ContextConfig,
  backup: BackupConfig,
  /**
   * Efficacia (B11): notifiche del desktop per gli esiti "utile" e "sbagliato" dei ricordi forniti
   * agli agenti. Impostazione della macchina (le notifiche sono di questo PC).
   *
   * EN: Efficacy (B11): desktop notifications for the "useful" and "wrong" outcomes of memories given
   * to agents. Machine setting (notifications belong to this PC).
   */
  efficacy: z.object({ notify: z.boolean().default(true) }).prefault({}),
  /**
   * File di istruzioni per gli agenti tenuti aggiornati con le Radici (B4, src/roots/agent-files.ts):
   * cartella del progetto, formato (claude = CLAUDE.md, agents = AGENTS.md, cursor = regole di
   * Cursor) e progetto (assente = nome della cartella). Impostazione del team.
   *
   * EN: Agent instruction files kept up to date with the Roots (B4, src/roots/agent-files.ts):
   * project folder, format (claude = CLAUDE.md, agents = AGENTS.md, cursor = Cursor rules)
   * and project (missing = folder name). Team setting.
   */
  agentFiles: z.array(z.object({ dir: z.string(), format: z.enum(['claude', 'agents', 'cursor']), project: z.string().optional() })).default([]),
  /**
   * Team usato quando una richiesta non ne indica uno (B3): id locale della cartella `teams/<id>`.
   * Assente = il primo team in ordine di creazione.
   *
   * EN: Team used when a request does not name one (B3): local id of the `teams/<id>` folder.
   * Missing = the first team in creation order.
   */
  defaultTeam: z.string().optional()
})
export type Config = z.infer<typeof Config>

/**
 * Sezioni che appartengono al TEAM e non alla macchina (B3): con più team ognuno ha le sue
 * cartelle, la sua DHT e il suo orario di sogno, in `teams/<id>/settings.json`.
 * Il resto (porta, token, LLM, embedding) resta in config.json: è uno per macchina.
 *
 * EN: Sections that belong to the TEAM and not to the machine (B3): with several teams each one has
 * its own folders, DHT and dreaming time, in `teams/<id>/settings.json`.
 * The rest (port, token, LLM, embeddings) stays in config.json: there is one per machine.
 */
const TEAM_SECTIONS = ['watch', 'network', 'dream', 'agentFiles', 'backup'] as const

/** true se configurazione e impostazioni del team stanno nello stesso file (struttura a un team). / EN: true if configuration and team settings live in the same file (single-team layout). */
const singleFile = (paths: NodePaths) => path.resolve(paths.config) === path.resolve(paths.settings)

/**
 * Unisce il file della macchina e quello del team in un unico oggetto grezzo da validare.
 * Le sezioni del team si prendono SOLO da settings.json: eventuali copie rimaste in config.json
 * (struttura precedente a B3) non devono finire in tutti i team.
 *
 * EN: Merges the machine file and the team file into one raw object to validate.
 * Team sections are taken ONLY from settings.json: any copies left in config.json
 * (pre-B3 layout) must not end up in every team.
 */
function readRaw (paths: NodePaths): Record<string, unknown> {
  const machine = (readJson(paths.config) ?? {}) as Record<string, unknown>
  if (singleFile(paths)) return machine
  const team = (readJson(paths.settings) ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = { ...machine }
  for (const k of TEAM_SECTIONS) { if (k in team) out[k] = team[k]; else delete out[k] }
  return out
}

/** Contenuto di state.json: chi è questo nodo e a quale team appartiene. / EN: Content of state.json: who this node is and which team it belongs to. */
const State = z.object({
  nodeName: z.string(),
  baseKey: z.string(),
  encryptionKey: z.string()
})
export type State = z.infer<typeof State>

/** Legge un JSON; null se il file non esiste o non è valido. / EN: Reads a JSON file; null if the file does not exist or is invalid. */
function readJson (file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/**
 * Scrive un file leggibile solo dall'utente corrente.
 * `mode: 0o600` vale su macOS/Linux; su Windows è ignorato e valgono le ACL del profilo utente.
 *
 * EN: Writes a file readable only by the current user.
 * `mode: 0o600` applies on macOS/Linux; on Windows it is ignored and the user profile ACLs apply.
 */
function writePrivate (file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 })
}

/**
 * Legge la configurazione, creandola al primo avvio (con un token casuale).
 *
 * EN: Reads the configuration, creating it on first start (with a random token).
 *
 * Le variabili d'ambiente prevalgono sul file ma NON vengono salvate: servono per test,
 * container ed esecuzioni temporanee.
 * - MICELIO_HOST, MICELIO_PORT: interfaccia e porta dell'API
 * - MICELIO_LLM_ADAPTER: claude | none | fake
 *
 * EN: Environment variables override the file but are NOT saved: they are for tests,
 * containers and temporary runs.
 * - MICELIO_HOST, MICELIO_PORT: API interface and port
 * - MICELIO_LLM_ADAPTER: claude | none | fake
 */
export function loadConfig (paths: NodePaths): Config {
  const machine = (readJson(paths.config) ?? {}) as Record<string, unknown>
  if (typeof machine.token !== 'string') {
    // Primo avvio: si crea config.json con il token (solo la parte della macchina, se il team ha il suo file)
    // EN: First start: create config.json with the token (only the machine part, if the team has its own file)
    machine.token = randomBytes(24).toString('hex')
    const full = Config.parse(machine)
    writePrivate(paths.config, singleFile(paths) ? full : omitTeamSections(full))
  }
  const cfg = Config.parse(readRaw(paths))
  if (process.env.MICELIO_HOST) cfg.host = process.env.MICELIO_HOST
  if (process.env.MICELIO_PORT) cfg.port = Number(process.env.MICELIO_PORT)
  const adapter = process.env.MICELIO_LLM_ADAPTER
  if (adapter === 'claude' || adapter === 'none' || adapter === 'fake') cfg.llm.adapter = adapter
  // MICELIO_EMBEDDER: local | hash | none (test, e2e, demo)
  // EN: MICELIO_EMBEDDER: local | hash | none (tests, e2e, demo)
  const emb = process.env.MICELIO_EMBEDDER
  if (emb === 'local' || emb === 'hash' || emb === 'none') cfg.embeddings.adapter = emb
  return cfg
}

/**
 * Modifica e salva la configurazione su disco.
 * Rilegge il file (non la config in memoria) per non salvare gli override delle variabili d'ambiente.
 *
 * EN: Modifies and saves the configuration to disk.
 * Re-reads the file (not the in-memory config) so environment variable overrides are not saved.
 * @param mutate funzione che modifica l'oggetto letto dal file
 *        EN: function that modifies the object read from the file
 * @returns la configurazione aggiornata, con gli override d'ambiente riapplicati
 *          EN: the updated configuration, with environment overrides reapplied
 */
export function updateConfig (paths: NodePaths, mutate: (cfg: Config) => void): Config {
  loadConfig(paths) // garantisce che il file esista / EN: ensures the file exists
  const onDisk = Config.parse(readRaw(paths))
  mutate(onDisk)
  const next = Config.parse(onDisk)
  if (singleFile(paths)) {
    writePrivate(paths.config, next)
  } else {
    // Ogni sezione torna nel suo file: macchina in config.json, team in settings.json.
    // EN: Each section goes back to its own file: machine in config.json, team in settings.json.
    writePrivate(paths.config, omitTeamSections(next))
    writePrivate(paths.settings, Object.fromEntries(TEAM_SECTIONS.map((k) => [k, next[k]])))
  }
  return loadConfig(paths)
}

/** La configurazione senza le sezioni del team: ciò che va in config.json con più team. / EN: The configuration without the team sections: what goes in config.json with several teams. */
function omitTeamSections (cfg: Config): Partial<Config> {
  const out: Partial<Config> = { ...cfg }
  for (const k of TEAM_SECTIONS) delete out[k]
  return out
}

/**
 * Modifica SOLO config.json (la macchina), senza toccare le impostazioni di un team.
 * Usata da MicelioHost per il team predefinito e dalla migrazione alla struttura a più team.
 *
 * EN: Modifies ONLY config.json (the machine), without touching any team's settings.
 * Used by MicelioHost for the default team and by the migration to the multi-team layout.
 * @param mutate riceve il contenuto grezzo del file (anche le chiavi sconosciute restano)
 *        EN: receives the raw file content (unknown keys are kept too)
 */
export function updateMachineConfig (configFile: string, mutate: (raw: Record<string, unknown>) => void): void {
  const raw = (readJson(configFile) ?? {}) as Record<string, unknown>
  mutate(raw)
  writePrivate(configFile, raw)
}

/** Legge il contenuto grezzo di un file di configurazione ({} se manca): per la migrazione. / EN: Reads the raw content of a configuration file ({} if missing): for the migration. */
export function readConfigFile (file: string): Record<string, unknown> {
  return (readJson(file) ?? {}) as Record<string, unknown>
}

/** Scrive un file di impostazioni con permessi ristretti (vedi writePrivate): per la migrazione. / EN: Writes a settings file with restricted permissions (see writePrivate): for the migration. */
export function writeConfigFile (file: string, data: unknown): void {
  writePrivate(file, data)
}

/** Stato del team, o null se il nodo non ha ancora fatto `init` / `join`. / EN: Team state, or null if the node has not run `init` / `join` yet. */
export function loadState (paths: NodePaths): State | null {
  const parsed = State.safeParse(readJson(paths.state))
  return parsed.success ? parsed.data : null
}

/** Salva lo stato del team. Contiene la chiave di cifratura: protetto come una password. / EN: Saves the team state. It contains the encryption key: protected like a password. */
export function saveState (paths: NodePaths, state: State): void {
  writePrivate(paths.state, State.parse(state))
}

/** Converte "host:porta" nella forma che si aspetta HyperDHT. / EN: Converts "host:port" into the shape HyperDHT expects. */
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
 *
 * EN: DHT bootstrap nodes to use, in order of precedence:
 * 1. MICELIO_DHT_BOOTSTRAP="host:port,host:port" (tests, demo, containers);
 * 2. `network.bootstrap` in config.json (team server, `micelio network set`);
 * 3. undefined = Holepunch public DHT.
 */
export function dhtBootstrap (config?: Config): { host: string, port: number }[] | undefined {
  const env = process.env.MICELIO_DHT_BOOTSTRAP
  if (env) return parseBootstrap(env.split(','))
  if (!config || networkMode(config.network) !== 'private') return undefined
  return config.network.bootstrap.length ? parseBootstrap(config.network.bootstrap) : undefined
}

/** DHT scelta: esplicita se indicata, altrimenti dedotta dalla presenza di nodi di avvio. / EN: Chosen DHT: explicit if set, otherwise inferred from the presence of bootstrap nodes. */
export function networkMode (n: NetworkConfig): NetworkMode {
  return n.mode ?? (n.bootstrap.length ? 'private' : 'public')
}

/**
 * Forma canonica di un percorso, per confrontarlo con altri.
 *
 * EN: Canonical form of a path, to compare it with others.
 *
 * `realpathSync.native` risolve i link simbolici e, su Windows, espande i nomi corti 8.3
 * (es. `C:\Users\MARIOR~1.ROS` → `C:\Users\mario.rossi`). Bug reale trovato in Fase 2:
 * Claude Code riporta la cartella di lavoro con il nome lungo, mentre la cartella abilitata
 * poteva essere salvata con quello corto, e il confronto falliva in silenzio.
 * Se il percorso non esiste (cartella cancellata, o non ancora creata) si canonicalizza la
 * cartella esistente più vicina e si riattacca il resto: altrimenti un nome corto nella parte
 * esistente (es. la cartella utente) farebbe fallire il confronto.
 *
 * EN: `realpathSync.native` resolves symbolic links and, on Windows, expands 8.3 short names
 * (e.g. `C:\Users\MARIOR~1.ROS` → `C:\Users\mario.rossi`). Real bug found in Phase 2:
 * Claude Code reports the working folder with the long name, while the enabled folder
 * could be saved with the short one, and the comparison failed silently.
 * If the path does not exist (folder deleted, or not created yet) we canonicalize the
 * nearest existing folder and reattach the rest: otherwise a short name in the existing
 * part (e.g. the user folder) would make the comparison fail.
 */
export function canonicalPath (p: string): string {
  const abs = path.resolve(p)
  try {
    return fs.realpathSync.native(abs)
  } catch {
    const parent = path.dirname(abs)
    // Arrivati alla radice del disco senza trovare nulla: si lascia il percorso com'è
    // EN: Reached the drive root without finding anything: leave the path as it is
    if (parent === abs) return abs
    return path.join(canonicalPath(parent), path.basename(abs))
  }
}

/**
 * true se `dir` è una delle cartelle opt-in o una loro sottocartella.
 * Confronto sui percorsi canonici, case-insensitive su Windows (dove le maiuscole non contano).
 *
 * EN: true if `dir` is one of the opt-in folders or one of their subfolders.
 * Compares canonical paths, case-insensitive on Windows (where case does not matter).
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
