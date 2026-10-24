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
 *
 * EN: Several teams on the same machine (B3): the "host" of the nodes.
 *
 * EN: A `MicelioNode` manages ONE team. `MicelioHost` manages as many as needed, one per
 * `teams/<id>/` folder (layout in src/core/paths.ts), and holds together what is unique per
 * machine:
 * - the **personal identity** (identity.json): the same person in every team;
 * - the **LLM runner**: a single queue (one call to Claude at a time) and a single daily
 *   budget (machine.db), because there is one subscription;
 * - the **embedder**: the vector model is loaded only once;
 * - the **default team**: the one used when a request doesn't name one.
 *
 * EN: Knowledge separation. Each team has its own keys, log, index, private store, export, network
 * (even different DHTs) and folders: nothing passes from one team to another. Claude Code
 * sessions and documents go to the team the folder belongs to:
 * - a document folder belongs to ONE team only (no folders nested across teams:
 *   the same file would end up in two teams);
 * - for sessions the most specific folder wins: `C:\work` in team A and `C:\work\clienteX`
 *   in team B → sessions in `clienteX` go only to B.
 *
 * EN: Migration. Before B3 the team files lived directly in the home. At first startup
 * they are moved to `teams/<id>/` and the team settings (folders, network, dreaming)
 * move from config.json to `teams/<id>/settings.json`. No data is lost.
 *
 * EN: Events: `change` with `{ team, topic }` (team = id, or null for the team list).
 */
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { ensureIdentity, type Identity, loadIdentity } from '../core/identity'
import type { NodeStatus } from '../core/model'
import type { MemoryData, MemoryInput } from '../core/events'
import { checkSessionTeam, type TeamRef } from '../core/team-check'
import type { ExplicitOutcome } from '../ingest/pipeline'
import { hostFiles, type NodePaths, teamPaths } from '../core/paths'
import type { Embedder } from '../embed/embedder'
import { LlmRunner } from '../llm/runner'
import type { LlmAdapter } from '../llm/types'
import { PrivateStore } from '../store/private-store'
import { decodeBackup } from '../backup/archive'
import { canonicalPath, dhtBootstrap, isInsideWatched, loadConfig, loadState, type NetworkMode, readConfigFile, updateMachineConfig, writeConfigFile } from './config'
import { type ChangeTopic, createAdapter, createEmbedder, MicelioNode, UserError } from './micelio-node'

export interface MicelioHostOptions {
  /** Nodi di avvio della DHT per TUTTI i team (test). Assente = quelli di ciascun team. / EN: DHT bootstrap nodes for ALL teams (tests). Missing = each team's own. */
  bootstrap?: { host: string, port: number }[]
  log?: (msg: string) => void
  materializeDelayMs?: number
  /** Adapter LLM al posto di quello configurato (test). `null` = nessun LLM. / EN: LLM adapter instead of the configured one (tests). `null` = no LLM. */
  llm?: LlmAdapter | null
  /** Embedder al posto di quello configurato (test). `null` = solo parole chiave. / EN: Embedder instead of the configured one (tests). `null` = keywords only. */
  embedder?: Embedder | null
}

/** Un team come lo mostrano selettore della UI e `micelio teams`. / EN: A team as shown by the UI selector and `micelio teams`. */
export interface TeamSummary {
  /** Id locale (nome della cartella `teams/<id>`). / EN: Local id (name of the `teams/<id>` folder). */
  id: string
  /** Nome del team (dal log); null se non ancora sincronizzato. / EN: Team name (from the log); null if not synced yet. */
  name: string | null
  /** Nome con cui questo PC è entrato nel team. / EN: Name this PC joined the team with. */
  nodeName: string | null
  role: 'admin' | 'member' | null
  members: number
  memories: number
  peers: number
  /** true per il team usato quando una richiesta non ne indica uno. / EN: true for the team used when a request doesn't name one. */
  isDefault: boolean
}

/** Argomento degli eventi del padrone di casa: quale team (null = elenco dei team) e cosa è cambiato. / EN: Payload of the host's events: which team (null = team list) and what changed. */
export interface HostChange { team: string | null, topic: ChangeTopic | 'teams' }

/** Id locale di un team: 8 caratteri esadecimali casuali (non rivela le chiavi del team). / EN: Local id of a team: 8 random hex characters (doesn't reveal the team keys). */
const newTeamId = () => randomBytes(4).toString('hex')

