/**
 * @file Nodo Micelio: l'orchestratore di tutto ciò che vive su una macchina.
 *
 * Mette insieme:
 * - `TeamNode`        rete P2P e log del team (src/net);
 * - `MemoryIndex`     ricerca locale, derivata dalla vista (src/store/memory-index);
 * - `PrivateStore`    archivio privato: inbox, decisioni, coda, budget (src/store/private-store);
 * - `IngestPipeline`  filtro + classificazione + distillazione (src/ingest);
 * - export Markdown   (src/export).
 *
 * Non dipende da NestJS né da HTTP: il daemon lo espone via API e MCP, i test lo usano
 * direttamente. Ogni operazione "utente" (CLI, API, MCP, UI) passa da qui.
 *
 * Eventi: il nodo è un EventEmitter che emette `change` con un "argomento" (ChangeTopic) ogni
 * volta che una parte del suo stato cambia. Il daemon li inoltra alla UI (SSE /api/events),
 * che ricarica solo i dati interessati invece di interrogare il daemon a intervalli.
 *
 * Errori: le condizioni causate dall'utente (nodo non configurato, permessi, input non valido)
 * sono `UserError` e diventano HTTP 400 con un messaggio leggibile; il resto sono bug (500).
 */
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { MemoryInput, memoryId, type MemoryData } from '../core/events'
import type { InviteRecord, MemberRecord, NodeStatus, RecallHit } from '../core/model'
import type { NodePaths } from '../core/paths'
import { writeExport } from '../export/markdown'
import { type ExplicitOutcome, IngestPipeline, InboxNotFoundError } from '../ingest/pipeline'
import { ClaudeCliAdapter } from '../llm/claude-cli'
import { FakeAdapter } from '../llm/fake'
import { LlmRunner } from '../llm/runner'
import type { LlmAdapter } from '../llm/types'
import { TeamNode } from '../net/team-node'
import { mergeRules } from '../privacy/filter'
import { MemoryIndex } from '../store/memory-index'
import { type Decision, type InboxItem, PrivateStore } from '../store/private-store'
import { canonicalPath, type Config, isInsideWatched, loadConfig, loadState, saveState, updateConfig } from './config'

export interface MicelioNodeOptions {
  /** Nodi bootstrap DHT (test o rete privata); assente = DHT pubblica. */
  bootstrap?: { host: string, port: number }[]
  log?: (msg: string) => void
  /** Ritardo con cui si accorpano gli aggiornamenti della vista prima di reindicizzare. */
  materializeDelayMs?: number
  /**
   * Adapter LLM da usare al posto di quello configurato (test). `null` = nessun LLM.
   * Se omesso si usa `llm.adapter` di config.json.
   */
  llm?: LlmAdapter | null
}

/** Errore causato dall'utente o dallo stato del nodo: messaggio pensato per essere mostrato. */
export class UserError extends Error {}

/**
 * Parti dello stato che possono cambiare, usate come "argomento" degli eventi `change`:
 * - status:    stato del nodo e del team (peer, ruolo, configurazione del team);
 * - memories:  ricordi del team;   members: membri;
 * - inbox, jobs, decisions: archivio privato (inbox, coda di ingestione, registro);
 * - settings:  impostazioni locali (cartelle abilitate, LLM).
 */
export type ChangeTopic = 'status' | 'memories' | 'members' | 'inbox' | 'jobs' | 'decisions' | 'settings'

/** Impostazioni LOCALI modificabili dalla UI (config.json). */
export interface NodeSettings {
  llm: { adapter: string, command: string, classifyModel: string, distillModel: string, dailyBudget: number }
  watched: string[]
  port: number
}

/** Stato dell'ingestione, per `micelio ingest status` e la futura Dashboard. */
export interface IngestStatus {
  llm: { adapter: string, available: boolean, budget: { used: number, limit: number } } | null
  jobs: Record<string, number>
  inbox: number
  watched: string[]
}

export class MicelioNode extends EventEmitter {
  private team: TeamNode | null = null
  private nodeName: string | null = null
  private readonly index: MemoryIndex
  private readonly privateStore: PrivateStore
  private readonly pipeline: IngestPipeline
  private readonly llm: LlmRunner | null
  private config: Config
  /** Timer di accorpamento degli aggiornamenti della vista (vedi scheduleMaterialize). */
  private timer: NodeJS.Timeout | null = null
  /** Catena delle materializzazioni: mai due ricostruzioni dell'indice in parallelo. */
  private materializing: Promise<void> = Promise.resolve()
  private readonly log: (msg: string) => void

