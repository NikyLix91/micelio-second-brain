/**
 * @file Più team sulla stessa macchina (B3): il "padrone di casa" dei nodi.
 *
 * Un `MicelioNode` gestisce UN team. `MicelioHost` ne gestisce quanti ne servono, uno per
 * cartella `teams/<id>/` (struttura in src/core/paths.ts), e tiene insieme ciò che è unico per
 * macchina:
 * - l'**identità personale** (identity.json): la stessa persona in tutti i team;
 * - l'**esecutore LLM**: una sola coda (una chiamata a Claude alla volta) e un solo budget
 *   giornaliero (machine.db), perché l'abbonamento è uno;
 * - l'**embedder**: il modello dei vettori si carica una volta sola;
 * - il **team predefinito**: quello usato quando una richiesta non ne indica uno.
 *
 * Separazione del sapere. Ogni team ha chiavi, log, indice, archivio privato, export, rete
 * (anche DHT diverse) e cartelle tutti suoi: nulla passa da un team all'altro. Le sessioni di
 * Claude Code e i documenti vanno al team a cui appartiene la cartella:
 * - una cartella di documenti appartiene a UN solo team (niente cartelle annidate fra team:
 *   lo stesso file finirebbe in due team);
 * - per le sessioni vince la cartella più specifica: `C:\work` nel team A e `C:\work\clienteX`
 *   nel team B → le sessioni in `clienteX` vanno solo a B.
 *
 * Migrazione. Prima di B3 i file del team stavano direttamente nella home. Al primo avvio
 * vengono spostati in `teams/<id>/` e le impostazioni del team (cartelle, rete, dreaming)
 * passano da config.json a `teams/<id>/settings.json`. Nessun dato si perde.
 *
 * Eventi: `change` con `{ team, topic }` (team = id, o null per l'elenco dei team).
 */
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { ensureIdentity, type Identity, loadIdentity } from '../core/identity'
import type { NodeStatus } from '../core/model'
import { hostFiles, type NodePaths, teamPaths } from '../core/paths'
import type { Embedder } from '../embed/embedder'
import { LlmRunner } from '../llm/runner'
import type { LlmAdapter } from '../llm/types'
import { PrivateStore } from '../store/private-store'
import { canonicalPath, dhtBootstrap, isInsideWatched, loadConfig, loadState, type NetworkMode, readConfigFile, updateMachineConfig, writeConfigFile } from './config'
import { type ChangeTopic, createAdapter, createEmbedder, MicelioNode, UserError } from './micelio-node'

export interface MicelioHostOptions {
  /** Nodi di avvio della DHT per TUTTI i team (test). Assente = quelli di ciascun team. */
  bootstrap?: { host: string, port: number }[]
  log?: (msg: string) => void
  materializeDelayMs?: number
  /** Adapter LLM al posto di quello configurato (test). `null` = nessun LLM. */
  llm?: LlmAdapter | null
  /** Embedder al posto di quello configurato (test). `null` = solo parole chiave. */
  embedder?: Embedder | null
}

/** Un team come lo mostrano selettore della UI e `micelio teams`. */
export interface TeamSummary {
  /** Id locale (nome della cartella `teams/<id>`). */
  id: string
  /** Nome del team (dal log); null se non ancora sincronizzato. */
  name: string | null
  /** Nome con cui questo PC è entrato nel team. */
  nodeName: string | null
  role: 'admin' | 'member' | null
  members: number
  memories: number
  peers: number
  /** true per il team usato quando una richiesta non ne indica uno. */
  isDefault: boolean
}

/** Argomento degli eventi del padrone di casa: quale team (null = elenco dei team) e cosa è cambiato. */
export interface HostChange { team: string | null, topic: ChangeTopic | 'teams' }

/** Id locale di un team: 8 caratteri esadecimali casuali (non rivela le chiavi del team). */
const newTeamId = () => randomBytes(4).toString('hex')

/** File e cartelle di un team che, prima di B3, stavano nella home (vedi migrate). */
const LEGACY_ENTRIES = ['state.json', 'corestore', 'view.db', 'view.db-wal', 'view.db-shm', 'private.db', 'private.db-wal', 'private.db-shm', 'export', 'sources']