/** File e cartelle di un team che, prima di B3, stavano nella home (vedi migrate). / EN: A team's files and folders that, before B3, lived in the home (see migrate). */
const LEGACY_ENTRIES = ['state.json', 'corestore', 'view.db', 'view.db-wal', 'view.db-shm', 'private.db', 'private.db-wal', 'private.db-shm', 'export', 'sources']

/** Sezioni di config.json che appartengono al team (vedi TEAM_SECTIONS in config.ts). / EN: config.json sections that belong to the team (see TEAM_SECTIONS in config.ts). */
const TEAM_SECTIONS = ['watch', 'network', 'dream', 'agentFiles']

export class MicelioHost extends EventEmitter {
  /** Nodi aperti per id: i team configurati più, al massimo, uno "in attesa" (vedi pending). / EN: Open nodes by id: the configured teams plus at most one "pending" (see pending). */
  private readonly nodes = new Map<string, MicelioNode>()
  /** Id del nodo non ancora configurato, pronto per `init`/`join` (il primo team, o il prossimo). / EN: Id of the not-yet-configured node, ready for `init`/`join` (the first team, or the next one). */
  private pendingId: string | null = null
  private readonly files
  private readonly log: (msg: string) => void
  private machineStore: PrivateStore | null = null
  private llm: LlmRunner | null = null
  private embedder: Embedder | null = null
  /** Embedder creato qui (da chiudere allo stop) o arrivato dalle opzioni (lo chiude il chiamante). / EN: Embedder created here (to close on stop) or passed in the options (the caller closes it). */
  private ownsEmbedder = false

  constructor (private readonly root: NodePaths, private readonly opts: MicelioHostOptions = {}) {
    super()
    this.log = opts.log ?? (() => {})
    this.files = hostFiles(root)
    // Molti client SSE ascoltano lo stesso padrone di casa (vedi events.controller.ts)
    // EN: Many SSE clients listen to the same host (see events.controller.ts)
    this.setMaxListeners(100)
  }

  // ═══════════════════════════════ Ciclo di vita ═══════════════════════════════
  // EN: Lifecycle