  constructor (private readonly paths: NodePaths, private readonly opts: MicelioNodeOptions = {}) {
    super()
    this.log = opts.log ?? (() => {})
    fs.mkdirSync(paths.home, { recursive: true })
    this.config = loadConfig(paths)
    this.index = new MemoryIndex(paths.index)
    this.privateStore = new PrivateStore(paths.private)

    // Scelta dell'adapter: override dei test > configurazione.
    const adapter = opts.llm !== undefined ? opts.llm : createAdapter(this.config)
    // Budget e modelli si leggono da this.config a ogni uso: la UI può cambiarli senza riavvio.
    this.llm = adapter ? new LlmRunner(adapter, this.privateStore, { dailyBudget: () => this.config.llm.dailyBudget, log: this.log }) : null

    this.pipeline = new IngestPipeline({
      store: this.privateStore,
      llm: this.llm,
      models: () => ({ classify: this.config.llm.classifyModel, distill: this.config.llm.distillModel }),
      publish: (m) => this.publish(m),
      // Regole e lingua si leggono dalla vista a ogni uso: un admin può cambiarle in qualunque momento.
      rules: async () => mergeRules(await this.team?.config('filter.blockKeywords')),
      language: async () => (await this.team?.config<string>('memory.language')) ?? 'it',
      log: this.log,
      notify: (topic) => this.changed(topic)
    })
  }

  // ═══════════════════════════════ Ciclo di vita ═══════════════════════════════

  /** Avvia il nodo: se il team è già configurato si ricollega alla rete. Avvia il worker di ingestione. */
  async start (): Promise<void> {
    this.pipeline.start()
    const state = loadState(this.paths)
    if (!state) {
      this.log('nodo non ancora configurato: usa `micelio init` o `micelio join`')
      return
    }
    this.nodeName = state.nodeName
    const team = this.newTeamNode()
    await team.open(state)
    this.attach(team)
    await this.materialize()
  }

  /** Ferma tutto in ordine: worker, indicizzazione in corso, rete, database. */
  async stop (): Promise<void> {
    await this.pipeline.stop()
    if (this.timer) clearTimeout(this.timer)
    await this.materializing.catch(() => {})
    await this.team?.close()
    this.team = null
    this.index.close()
    this.privateStore.close()
  }

  // ═══════════════════════════════════ Team ════════════════════════════════════

  /** Crea un nuovo team con questo nodo come fondatore. */
  async init (teamName: string, nodeName: string): Promise<NodeStatus> {
    this.assertNotConfigured()
    const team = this.newTeamNode()
    try {
      const secrets = await team.create(teamName, nodeName)
      saveState(this.paths, { nodeName, ...secrets })
    } catch (err) {
      await team.close() // non lasciare swarm e file aperti se qualcosa va storto
      throw err
    }
    this.nodeName = nodeName
    this.attach(team)
    await this.materialize()
    this.changed('status')
    return this.status()
  }

  /** Entra in un team esistente con un codice d'invito. */
  async join (code: string, nodeName: string): Promise<NodeStatus> {
    this.assertNotConfigured()
    const team = this.newTeamNode()
    try {
      const secrets = await team.join(code, nodeName)
      saveState(this.paths, { nodeName, ...secrets })
    } catch (err) {
      await team.close()
      throw err
    }
    this.nodeName = nodeName
    this.attach(team)
    await this.materialize()
    this.changed('status')
    return this.status()
  }

  /** Crea un invito (qualunque membro). Vedi TeamNode.createInvite per `replicated`. */
  async invite (): Promise<{ code: string, expires: number, replicated: boolean }> {
    return this.requireTeam().createInvite()
  }

  /** Inviti non ancora usati. */
  async invites (): Promise<InviteRecord[]> {
    return this.requireTeam().invites()
  }

  /** Tutti i membri, compresi gli espulsi. */
  async members (): Promise<MemberRecord[]> {
    return this.requireTeam().members()
  }