/** Sezioni di config.json che appartengono al team (vedi TEAM_SECTIONS in config.ts). */
const TEAM_SECTIONS = ['watch', 'network', 'dream']

export class MicelioHost extends EventEmitter {
  /** Nodi aperti per id: i team configurati più, al massimo, uno "in attesa" (vedi pending). */
  private readonly nodes = new Map<string, MicelioNode>()
  /** Id del nodo non ancora configurato, pronto per `init`/`join` (il primo team, o il prossimo). */
  private pendingId: string | null = null
  private readonly files
  private readonly log: (msg: string) => void
  private machineStore: PrivateStore | null = null
  private llm: LlmRunner | null = null
  private embedder: Embedder | null = null
  /** Embedder creato qui (da chiudere allo stop) o arrivato dalle opzioni (lo chiude il chiamante). */
  private ownsEmbedder = false

  constructor (private readonly root: NodePaths, private readonly opts: MicelioHostOptions = {}) {
    super()
    this.log = opts.log ?? (() => {})
    this.files = hostFiles(root)
    // Molti client SSE ascoltano lo stesso padrone di casa (vedi events.controller.ts)
    this.setMaxListeners(100)
  }

  // ═══════════════════════════════ Ciclo di vita ═══════════════════════════════

  /** Migra la struttura a un team, crea i servizi condivisi e apre tutti i team. */
  async start (): Promise<void> {
    fs.mkdirSync(this.files.teams, { recursive: true })
    this.migrate()
    const config = loadConfig(this.root)
    // Servizi condivisi: una coda LLM e un budget per macchina, un modello di embedding.
    this.machineStore = new PrivateStore(this.files.machine)
    const adapter = this.opts.llm !== undefined ? this.opts.llm : createAdapter(config)
    this.llm = adapter
      ? new LlmRunner(adapter, this.machineStore, { dailyBudget: () => loadConfig(this.root).llm.dailyBudget, log: this.log })
      : null
    this.ownsEmbedder = this.opts.embedder === undefined
    this.embedder = this.opts.embedder !== undefined ? this.opts.embedder : createEmbedder(config)

    for (const id of this.teamDirs()) {
      if (loadState(teamPaths(this.root, id))) {
        await this.openNode(id)
      } else if (!this.pendingId) {
        // Cartella di un team mai configurato (init/join non riuscito): diventa quella in attesa
        this.pendingId = id
      } else {
        fs.rmSync(path.join(this.files.teams, id), { recursive: true, force: true })
      }
    }
    // Nessun team ancora: si apre subito il nodo in attesa, per la schermata di benvenuto e init/join
    if (!this.configuredIds().length) await this.pendingNode()
    this.log(`team su questo PC: ${this.configuredIds().length}`)
  }

  /** Chiude tutti i team e i servizi condivisi. */
  async stop (): Promise<void> {
    for (const node of this.nodes.values()) await node.stop().catch((e) => this.log(`chiusura: ${(e as Error).message}`))
    this.nodes.clear()
    if (this.ownsEmbedder) await this.embedder?.close()
    this.machineStore?.close()
    this.machineStore = null
  }

  // ═══════════════════════════════════ Team ════════════════════════════════════

  /** Identità personale (null prima del primo init/join). */
  identity (): Identity | null {
    return loadIdentity(this.files.identity)
  }

  /** I team di questo PC, nell'ordine di creazione. */
  async teams (): Promise<TeamSummary[]> {
    const def = this.defaultId()
    const out: TeamSummary[] = []
    for (const id of this.configuredIds()) {
      const s: NodeStatus = await this.nodes.get(id)!.status()
      out.push({ id, name: s.team?.name ?? null, nodeName: s.nodeName, role: s.role, members: s.members, memories: s.memories, peers: s.peers, isDefault: id === def })
    }
    return out
  }

  /**
   * Il nodo di un team.
   * @param ref id locale o nome del team (maiuscole indifferenti); assente = team predefinito,
   *            o il nodo "in attesa" se su questo PC non c'è ancora nessun team
   * @throws UserError se il team non esiste o il nome è ambiguo
   */
  node (ref?: string | null): MicelioNode {
    if (!ref) {
      const def = this.defaultId()
      if (def) return this.nodes.get(def)!
      // Nessun team: il nodo in attesa è sempre aperto (vedi start e leaveTeam)
      const pending = this.pendingId ? this.nodes.get(this.pendingId) : undefined
      if (!pending) throw new UserError('Micelio si sta avviando: riprova fra qualche secondo', 'Micelio is starting: try again in a few seconds')
      return pending
    }
    return this.nodes.get(this.resolve(ref))!
  }