  /** Migra la struttura a un team, crea i servizi condivisi e apre tutti i team. / EN: Migrates the single-team layout, creates the shared services and opens all teams. */
  async start (): Promise<void> {
    fs.mkdirSync(this.files.teams, { recursive: true })
    this.migrate()
    const config = loadConfig(this.root)
    // Servizi condivisi: una coda LLM e un budget per macchina, un modello di embedding.
    // EN: Shared services: one LLM queue and one budget per machine, one embedding model.
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
        // EN: Folder of a team never configured (failed init/join): it becomes the pending one
        this.pendingId = id
      } else {
        fs.rmSync(path.join(this.files.teams, id), { recursive: true, force: true })
      }
    }
    // Nessun team ancora: si apre subito il nodo in attesa, per la schermata di benvenuto e init/join
    // EN: No team yet: open the pending node right away, for the welcome screen and init/join
    if (!this.configuredIds().length) await this.pendingNode()
    this.log(`team su questo PC: ${this.configuredIds().length}`)
  }

  /** Chiude tutti i team e i servizi condivisi. / EN: Closes all teams and the shared services. */
  async stop (): Promise<void> {
    for (const node of this.nodes.values()) await node.stop().catch((e) => this.log(`chiusura: ${(e as Error).message}`))
    this.nodes.clear()
    if (this.ownsEmbedder) await this.embedder?.close()
    this.machineStore?.close()
    this.machineStore = null
  }

  // ═══════════════════════════════════ Team ════════════════════════════════════
  // EN: Teams

  /** Identità personale (null prima del primo init/join). / EN: Personal identity (null before the first init/join). */
  identity (): Identity | null {
    return loadIdentity(this.files.identity)
  }

  /** I team di questo PC, nell'ordine di creazione. / EN: This PC's teams, in creation order. */
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
   *
   * EN: A team's node.
   * @param ref id locale o nome del team (maiuscole indifferenti); assente = team predefinito,
   *            o il nodo "in attesa" se su questo PC non c'è ancora nessun team
   *            EN: local id or team name (case-insensitive); missing = default team,
   *            or the "pending" node if there is no team on this PC yet
   * @throws UserError se il team non esiste o il nome è ambiguo
   *         EN: UserError if the team doesn't exist or the name is ambiguous
   */
  node (ref?: string | null): MicelioNode {
    if (!ref) {
      const def = this.defaultId()
      if (def) return this.nodes.get(def)!
      // Nessun team: il nodo in attesa è sempre aperto (vedi start e leaveTeam)
      // EN: No team: the pending node is always open (see start and leaveTeam)
      const pending = this.pendingId ? this.nodes.get(this.pendingId) : undefined
      if (!pending) throw new UserError('Micelio si sta avviando: riprova fra qualche secondo', 'Micelio is starting: try again in a few seconds')
      return pending
    }
    return this.nodes.get(this.resolve(ref))!
  }

  /** Id locale del team di un nodo aperto. / EN: Local team id of an open node. */
  idOf (node: MicelioNode): string {
    for (const [id, n] of this.nodes) if (n === node) return id
    throw new UserError('Team non trovato', 'Team not found')
  }

  /**
   * Id locale del team indicato: id (anche solo l'inizio) o nome del team, maiuscole indifferenti.
   * Sincrono: usa il nome letto all'ultima sincronizzazione di ciascun team.
   *
   * EN: Local id of the given team: id (even just its start) or team name, case-insensitive.
   * Synchronous: uses the name read at each team's last sync.
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
   *
   * EN: Creates a new team on this PC (added to the existing ones).
   * @param nodeName nome con cui presentarsi; assente = quello dell'identità personale
   *                 EN: name to introduce yourself with; missing = the personal identity's name
   * @param network  rete del nuovo team; assente = quella di default (DHT pubblica)
   *                 EN: network of the new team; missing = the default one (public DHT)
   */
  async createTeam (teamName: string, nodeName?: string, network?: NetworkMode): Promise<{ id: string, status: NodeStatus }> {
    const name = this.nameFor(nodeName)
    const node = await this.pendingNode()
    const id = this.pendingId!
    // Rete scelta alla creazione (es. «Solo per me» = nessuna rete, B4)
    // EN: Network chosen at creation (e.g. «Just for me» = no network, B4)
    if (network) node.prepareNetwork(network)
    const status = await node.init(teamName, name)
    this.configuredJoined(id)
    return { id, status }
  }

  /**
   * Ripristina un backup (B7) in un team NUOVO su questo PC: chi ripristina ne è fondatore e admin,
   * i colleghi rientrano con un invito (le chiavi del team d'origine non sono nel backup).
   * La password si verifica PRIMA di creare il team: una password sbagliata non lascia un team vuoto.
   *
   * EN: Restores a backup (B7) into a NEW team on this PC: whoever restores is its founder and admin,
   * colleagues come back in with an invite (the original team's keys are not in the backup).
   * The password is checked BEFORE creating the team: a wrong password doesn't leave an empty team.
   * @param teamName nome del team nuovo; assente = quello del team d'origine
   *                 EN: name of the new team; missing = the original team's name
   */
  async restoreAsNewTeam (file: Buffer, password: string, opts: { teamName?: string, nodeName?: string, network?: NetworkMode } = {}): Promise<{ id: string, report: Awaited<ReturnType<MicelioNode['restoreBackup']>> }> {
    const { manifest } = decodeBackup(file, password)
    const { id } = await this.createTeam(opts.teamName?.trim() || manifest.team, opts.nodeName, opts.network)
    const report = await this.nodes.get(id)!.restoreBackup(file, password, { fresh: true })
    this.emitChange(null, 'teams')
    return { id, report }
  }

  /** Entra in un altro team con un codice d'invito (si aggiunge a quelli esistenti). / EN: Joins another team with an invite code (added to the existing ones). */
  async joinTeam (code: string, nodeName?: string): Promise<{ id: string, status: NodeStatus }> {
    const name = this.nameFor(nodeName)
    const node = await this.pendingNode()
    const id = this.pendingId!
    const status = await node.join(code, name)
    this.configuredJoined(id)
    return { id, status }
  }

  /** Sceglie il team predefinito (usato dalle richieste che non ne indicano uno). / EN: Sets the default team (used by requests that don't name one). */
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
   *
   * EN: Removes a team from THIS PC: closes the node and deletes its local data (log, index,
   * private store, settings). The team keeps existing on colleagues' PCs: rejoining
   * requires a new invite. It cannot be undone.
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
    // EN: With no teams left the PC goes back to the welcome screen: the pending node is needed
    if (!this.configuredIds().length) await this.pendingNode()
    this.emitChange(null, 'teams')
    return this.teams()
  }

  // ═══════════════════════════ Instradamento per cartella ═══════════════════════════
  // EN: Routing by folder

  /**
   * Fine sessione di Claude Code (hook): la sessione va al team a cui appartiene la cartella di
   * lavoro, non al team predefinito. Se nessun team abilita la cartella, la sessione è ignorata.
   *
   * EN: Claude Code session end (hook): the session goes to the team the working folder belongs
   * to, not to the default team. If no team enables the folder, the session is ignored.
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
   *
   * EN: Automatic context for an agent (B4): from the working folder's team, or from the default
   * one if the folder isn't enabled in any team (the same team the agent sees via `/mcp`).
   */
  async agentContext (o: { event: 'session-start' | 'prompt', cwd: string, sessionId?: string, prompt?: string }): Promise<string> {
    const owner = this.ownerOf(o.cwd)
    const node = owner ? this.nodes.get(owner) : this.node()
    return node ? node.agentContext(o) : ''
  }

  /**
   * Team a cui appartiene una cartella di lavoro: quello con la cartella abilitata più specifica
   * che la contiene (null se nessuno). Vedi il commento del file.
   *
   * EN: Team a working folder belongs to: the one with the most specific enabled folder
   * containing it (null if none). See the file comment.
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
   * Salvataggio di un agente (tool MCP `remember`) con il controllo del team (0.6.1, vedi
   * src/core/team-check.ts): la cartella della sessione deve essere abilitata nel team su cui
   * l'agente salva. Se non lo è il ricordo va in Inbox, mai pubblicato:
   * - nell'Inbox del team che possiede la cartella, se c'è (approvarlo lo pubblica lì);
   * - altrimenti nell'Inbox del team della sessione, da dove si sposta con «Pubblica in…».
   *
   * EN: Save from an agent (MCP `remember` tool) with the team check (0.6.1, see
   * src/core/team-check.ts): the session's folder must be enabled in the team the agent saves to.
   * If it isn't, the memory goes to the Inbox, never published:
   * - to the Inbox of the team that owns the folder, if there is one (approving publishes it there);
   * - otherwise to the session team's Inbox, from where it can be moved with «Pubblica in…».
   * @param node nodo del team della connessione MCP
   *        EN: node of the MCP connection's team
   * @param cwd cartella della sessione, null se il client non l'ha mandata
   *        EN: the session's folder, null if the client didn't send it
   * @returns l'esito e il team in cui è finito
   *          EN: the outcome and the team it ended up in
   */
  async rememberFromAgent (node: MicelioNode, input: MemoryInput, cwd: string | null): Promise<{ outcome: ExplicitOutcome, team: TeamRef }> {
    const ref = (id: string): TeamRef => ({ id, name: this.nodes.get(id)?.teamName ?? id })
    const session = ref(this.idOf(node))
    const check = checkSessionTeam(cwd, session, (d) => this.ownerOf(d), (id) => ref(id).name)
    const target = check?.folder ? this.nodes.get(check.folder.id)! : node
    const team = check?.folder ?? session
    return { outcome: await target.remember(input, check ?? undefined), team }
  }

  /**
   * «Pubblica in…» dall'Inbox (0.6.1): sposta un elemento nell'Inbox di un altro team e, se
   * richiesto, lo approva subito lì. Per i salvataggi trattenuti dal controllo del team.
   *
   * EN: «Pubblica in…» (Publish to…) from the Inbox (0.6.1): moves an item to another team's Inbox
   * and, if asked, approves it right away there. For saves held by the team check.
   * @param from team dell'Inbox in cui sta l'elemento
   *        EN: team of the Inbox the item is in
   * @param to team di destinazione (id o nome)
   *        EN: destination team (id or name)
   */
  async moveInbox (from: string, id: string, to: string, publish: boolean): Promise<{ team: string, inboxId?: string, published?: { id: string, duplicate: boolean, memory: MemoryData } }> {
    const src = this.node(from)
    const dstId = this.resolve(to)
    const dst = this.nodes.get(dstId)!
    if (dst === src) throw new UserError('L\'elemento è già nell\'Inbox di questo team: approvalo', 'The item is already in this team\'s Inbox: approve it')
    const inboxId = dst.receiveInbox(src.takeInbox(id, dst.teamName ?? dstId))
    if (!publish) return { team: dstId, inboxId }
    return { team: dstId, published: await dst.approve(inboxId) }
  }

  /**
   * Controlla che una cartella si possa abilitare nel team `id` (vedi MicelioNodeOptions.claimFolder).
   * - Sessioni: vietata solo la STESSA cartella in due team (le annidate si risolvono con ownerOf).
   * - Documenti: vietate anche le cartelle annidate, perché il sorvegliante è ricorsivo e lo
   *   stesso file finirebbe in due team.
   *
   * EN: Checks that a folder can be enabled in team `id` (see MicelioNodeOptions.claimFolder).
   * - Sessions: only the SAME folder in two teams is forbidden (nested ones are resolved by ownerOf).
   * - Documents: nested folders are forbidden too, because the watcher is recursive and the
   *   same file would end up in two teams.
   */
  private claimFolder (id: string, dir: string, kind: 'sessions' | 'documents'): void {
    const target = canonicalPath(dir)
    // Su Windows le maiuscole nei percorsi non contano
    // EN: On Windows, case in paths doesn't matter
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
  // EN: Internals

  /** Apre il nodo di un team e ne inoltra gli eventi. / EN: Opens a team's node and forwards its events. */
  private async openNode (id: string): Promise<MicelioNode> {
    const paths = teamPaths(this.root, id)
    const node = new MicelioNode(paths, {
      // Rete del team: ognuno può usare una DHT diversa (settings.json del team)
      // EN: Team network: each one can use a different DHT (the team's settings.json)
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
      // EN: Name, role, members and memories also appear in the team selector
      if (topic === 'status') this.emitChange(null, 'teams')
      // Impostazioni della macchina (modelli, budget) cambiate da un team: le rileggono tutti
      // EN: Machine settings (models, budget) changed by one team: all of them reload them
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

  /** Il nodo in attesa di init/join (lo crea se non c'è). / EN: The node waiting for init/join (creates it if missing). */
  private async pendingNode (): Promise<MicelioNode> {
    if (this.pendingId && this.nodes.has(this.pendingId)) return this.nodes.get(this.pendingId)!
    if (!this.pendingId) this.pendingId = newTeamId()
    return this.openNode(this.pendingId)
  }

  /** Il nodo in attesa è diventato un team: il prossimo team avrà una cartella nuova. / EN: The pending node has become a team: the next team will get a new folder. */
  private configuredJoined (id: string): void {
    this.pendingId = null
    if (!this.defaultId(true)) updateMachineConfig(this.root.config, (raw) => { raw.defaultTeam = id })
    this.emitChange(null, 'teams')
  }

  /**
   * Nome con cui presentarsi a un nuovo team. La prima volta crea l'identità personale con
   * questo nome; poi, se non indicato, si usa quello dell'identità.
   *
   * EN: Name to introduce yourself to a new team with. The first time it creates the personal
   * identity with this name; afterwards, if not given, the identity's name is used.
   */
  private nameFor (nodeName?: string): string {
    const name = nodeName?.trim() || this.identity()?.name
    if (!name) throw new UserError('Indica il tuo nome (come ti vedranno i colleghi)', 'Give your name (how colleagues will see you)')
    ensureIdentity(this.files.identity, name)
    return name
  }

  /** Id dei team configurati, in ordine di creazione (data della cartella). / EN: Ids of the configured teams, in creation order (folder date). */
  private configuredIds (): string[] {
    return [...this.nodes.keys()].filter((id) => id !== this.pendingId && this.nodes.get(id)!.configured)
  }

  /**
   * Team predefinito: quello scelto in config.json se esiste ancora, altrimenti il primo.
   *
   * EN: Default team: the one chosen in config.json if it still exists, otherwise the first one.
   * @param raw true = solo quello scritto in config.json (anche se non esiste più)
   *            EN: true = only the one written in config.json (even if it no longer exists)
   */
  private defaultId (raw = false): string | null {
    const chosen = loadConfig(this.root).defaultTeam ?? null
    if (raw) return chosen
    const ids = this.configuredIds()
    return chosen && ids.includes(chosen) ? chosen : (ids[0] ?? null)
  }

  /** Cartelle `teams/<id>` presenti su disco, dalla più vecchia. / EN: `teams/<id>` folders on disk, oldest first. */
  private teamDirs (): string[] {
    const dirs = fs.readdirSync(this.files.teams, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    // birthtime non è disponibile su tutti i file system: in quel caso vale la data di modifica
    // EN: birthtime isn't available on every file system: in that case the change time is used
    const born = (id: string) => { const st = fs.statSync(path.join(this.files.teams, id)); return st.birthtimeMs || st.ctimeMs }
    return dirs.sort((a, b) => born(a) - born(b))
  }

  /** Nome leggibile di un team per i messaggi (id se il nome non è ancora noto). / EN: Readable team name for messages (id if the name isn't known yet). */
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
   *
   * EN: Migration from the single-team layout (before B3): if the home has a state.json, the team
   * files move to `teams/<id>/`, the team sections of config.json to settings.json, and the
   * node name becomes the personal identity's name. The team becomes the default one.
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