  /** Espelle un membro (solo admin). Un nodo non può espellere se stesso. */
  async removeMember (ref: string): Promise<MemberRecord> {
    await this.requireAdmin()
    const target = await this.resolveMember(ref)
    if (target.key === this.team?.localKey) throw new UserError('Un nodo non può espellere se stesso')
    await this.requireTeam().append({ type: 'member.remove', key: target.key })
    await this.sync()
    return target
  }

  /** Promuove un membro ad admin e indexer (solo admin). */
  async promoteMember (ref: string): Promise<MemberRecord> {
    await this.requireAdmin()
    const target = await this.resolveMember(ref)
    await this.requireTeam().append({ type: 'member.promote', key: target.key })
    await this.sync()
    return target
  }

  /**
   * Imposta una configurazione condivisa del team (solo admin).
   * Chiavi note: `memory.language` (es. "it", "en"), `filter.blockKeywords` (array di stringhe).
   */
  async setTeamConfig (key: string, value: unknown): Promise<void> {
    await this.requireAdmin()
    await this.requireTeam().append({ type: 'team.config', key, value })
    await this.sync()
    this.changed('status')
  }

  /** Configurazione condivisa del team (lingua, parole chiave del filtro), per la UI. */
  async teamConfig (): Promise<{ language: string, blockKeywords: string[] }> {
    const team = this.requireTeam()
    const kw = await team.config<unknown>('filter.blockKeywords')
    return {
      language: (await team.config<string>('memory.language')) ?? 'it',
      blockKeywords: Array.isArray(kw) ? kw.filter((k): k is string => typeof k === 'string') : []
    }
  }

  // ═════════════════════════════════ Ricordi ═══════════════════════════════════

  /**
   * Salvataggio ESPLICITO (CLI, API, MCP). Passa da filtro e classificazione (decisione D6):
   * l'esito può essere "team", "inbox" o "private".
   */
  async remember (input: MemoryInput): Promise<ExplicitOutcome> {
    this.requireTeam()
    const parsed = MemoryInput.safeParse(input)
    if (!parsed.success) throw new UserError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    return this.pipeline.ingestExplicit(parsed.data)
  }

  /** Ricerca full-text nella memoria del team (indice locale). */
  recall (query: string, limit = 5): RecallHit[] {
    return this.index.search(query, limit)
  }

  /** Un ricordo per id (anche abbreviato). */
  get (id: string): RecallHit | null {
    return this.index.get(id)
  }

  /**
   * Pubblica un ricordo nel team SENZA filtri: usato dalla pipeline dopo che ha deciso.
   * Non esposto all'esterno: tutto ciò che arriva da fuori passa da `remember`.
   */
  private async publish (memory: MemoryData): Promise<{ id: string, duplicate: boolean }> {
    const team = this.requireTeam()
    const id = memoryId(memory)
    // Controllo locale dei duplicati: evita di scrivere nel log un evento che apply ignorerebbe.
    const duplicate = this.index.get(id)?.id === id
    if (!duplicate) {
      await team.append({ type: 'memory.add', memory })
      await this.sync()
    }
    return { id, duplicate }
  }

  // ═══════════════════════════ Ingestione automatica ═══════════════════════════

  /**
   * Riceve la notifica di fine sessione di Claude Code (dall'hook SessionEnd).
   * Accoda la sessione SOLO se la cartella di lavoro è opt-in (decisione D7).
   * @returns `queued: false` con il motivo se la sessione è stata ignorata
   */
  ingestSession (payload: { sessionId: string, transcriptPath: string, cwd: string }): { queued: boolean, reason?: string, jobId?: number } {
    if (!this.team) return { queued: false, reason: 'nodo non configurato' }
    if (!isInsideWatched(payload.cwd, this.config.watch.sessions)) {
      // Riga di log volutamente presente: senza, una sessione ignorata sparisce senza lasciare traccia.
      this.log(`sessione ${payload.sessionId.slice(0, 8)} ignorata: ${payload.cwd} non è una cartella abilitata`)
      return { queued: false, reason: 'cartella non abilitata (micelio watch add)' }
    }
    const jobId = this.pipeline.enqueueSession(payload)
    this.log(`sessione ${payload.sessionId.slice(0, 8)} accodata per l'ingestione`)
    return { queued: true, jobId }
  }

  /** Cartelle opt-in per la raccolta dalle sessioni. */
  watched (): string[] {
    return this.config.watch.sessions
  }