  /** Id locale del team di un nodo aperto. */
  idOf (node: MicelioNode): string {
    for (const [id, n] of this.nodes) if (n === node) return id
    throw new UserError('Team non trovato', 'Team not found')
  }

  /**
   * Id locale del team indicato: id (anche solo l'inizio) o nome del team, maiuscole indifferenti.
   * Sincrono: usa il nome letto all'ultima sincronizzazione di ciascun team.
   */
  resolve (ref: string): string {
    if (this.nodes.has(ref) && ref !== this.pendingId) return ref
    const wanted = ref.trim().toLowerCase()
    const matches = this.configuredIds().filter((id) => this.nodes.get(id)!.teamName?.toLowerCase() === wanted || id.startsWith(wanted))
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) throw new UserError(`"${ref}" corrisponde a più team: usa l'id (micelio teams)`, `"${ref}" matches more than one team: use the id (micelio teams)`)
    throw new UserError(`Nessun team "${ref}" su questo PC (micelio teams)`, `No team "${ref}" on this PC (micelio teams)`)
  }

  /**
   * Crea un nuovo team su questo PC (si aggiunge a quelli esistenti).
   * @param nodeName nome con cui presentarsi; assente = quello dell'identità personale
   * @param network  rete del nuovo team; assente = quella di default (DHT pubblica)
   */
  async createTeam (teamName: string, nodeName?: string, network?: NetworkMode): Promise<{ id: string, status: NodeStatus }> {
    const name = this.nameFor(nodeName)
    const node = await this.pendingNode()
    const id = this.pendingId!
    // Rete scelta alla creazione (es. «Solo per me» = nessuna rete, B4)
    if (network) node.prepareNetwork(network)
    const status = await node.init(teamName, name)
    this.configuredJoined(id)
    return { id, status }
  }

  /** Entra in un altro team con un codice d'invito (si aggiunge a quelli esistenti). */
  async joinTeam (code: string, nodeName?: string): Promise<{ id: string, status: NodeStatus }> {
    const name = this.nameFor(nodeName)
    const node = await this.pendingNode()
    const id = this.pendingId!
    const status = await node.join(code, name)
    this.configuredJoined(id)
    return { id, status }
  }

  /** Sceglie il team predefinito (usato dalle richieste che non ne indicano uno). */
  async setDefault (ref: string): Promise<TeamSummary[]> {
    const id = this.resolve(ref)
    updateMachineConfig(this.root.config, (raw) => { raw.defaultTeam = id })
    this.emitChange(null, 'teams')
    return this.teams()
  }

  /**
   * Toglie un team da QUESTO PC: chiude il nodo e cancella i suoi dati locali (log, indice,
   * archivio privato, impostazioni). Il team continua a esistere sui PC dei colleghi: per
   * rientrare serve un nuovo invito. Non si può annullare.
   */
  async leaveTeam (ref: string): Promise<TeamSummary[]> {
    const id = this.resolve(ref)
    const node = this.nodes.get(id)!
    this.nodes.delete(id)
    await node.stop()
    fs.rmSync(path.join(this.files.teams, id), { recursive: true, force: true })
    if (this.defaultId(true) === id) updateMachineConfig(this.root.config, (raw) => { delete raw.defaultTeam })
    this.log(`team ${id} tolto da questo PC`)
    // Senza più team il PC torna alla schermata di benvenuto: serve il nodo in attesa
    if (!this.configuredIds().length) await this.pendingNode()
    this.emitChange(null, 'teams')
    return this.teams()
  }

  // ═══════════════════════════ Instradamento per cartella ═══════════════════════════

  /**
   * Fine sessione di Claude Code (hook): la sessione va al team a cui appartiene la cartella di
   * lavoro, non al team predefinito. Se nessun team abilita la cartella, la sessione è ignorata.
   */
  async ingestSession (payload: { sessionId: string, transcriptPath: string, cwd: string }): Promise<{ queued: boolean, reason?: string, jobId?: number, team?: string }> {
    const owner = this.ownerOf(payload.cwd)
    if (!owner) {
      this.log(`sessione ${payload.sessionId.slice(0, 8)} ignorata: ${payload.cwd} non è abilitata in nessun team`)
      return { queued: false, reason: 'cartella non abilitata (micelio watch add)' }
    }
    return { ...this.nodes.get(owner)!.ingestSession(payload), team: owner }
  }

  /**
   * Contesto automatico per un agente (B4): dal team della cartella di lavoro, o dal predefinito
   * se la cartella non è abilitata in nessun team (lo stesso team che l'agente vede via `/mcp`).
   */
  async agentContext (o: { event: 'session-start' | 'prompt', cwd: string, sessionId?: string, prompt?: string }): Promise<string> {
    const owner = this.ownerOf(o.cwd)
    const node = owner ? this.nodes.get(owner) : this.node()
    return node ? node.agentContext(o) : ''
  }

  /**
   * Team a cui appartiene una cartella di lavoro: quello con la cartella abilitata più specifica
   * che la contiene (null se nessuno). Vedi il commento del file.
   */
  ownerOf (dir: string): string | null {
    let best: { id: string, len: number } | null = null
    for (const id of this.configuredIds()) {
      for (const w of this.nodes.get(id)!.settings().watched) {
        if (!isInsideWatched(dir, [w])) continue
        const len = canonicalPath(w).length
        if (!best || len > best.len) best = { id, len }
      }
    }
    return best?.id ?? null
  }

  /**
   * Controlla che una cartella si possa abilitare nel team `id` (vedi MicelioNodeOptions.claimFolder).
   * - Sessioni: vietata solo la STESSA cartella in due team (le annidate si risolvono con ownerOf).
   * - Documenti: vietate anche le cartelle annidate, perché il sorvegliante è ricorsivo e lo
   *   stesso file finirebbe in due team.
   */
  private claimFolder (id: string, dir: string, kind: 'sessions' | 'documents'): void {
    const target = canonicalPath(dir)
    // Su Windows le maiuscole nei percorsi non contano
    const norm = (p: string) => process.platform === 'win32' ? canonicalPath(p).toLowerCase() : canonicalPath(p)
    const same = (a: string) => norm(a) === norm(target)
    for (const other of this.configuredIds()) {
      if (other === id) continue
      const s = this.nodes.get(other)!.settings()
      const name = this.teamLabel(other)
      if (kind === 'sessions' && s.watched.some(same)) {
        throw new UserError(`La cartella è già abilitata nel team "${name}": una cartella appartiene a un solo team`, `The folder is already enabled in team "${name}": a folder belongs to one team only`)
      }
      if (kind === 'documents' && s.documents.some((d) => isInsideWatched(target, [d.path]) || isInsideWatched(d.path, [target]))) {
        throw new UserError(`La cartella (o una cartella che la contiene o che contiene) è già sorvegliata dal team "${name}": i documenti finirebbero in due team`, `This folder (or one containing it, or contained in it) is already watched by team "${name}": the documents would end up in two teams`)
      }
    }
  }

  // ═════════════════════════════════ Interni ═══════════════════════════════════

  /** Apre il nodo di un team e ne inoltra gli eventi. */
  private async openNode (id: string): Promise<MicelioNode> {
    const paths = teamPaths(this.root, id)
    const node = new MicelioNode(paths, {
      // Rete del team: ognuno può usare una DHT diversa (settings.json del team)
      bootstrap: this.opts.bootstrap ?? dhtBootstrap(loadConfig(paths)),
      log: (m) => this.log(this.nodes.size > 1 || this.configuredIds().length > 1 ? `[${id}] ${m}` : m),
      materializeDelayMs: this.opts.materializeDelayMs,
      llmRunner: this.llm,
      embedder: this.embedder,
      identity: () => this.identity(),
      owns: (dir) => this.ownerOf(dir) === id,
      claimFolder: (dir, kind) => this.claimFolder(id, dir, kind)
    })
    node.on('change', (topic: ChangeTopic) => {
      this.emitChange(id, topic)
      // Nome, ruolo, membri e ricordi compaiono anche nel selettore dei team
      if (topic === 'status') this.emitChange(null, 'teams')
      // Impostazioni della macchina (modelli, budget) cambiate da un team: le rileggono tutti
      if (topic === 'settings') {
        for (const [other, n] of this.nodes) {
          if (other !== id) { n.reloadConfig(); this.emitChange(other, 'settings') }
        }
      }
    })
    this.nodes.set(id, node)
    await node.start()
    return node
  }

  /** Il nodo in attesa di init/join (lo crea se non c'è). */
  private async pendingNode (): Promise<MicelioNode> {
    if (this.pendingId && this.nodes.has(this.pendingId)) return this.nodes.get(this.pendingId)!
    if (!this.pendingId) this.pendingId = newTeamId()
    return this.openNode(this.pendingId)
  }

  /** Il nodo in attesa è diventato un team: il prossimo team avrà una cartella nuova. */
  private configuredJoined (id: string): void {
    this.pendingId = null
    if (!this.defaultId(true)) updateMachineConfig(this.root.config, (raw) => { raw.defaultTeam = id })
    this.emitChange(null, 'teams')
  }

  /**
   * Nome con cui presentarsi a un nuovo team. La prima volta crea l'identità personale con
   * questo nome; poi, se non indicato, si usa quello dell'identità.
   */
  private nameFor (nodeName?: string): string {
    const name = nodeName?.trim() || this.identity()?.name
    if (!name) throw new UserError('Indica il tuo nome (come ti vedranno i colleghi)', 'Give your name (how colleagues will see you)')
    ensureIdentity(this.files.identity, name)
    return name
  }

  /** Id dei team configurati, in ordine di creazione (data della cartella). */
  private configuredIds (): string[] {
    return [...this.nodes.keys()].filter((id) => id !== this.pendingId && this.nodes.get(id)!.configured)
  }

  /**
   * Team predefinito: quello scelto in config.json se esiste ancora, altrimenti il primo.
   * @param raw true = solo quello scritto in config.json (anche se non esiste più)
   */
  private defaultId (raw = false): string | null {
    const chosen = loadConfig(this.root).defaultTeam ?? null
    if (raw) return chosen
    const ids = this.configuredIds()
    return chosen && ids.includes(chosen) ? chosen : (ids[0] ?? null)
  }

  /** Cartelle `teams/<id>` presenti su disco, dalla più vecchia. */
  private teamDirs (): string[] {
    const dirs = fs.readdirSync(this.files.teams, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    // birthtime non è disponibile su tutti i file system: in quel caso vale la data di modifica
    const born = (id: string) => { const st = fs.statSync(path.join(this.files.teams, id)); return st.birthtimeMs || st.ctimeMs }
    return dirs.sort((a, b) => born(a) - born(b))
  }

  /** Nome leggibile di un team per i messaggi (id se il nome non è ancora noto). */
  private teamLabel (id: string): string {
    return this.nodes.get(id)?.teamName ?? id
  }

  private emitChange (team: string | null, topic: HostChange['topic']): void {
    this.emit('change', { team, topic } satisfies HostChange)
  }

  /**
   * Migrazione dalla struttura a un team (prima di B3): se nella home c'è state.json, i file del
   * team si spostano in `teams/<id>/`, le sezioni del team di config.json in settings.json, il
   * nome del nodo diventa quello dell'identità personale. Il team diventa il predefinito.
   */
  private migrate (): void {
    const legacyState = path.join(this.root.home, 'state.json')
    if (!fs.existsSync(legacyState)) return
    const id = newTeamId()
    const dir = path.join(this.files.teams, id)
    fs.mkdirSync(dir, { recursive: true })
    for (const entry of LEGACY_ENTRIES) {
      const from = path.join(this.root.home, entry)
      if (fs.existsSync(from)) fs.renameSync(from, path.join(dir, entry))
    }
    const raw = readConfigFile(this.root.config)
    const settings = Object.fromEntries(TEAM_SECTIONS.filter((k) => k in raw).map((k) => [k, raw[k]]))
    writeConfigFile(path.join(dir, 'settings.json'), settings)
    updateMachineConfig(this.root.config, (r) => {
      for (const k of TEAM_SECTIONS) delete r[k]
      r.defaultTeam = id
    })
    const state = loadState(teamPaths(this.root, id))
    if (state) ensureIdentity(this.files.identity, state.nodeName)
    this.log(`struttura a più team: il team esistente è stato spostato in teams/${id}`)
  }
}