  /** Abilita la raccolta automatica per una cartella (e sottocartelle). */
  watchAdd (dir: string): string[] {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new UserError(`Cartella inesistente: ${path.resolve(dir)}`)
    // Salviamo la forma canonica (nome lungo, link risolti): è quella che si vede nell'elenco.
    const abs = canonicalPath(dir)
    this.config = updateConfig(this.paths, (c) => {
      if (!isInsideWatched(abs, c.watch.sessions)) c.watch.sessions.push(abs)
    })
    this.changed('settings')
    return this.config.watch.sessions
  }

  /** Disabilita la raccolta automatica per una cartella. */
  watchRemove (dir: string): string[] {
    const abs = canonicalPath(dir)
    this.config = updateConfig(this.paths, (c) => {
      c.watch.sessions = c.watch.sessions.filter((w) => canonicalPath(w) !== abs)
    })
    this.changed('settings')
    return this.config.watch.sessions
  }

  /** Impostazioni locali correnti (per la schermata Impostazioni). */
  settings (): NodeSettings {
    const { adapter, command, classifyModel, distillModel, dailyBudget } = this.config.llm
    return { llm: { adapter, command, classifyModel, distillModel, dailyBudget }, watched: this.config.watch.sessions, port: this.config.port }
  }

  /**
   * Aggiorna modelli e budget LLM. Hanno effetto subito (vengono riletti a ogni chiamata).
   * Cambiare adapter o comando richiede invece un riavvio del daemon: qui non sono modificabili.
   */
  updateLlmSettings (patch: { classifyModel?: string, distillModel?: string, dailyBudget?: number }): NodeSettings {
    if (patch.dailyBudget !== undefined && (!Number.isInteger(patch.dailyBudget) || patch.dailyBudget < 0)) {
      throw new UserError('Il budget giornaliero deve essere un intero maggiore o uguale a 0')
    }
    this.config = updateConfig(this.paths, (c) => {
      if (patch.classifyModel) c.llm.classifyModel = patch.classifyModel
      if (patch.distillModel) c.llm.distillModel = patch.distillModel
      if (patch.dailyBudget !== undefined) c.llm.dailyBudget = patch.dailyBudget
    })
    this.changed('settings')
    return this.settings()
  }

  /** Stato dell'ingestione: LLM, budget, coda, inbox. */
  async ingestStatus (): Promise<IngestStatus> {
    return {
      llm: this.llm ? { adapter: this.llm.adapter.name, available: await this.llm.available(), budget: this.llm.budget } : null,
      jobs: this.privateStore.jobStats(),
      inbox: this.privateStore.listInbox().length,
      watched: this.config.watch.sessions
    }
  }

  /** Elabora subito un lavoro in coda (test e comando `micelio ingest run`). */
  processQueue (): Promise<boolean> {
    return this.pipeline.tick()
  }

  // ═══════════════════════════════ Inbox e privato ═════════════════════════════

  inbox (): InboxItem[] {
    return this.pipeline.listInbox()
  }

  /** Approva un elemento dell'inbox (con eventuali modifiche) e lo pubblica nel team. */
  async approve (id: string, overrides: Partial<Pick<MemoryData, 'title' | 'body' | 'kind' | 'tags'>> = {}): Promise<{ id: string, duplicate: boolean, memory: MemoryData }> {
    this.requireTeam()
    try {
      return await this.pipeline.approve(id, overrides)
    } catch (err) {
      throw err instanceof InboxNotFoundError ? new UserError(err.message) : err
    }
  }

  /** Rifiuta un elemento dell'inbox. */
  reject (id: string): void {
    try {
      this.pipeline.reject(id)
    } catch (err) {
      throw err instanceof InboxNotFoundError ? new UserError(err.message) : err
    }
  }

  /** Registro di ciò che NON è andato al team (bloccato, privato, scartato, rifiutato, scaduto). */
  decisions (limit = 50): Decision[] {
    return this.privateStore.listDecisions(limit)
  }

  // ═══════════════════════════════════ Stato ═══════════════════════════════════

  async status (): Promise<NodeStatus> {
    const team = this.team
    if (!team) {
      return { configured: false, nodeName: this.nodeName, nodeKey: null, team: null, writable: false, indexer: false, role: null, peers: 0, members: 0, memories: 0 }
    }
    const members = (await team.members()).filter((m) => !m.removed)
    const me = members.find((m) => m.key === team.localKey)
    return {
      configured: true,
      nodeName: this.nodeName,
      nodeKey: team.localKey,
      team: await team.team(),
      writable: team.writable,
      indexer: team.isIndexer,
      role: me?.role ?? null,
      peers: team.peers,
      members: members.length,
      memories: this.index.count()
    }
  }

  /** Scarica ciò che è disponibile dai peer e riallinea indice ed export. */
  async sync (): Promise<void> {
    await this.requireTeam().update()
    await this.materialize()
  }

  // ═════════════════════════════════ Interni ═══════════════════════════════════

  private newTeamNode (): TeamNode {
    return new TeamNode({ storeDir: this.paths.store, bootstrap: this.opts.bootstrap, log: this.log })
  }

  /** Collega il TeamNode al nodo: ogni aggiornamento della vista programma una reindicizzazione. */
  private attach (team: TeamNode): void {
    this.team = team
    team.on('update', () => this.scheduleMaterialize())
    team.on('peers', () => this.changed('status'))
  }

  /** Emette un evento `change` per ciascun argomento (vedi ChangeTopic). */
  private changed (...topics: ChangeTopic[]): void {
    for (const t of topics) this.emit('change', t)
  }

  /**
   * Accorpa gli aggiornamenti: durante una sincronizzazione Autobase emette molti 'update' di
   * fila, ma basta reindicizzare una volta alla fine della raffica.
   */
  private scheduleMaterialize (): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.materialize().catch((err) => this.log(`errore di indicizzazione: ${err.message}`))
    }, this.opts.materializeDelayMs ?? 250)
  }

  /**
   * Ricostruisce indice ed export dalla vista. Le chiamate sono serializzate sulla catena
   * `materializing`, così due ricostruzioni non si sovrappongono mai.
   */
  private materialize (): Promise<void> {
    this.materializing = this.materializing.catch(() => {}).then(async () => {
      const team = this.team
      if (!team) return
      const [memories, members] = await Promise.all([team.memories(), team.members()])
      this.index.rebuild(memories, members)
      writeExport(this.paths.export, memories, members)
      this.changed('memories', 'members', 'status')
    })
    return this.materializing
  }

  private requireTeam (): TeamNode {
    if (!this.team) throw new UserError('Nodo non configurato: esegui prima `micelio init` o `micelio join`')
    return this.team
  }

  /**
   * Le azioni da admin vengono rifiutate già qui, oltre che in apply. Motivo: apply valuta i
   * permessi nell'ordine linearizzato, e un'azione emessa da un membro CONCORRENTEMENTE alla sua
   * promozione potrebbe essere ordinata dopo la promozione e quindi accettata (DESIGN §9).
   * Prima di decidere sincronizziamo, per avere il ruolo più aggiornato possibile.
   */
  private async requireAdmin (): Promise<void> {
    await this.sync()
    if ((await this.status()).role !== 'admin') throw new UserError('Operazione riservata agli admin del team')
  }

  private assertNotConfigured (): void {
    if (this.team || loadState(this.paths)) throw new UserError('Questo nodo appartiene già a un team')
  }

  /**
   * Trova un membro attivo per nome esatto o per chiave (anche abbreviata, almeno 6 caratteri).
   * @throws UserError se nessuno o più di uno corrisponde
   */
  private async resolveMember (ref: string): Promise<MemberRecord> {
    const all = (await this.requireTeam().members()).filter((m) => !m.removed)
    const byName = all.filter((m) => m.name === ref)
    const byKey = ref.length >= 6 ? all.filter((m) => m.key.startsWith(ref.toLowerCase())) : []
    const found = byName.length ? byName : byKey
    if (found.length === 0) throw new UserError(`Nessun membro attivo corrisponde a "${ref}"`)
    if (found.length > 1) throw new UserError(`"${ref}" è ambiguo: usa una parte più lunga della chiave`)
    return found[0]
  }
}

/** Crea l'adapter LLM indicato in configurazione; null se "none". */
function createAdapter (config: Config): LlmAdapter | null {
  switch (config.llm.adapter) {
    case 'claude': return new ClaudeCliAdapter(config.llm.command)
    case 'fake': return new FakeAdapter()
    default: return null
  }
}
