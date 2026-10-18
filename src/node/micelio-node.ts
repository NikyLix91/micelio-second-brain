/**
 * @file Nodo Micelio: l'orchestratore di tutto ciò che vive su una macchina.
 *
 * Mette insieme:
 * - `TeamNode`        rete P2P e log del team (src/net);
 * - `MemoryIndex`     ricerca locale, derivata dalla vista (src/store/memory-index);
 * - `PrivateStore`    archivio privato: inbox, decisioni, coda, budget (src/store/private-store);
 * - `IngestPipeline`  filtro + classificazione + distillazione (src/ingest);
 * - `DocumentWatcher` cartelle di documenti sorvegliate (src/ingest/documents, Fase 4);
 * - `FileShare`       download dell'originale di un documento dai colleghi (src/net/file-share);
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
import { MemoryInput, memoryId, type MemoryData, ROOT_CATEGORIES, type RootCategory } from '../core/events'
import type { InviteRecord, MemberRecord, NodeStatus, RecallHit, RootRecord } from '../core/model'
import type { NodePaths } from '../core/paths'
import { writeExport } from '../export/markdown'
import { buildGraph, type Graph, type GraphLink } from '../graph/constellation'
import { type Embedder, HashEmbedder, LocalEmbedder } from '../embed/embedder'
import { activation } from '../rank/activation'
import { hybridRank, nearest } from '../rank/hybrid'
import { currentEpoch, Dreamer, type DreamReport, dreamOrder } from '../dream/dreamer'
import type { MemoryRecord } from '../core/model'
import os from 'node:os'
import { type ExplicitOutcome, IngestPipeline, InboxNotFoundError } from '../ingest/pipeline'
import { ClaudeCliAdapter } from '../llm/claude-cli'
import { FakeAdapter } from '../llm/fake'
import { LlmRunner } from '../llm/runner'
import type { LlmAdapter } from '../llm/types'
import { TeamNode } from '../net/team-node'
import { mergeRules } from '../privacy/filter'
import { mergeBlockedPaths } from '../privacy/paths'
import { DocumentWatcher, hashFile } from '../ingest/documents'
import { extractText } from '../ingest/extract'
import { claudeProjectsDir, SessionScanner } from '../ingest/session-scanner'
import { FileShare } from '../net/file-share'
import { MemoryIndex } from '../store/memory-index'
import { type Decision, type DocumentRecord, type InboxItem, PrivateStore } from '../store/private-store'
import { BOOTSTRAP_RE, canonicalPath, type Config, dhtBootstrap, isInsideWatched, loadConfig, loadState, networkMode, parseBootstrap, saveState, updateConfig } from './config'
import { checkNetwork, type NetworkCheck } from '../net/diagnose'
import { reviewRoots } from '../roots/review'

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
  /** Embedder da usare al posto di quello configurato (test). `null` = nessuna ricerca semantica. */
  embedder?: Embedder | null
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
export type ChangeTopic = 'status' | 'memories' | 'members' | 'inbox' | 'jobs' | 'decisions' | 'settings' | 'roots'

/** Impostazioni LOCALI modificabili dalla UI (config.json). */
export interface NodeSettings {
  llm: { adapter: string, command: string, classifyModel: string, distillModel: string, dailyBudget: number }
  watched: string[]
  /** Cartelle di documenti sorvegliate: originali scaricabili dai colleghi? cartella "di Radici"? */
  documents: { path: string, shareable: boolean, roots: boolean }[]
  port: number
  /** Rete P2P: DHT pubblica o privata del team (vedi server/README.md). */
  network: NetworkSettings
}

/** Impostazioni di rete come le mostra la UI. */
export interface NetworkSettings {
  /** DHT scelta in config.json. */
  mode: 'public' | 'private'
  /** Nodi di avvio della DHT privata salvati ("host:porta"), anche se ora si usa la pubblica. */
  bootstrap: string[]
  /** Nodi di avvio IN USO adesso ([] = DHT pubblica). */
  active: string[]
  /**
   * Se valorizzato, la rete è fissata dalla variabile d'ambiente MICELIO_DHT_BOOTSTRAP (demo,
   * container, test) e non si può cambiare dalla UI: contiene il suo valore.
   */
  fixedByEnv: string | null
}

/**
 * Spazio occupato dal sapere (schermata "Stato del nodo").
 * - `disk`: byte su QUESTO disco, per componente;
 * - `members`: quanto del log del team viene da ciascun membro. Ogni nodo replica tutto, quindi
 *   la ripartizione è la stessa su ogni PC del team.
 */
export interface StorageReport {
  disk: {
    /** Log replicato del team (corestore): feed di tutti i membri, cifrati. */
    log: number
    /** Indice di ricerca e vettori (view.db): derivato, ricostruibile. */
    index: number
    /** Archivio privato (private.db): inbox, registro, coda. Mai replicato. */
    private: number
    /** Documenti originali scaricati dai colleghi (cache, svuotata dopo 30 giorni). */
    cache: number
    /** Copia Markdown in sola lettura. */
    export: number
    total: number
  }
  /** Somma dei feed dei membri (byte del log del team). */
  teamLogBytes: number
  members: {
    key: string
    name: string
    removed: boolean
    /** Byte del feed del membro: tutti i suoi eventi (ricordi, voti, uso, sogni…). */
    bytes: number
    /** Quota del log del team (0..1). */
    share: number
    /** Ricordi attivi di cui è autore e loro dimensione in testo (titolo + corpo + tag). */
    memories: number
    memoryBytes: number
  }[]
}

/** Una Radice con il suo ricordo, come la mostrano UI, CLI e MCP. */
export interface RootView extends RootRecord {
  memory: RecallHit
  /** Nome di chi l'ha promossa / confermata per ultimo (null se non più membro). */
  byName: string | null
  reviewedByName: string | null
}

/** Resoconto di una revisione delle Radici, come lo mostrano UI e CLI. */
export interface RootReviewResult {
  /** Radici esaminate. */
  checked: number
  /** Radici segnalate "da rivedere" in questa revisione, con i motivi. */
  flagged: { id: string, title: string, reasons: string[] }[]
  /** Cosa non è stato possibile verificare da questo PC, e perché. */
  notes: string[]
}

/** Filtri per l'elenco delle Radici (tool MCP `architecture`, API, CLI). */
export interface RootFilter {
  /** Progetto: confrontato con `source.code.project` e con i tag (maiuscole indifferenti). */
  project?: string
  category?: RootCategory
  /**
   * File su cui si sta lavorando: restituisce le Radici che citano quei file o le loro cartelle
   * (una Radice su "src/orders/" vale per "src/orders/order.service.ts").
   */
  files?: string[]
  /** Testo: ordina le Radici per pertinenza (stessa ricerca ibrida di recall). */
  query?: string
}

/** Esito del download di un documento originale. */
export interface SourceFile {
  /** Percorso locale del file (copia in cache, o l'originale se il documento è di questo nodo). */
  path: string
  name: string
  size: number
  /** true se il file era già in cache o è locale (nessun download). */
  local: boolean
}

/** Ogni quanto si pubblica al team l'uso locale dei ricordi (usage.report, DESIGN §8.3). */
const USAGE_FLUSH_MS = 30 * 60 * 1000

/**
 * Soglia di similarità sotto la quale un risultato semantico non è considerato pertinente.
 * Dipende dal modello: i punteggi di e5 sono "compressi" fra 0,8 e 0,9 (spike C), quelli
 * dell'embedder finto sono più bassi e sparsi.
 */
function semanticThreshold (model: string): number {
  return model.includes('e5') ? 0.83 : 0.3
}

/** Soglia "quasi duplicato" per il dreaming: più alta di quella di pertinenza. */
function duplicateThreshold (model: string): number {
  return model.includes('e5') ? 0.92 : 0.7
}

/** Ogni quanto il nodo controlla se è il suo turno di sognare. */
const DREAM_CHECK_MS = 10 * 60 * 1000

/** Dopo quanti giorni le copie scaricate escono dalla cache (decisione D11). */
const SOURCE_CACHE_DAYS = 30

/** Stato dell'ingestione, per `micelio ingest status` e la futura Dashboard. */
export interface IngestStatus {
  llm: { adapter: string, available: boolean, budget: { used: number, limit: number } } | null
  jobs: Record<string, number>
  inbox: number
  watched: string[]
}

export class MicelioNode extends EventEmitter {
  private team: TeamNode | null = null
  /** Radici del team (Fase 8), dalla vista: id del ricordo → record. */
  private rootsById = new Map<string, RootRecord>()
  private nodeName: string | null = null
  private readonly index: MemoryIndex
  private readonly privateStore: PrivateStore
  private readonly pipeline: IngestPipeline
  private readonly documents: DocumentWatcher
  private readonly files: FileShare
  private readonly llm: LlmRunner | null
  /** Calcolo degli embedding (null = solo ricerca per parole chiave). */
  private readonly embedder: Embedder | null
  /** Collegamenti per ricordo nell'ultima costellazione calcolata (per l'attivazione). */
  private degrees = new Map<string, number>()
  /** Catena dei calcoli di embedding: mai due in parallelo. */
  private embedding: Promise<void> = Promise.resolve()
  private usageTimer: NodeJS.Timeout | null = null
  private dreamTimer: NodeJS.Timeout | null = null
  private scanTimer: NodeJS.Timeout | null = null
  private readonly scanner: SessionScanner
  private readonly dreamer: Dreamer
  /** Ricordi non attivi (archiviati o sostituiti), per la schermata Archivio. */
  private inactive: MemoryRecord[] = []
  /** Collegamenti espliciti creati dal dreaming (per la costellazione). */
  private dreamLinks: { from: string, to: string, rel: string }[] = []
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
      blockedPaths: async () => mergeBlockedPaths(await this.team?.config('filter.blockedPaths')),
      language: async () => (await this.team?.config<string>('memory.language')) ?? 'it',
      gitChanges: () => this.config.watch.gitChanges,
      log: this.log,
      notify: (topic) => this.changed(topic),
      // Radici (Fase 8): suggerimenti del distillatore e cartelle di documenti "di Radici"
      suggestRoot: (id, category, title) => {
        if (this.rootsById.has(id)) return
        this.privateStore.addRootSuggestion(id, category, title)
        this.changed('roots')
      },
      promoteRoot: async (id, category) => { await this.team?.append({ type: 'root.set', id, category }) },
      rootFolder: (folder) => this.config.watch.documents.some((d) => d.roots && canonicalPath(d.path) === canonicalPath(folder))
    })
    this.documents = new DocumentWatcher(this.pipeline, this.privateStore, this.log)
    this.embedder = opts.embedder !== undefined ? opts.embedder : createEmbedder(this.config)
    this.scanner = new SessionScanner(this.privateStore)
    this.dreamer = new Dreamer({
      me: () => this.team?.localKey ?? '',
      llm: this.llm,
      model: () => this.config.llm.distillModel,
      memories: () => this.enrich(this.index.all()),
      vectors: () => ({ map: this.embedder ? this.index.vectors(this.embedder.model) : new Map(), duplicate: duplicateThreshold(this.embedder?.model ?? '') }),
      append: (p) => this.requireTeam().append(p),
      sync: () => this.sync(),
      claimOf: async (epoch) => (await this.team?.dreamClaim(epoch)) ?? null,
      log: this.log
    })
    this.files = new FileShare({
      isMember: async (key, signer) => {
        const active = !!(await this.team?.members())?.some((m) => m.key === key && !m.removed)
        return active && (await this.team?.signerOf(key)) === signer
      },
      resolve: (hash) => this.resolveSharedFile(hash),
      localWriter: () => this.team?.localKeyPair ?? null,
      log: this.log
    })
  }

  // ═══════════════════════════════ Ciclo di vita ═══════════════════════════════

  /** Avvia il nodo: se il team è già configurato si ricollega alla rete. Avvia il worker di ingestione. */
  async start (): Promise<void> {
    this.pipeline.start()
    this.sweepSourceCache()
    // Pubblicazione periodica dell'uso locale dei ricordi (Fase 5).
    this.usageTimer = setInterval(() => { this.flushUsage().catch(() => {}) }, USAGE_FLUSH_MS)
    this.usageTimer.unref()
    // Raccolta delle sessioni in corso e recupero di quelle finite mentre il daemon era spento.
    const scanEvery = this.config.watch.sessionScan.intervalMinutes * 60_000
    this.scanTimer = setInterval(() => { this.scanSessions() }, scanEvery)
    this.scanTimer.unref()
    // Controllo periodico del turno di sogno (Fase 6).
    this.dreamTimer = setInterval(() => { this.checkDreamTurn().catch((e) => this.log(`dreaming: ${e.message}`)) }, DREAM_CHECK_MS)
    this.dreamTimer.unref()
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
    await this.documents.start(this.config.watch.documents)
    // Recupero: sessioni lavorate mentre il daemon era spento (o parti nuove di sessioni lunghe).
    this.scanSessions()
  }

  /** Ferma tutto in ordine: worker, indicizzazione in corso, rete, database. */
  async stop (): Promise<void> {
    if (this.usageTimer) clearInterval(this.usageTimer)
    if (this.dreamTimer) clearInterval(this.dreamTimer)
    if (this.scanTimer) clearInterval(this.scanTimer)
    while (this.dreamer.busy) await new Promise((r) => setTimeout(r, 200))
    await this.flushUsage().catch(() => {})
    await this.embedding.catch(() => {})
    await this.embedder?.close()
    await this.documents.stop()
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
    await this.documents.start(this.config.watch.documents)
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
    await this.documents.start(this.config.watch.documents)
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

  /** Costellazione del sapere: ricordi come nodi, correlazioni come collegamenti (src/graph). */
  graph (): Graph {
    const g = buildGraph(this.index.all(), [...this.semanticLinks(), ...this.explicitLinks()])
    const signals = this.index.signals()
    return {
      ...g,
      nodes: g.nodes.map((n) => {
        const r = this.rootsById.get(n.id)
        return { ...n, activation: this.activationOf(n.id, signals), ...(r ? { root: { category: r.category, status: r.status } } : {}) }
      })
    }
  }

  /** Un ricordo completo con i segnali di priorità (attivazione, voti, usi, pin). */
  detail (id: string): RecallHit | null {
    const rec = this.index.get(id)
    return rec ? this.enrich([rec])[0] : null
  }

  // ═══════════════════════════ Priorità (Fase 5) ═══════════════════════════

  /**
   * Ricerca IBRIDA (DESIGN §8.1): parole chiave + significato + attivazione. È quella usata da
   * API, MCP e UI. Conta anche l'uso dei ricordi restituiti (segnale per l'attivazione).
   * @param track false per non contare l'uso (es. ricerche interne)
   */
  async recallHybrid (query: string, limit = 5, track = true): Promise<RecallHit[]> {
    const keyword = this.index.keywordIds(query, 50)
    let semantic: string[] = []
    if (this.embedder && query.trim().length >= 2) {
      try {
        const [q] = await this.embedder.embed([query], 'query')
        semantic = nearest(q, this.index.vectors(this.embedder.model), 50, semanticThreshold(this.embedder.model)).map((r) => r.id)
      } catch (err) {
        // Modello non disponibile (es. primo download fallito): si ripiega sulle parole chiave.
        this.log(`ricerca semantica non disponibile: ${(err as Error).message}`)
      }
    }
    const signals = this.index.signals()
    const act = (id: string) => this.activationOf(id, signals)
    const ranked = hybridRank(keyword, semantic, act).slice(0, limit)
    const hits = this.enrich(this.index.getMany(ranked.map((r) => r.id)), signals)
    ranked.forEach((r, i) => { if (hits[i]) hits[i].score = r.score })
    if (track && hits.length) this.privateStore.countUsage(hits.map((h) => h.id))
    return hits
  }

  // ═══════════════════════════ Dreaming (Fase 6) ═══════════════════════════

  /**
   * Controlla se oggi tocca a questo nodo sognare (DESIGN §10.1): turnazione deterministica fra
   * i membri attivi; il primo può iniziare dall'ora configurata, ogni turno successivo dopo
   * `slotMinutes` se nessuno ha ancora rivendicato l'epoca.
   */
  private async checkDreamTurn (now = Date.now()): Promise<void> {
    const team = this.team
    if (!team?.writable || !this.llm || !this.config.dream.enabled || this.dreamer.busy) return
    const epoch = currentEpoch(now)
    if (await team.dreamClaim(epoch)) return
    const members = (await team.members()).filter((m) => !m.removed).map((m) => m.key)
    const position = dreamOrder(epoch, members).indexOf(team.localKey!)
    if (position < 0) return
    const start = new Date(now)
    start.setHours(this.config.dream.hour, 0, 0, 0)
    if (now < start.getTime() + position * this.config.dream.slotMinutes * 60_000) return
    await this.runDream(epoch)
  }

  /** Sogno manuale (`micelio dream now`, pulsante nell'app): epoca dedicata, nessuna attesa. */
  async dreamNow (): Promise<DreamReport> {
    if (this.dreamer.busy) throw new UserError('Un sogno è già in corso')
    if (!this.llm) throw new UserError('Serve un LLM per sognare (llm.adapter in config.json)')
    const r = await this.runDream(`manuale-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`)
    if (!r) throw new UserError('Un altro nodo sta già sognando questa epoca')
    return r
  }

  private async runDream (epoch: string): Promise<DreamReport | null> {
    const r = await this.dreamer.dream(epoch)
    if (r) this.changed('memories', 'status')
    return r
  }

  /** Diario dei sogni del team, dal più recente. */
  async dreams (): Promise<{ epoch: string, by: string, ts: number, summary: string, stats: Record<string, number> }[]> {
    return this.requireTeam().dreamLogs()
  }

  /** Ricordi archiviati o sostituiti (storico), dal più recente. */
  archived (): MemoryRecord[] {
    return [...this.inactive].sort((a, b) => b.ts - a.ts)
  }

  /**
   * Redazione (solo admin): toglie dalla vista di tutti il contenuto di un ricordo pubblicato per
   * errore (es. un dato sensibile sfuggito al filtro). Limite intrinseco: chi l'aveva già letto
   * o esportato ne conserva una copia, e i blocchi cifrati restano nei log replicati.
   */
  async redact (id: string, reason: string): Promise<void> {
    await this.requireAdmin()
    const rec = this.requireMemory(id)
    await this.requireTeam().append({ type: 'memory.redact', id: rec.id, reason: reason || 'rimosso da un admin' })
    await this.sync()
  }

  /** Metriche sintetiche del nodo (per monitoraggio esterno o diagnostica). */
  async metrics (): Promise<Record<string, unknown>> {
    const s = await this.status()
    const ingest = await this.ingestStatus()
    return {
      uptimeSeconds: Math.round(process.uptime()),
      memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      peers: s.peers,
      members: s.members,
      memories: s.memories,
      archived: this.inactive.length,
      inbox: ingest.inbox,
      jobs: ingest.jobs,
      documents: this.documentStats(),
      llmCallsToday: ingest.llm?.budget.used ?? 0,
      llmBudget: ingest.llm?.budget.limit ?? 0,
      dreams: this.team ? (await this.team.dreamLogs()).length : 0
    }
  }

  /** Ripristina un ricordo archiviato o sostituito. */
  async restore (id: string): Promise<void> {
    const m = this.inactive.find((x) => (x.id === id || x.id.startsWith(id.toLowerCase())) && x.status !== 'redacted')
    if (!m) throw new UserError(`Nessun ricordo archiviato con id ${id}`)
    await this.requireTeam().append({ type: 'memory.restore', id: m.id })
    await this.sync()
  }

  /** Voto di utilità su un ricordo: +1, -1, 0 per ritirarlo. Un voto per nodo. */
  async vote (id: string, delta: -1 | 0 | 1): Promise<void> {
    const rec = this.requireMemory(id)
    await this.requireTeam().append({ type: 'memory.vote', id: rec.id, delta })
    await this.sync()
  }

  /** Fissa (o sblocca) un ricordo importante: non decade e il dreaming non lo archivia. */
  async pin (id: string, pinned: boolean): Promise<void> {
    const rec = this.requireMemory(id)
    await this.requireTeam().append({ type: pinned ? 'memory.pin' : 'memory.unpin', id: rec.id })
    await this.sync()
  }

  // ═══════════════════════════ Radici (Fase 8) ═══════════════════════════

  /**
   * Promuove un ricordo a Radice (o ne cambia la categoria). Qualunque membro può farlo.
   * @param category vedi ROOT_CATEGORIES in events.ts
   */
  async rootSet (id: string, category: RootCategory): Promise<RootView> {
    if (!ROOT_CATEGORIES.includes(category)) throw new UserError(`Categoria sconosciuta: ${category} (${ROOT_CATEGORIES.join(', ')})`)
    const rec = this.requireMemory(id)
    await this.requireTeam().append({ type: 'root.set', id: rec.id, category })
    this.privateStore.removeRootSuggestion(rec.id)
    this.changed('roots')
    await this.sync()
    return this.requireRoot(rec.id)
  }

  /**
   * Radici suggerite dal distillatore su QUESTO nodo (archivio privato), ancora da decidere.
   * Si escludono i ricordi spariti (archiviati, sostituiti) o già diventati Radici.
   */
  rootSuggestions (): { id: string, category: RootCategory, title: string, created: number }[] {
    return this.privateStore.rootSuggestions()
      .filter((s) => this.index.get(s.id) && !this.rootsById.has(s.id))
      .map((s) => ({ ...s, category: s.category as RootCategory }))
  }

  /** Ignora un suggerimento di Radice (resta un ricordo normale). */
  dismissRootSuggestion (id: string): void {
    this.privateStore.removeRootSuggestion(id)
    this.changed('roots')
  }

  /** Il ricordo smette di essere una Radice. */
  async rootUnset (id: string): Promise<void> {
    const r = this.requireRoot(id)
    await this.requireTeam().append({ type: 'root.unset', id: r.id })
    await this.sync()
  }

  /** Radice rivista e confermata: si azzerano le segnalazioni, la data di revisione riparte. */
  async rootConfirm (id: string): Promise<RootView> {
    const r = this.requireRoot(id)
    await this.requireTeam().append({ type: 'root.confirm', id: r.id })
    await this.sync()
    return this.requireRoot(r.id)
  }

  /**
   * Elenco delle Radici, filtrato e ordinato (vedi RootFilter). Senza `query`: per categoria,
   * poi quelle da rivedere prima, poi per titolo.
   */
  async roots (filter: RootFilter = {}): Promise<RootView[]> {
    const members = new Map((this.team ? await this.team.members() : []).map((m) => [m.key, m.name]))
    let list = [...this.rootsById.values()]
      .map((r) => {
        const hit = this.index.get(r.id)
        return hit ? { ...r, memory: this.enrich([hit])[0], byName: members.get(r.by) ?? null, reviewedByName: members.get(r.reviewedBy) ?? null } : null
      })
      .filter((r): r is RootView => r !== null)

    if (filter.category) list = list.filter((r) => r.category === filter.category)
    if (filter.project) {
      const p = filter.project.toLowerCase()
      list = list.filter((r) => r.memory.source?.code?.project?.toLowerCase() === p || r.memory.tags.some((t) => t === p))
    }
    if (filter.files?.length) {
      const wanted = filter.files.map(normFile)
      list = list.filter((r) => (r.memory.source?.code?.files ?? []).map(normFile).some((f) => wanted.some((w) => w === f || w.startsWith(f.endsWith('/') ? f : f + '/'))))
    }
    if (filter.query?.trim()) {
      const order = await this.rankRoots(filter.query, list.map((r) => r.id))
      const pos = new Map(order.map((id, i) => [id, i]))
      return list.filter((r) => pos.has(r.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!)
    }
    const cat = (c: string) => ROOT_CATEGORIES.indexOf(c as RootCategory)
    return list.sort((a, b) => cat(a.category) - cat(b.category) || (a.status === b.status ? 0 : a.status === 'review' ? -1 : 1) || a.memory.title.localeCompare(b.memory.title))
  }

  /**
   * Radici pertinenti a una ricerca, ESCLUSE quelle già fra i risultati: è la sezione "Radici
   * pertinenti" in coda a ogni recall. Così il sapere fondante arriva all'agente anche quando la
   * ricerca non lo mette fra i primi risultati.
   * @param exclude id già mostrati
   * @param n quante al massimo
   */
  async relatedRoots (query: string, exclude: string[] = [], n = 3): Promise<RecallHit[]> {
    const skip = new Set(exclude)
    const candidates = [...this.rootsById.keys()].filter((id) => !skip.has(id))
    if (!candidates.length || query.trim().length < 2) return []
    const ids = (await this.rankRoots(query, candidates, true)).slice(0, n)
    return this.enrich(this.index.getMany(ids))
  }

  /**
   * Ordina un insieme di Radici per pertinenza a una query: parole chiave + significato, con
   * una soglia semantica più bassa del normale (le Radici sono testi lunghi e generali).
   * @param strict true = solo quelle con un minimo di pertinenza (per "Radici pertinenti")
   */
  private async rankRoots (query: string, ids: string[], strict = false): Promise<string[]> {
    const allowed = new Set(ids)
    const keyword = this.index.keywordIds(query, 200).filter((id) => allowed.has(id))
    let semantic: string[] = []
    if (this.embedder) {
      try {
        const [q] = await this.embedder.embed([query], 'query')
        const vectors = new Map([...this.index.vectors(this.embedder.model)].filter(([id]) => allowed.has(id)))
        semantic = nearest(q, vectors, ids.length, semanticThreshold(this.embedder.model) * ROOT_SEMANTIC_FACTOR).map((r) => r.id)
      } catch { /* modello non disponibile: solo parole chiave */ }
    }
    const ranked = hybridRank(keyword, semantic, () => 0).map((r) => r.id)
    if (strict) return ranked
    // Elenco completo: prima le pertinenti, poi le altre nell'ordine dato
    return [...ranked, ...ids.filter((id) => !ranked.includes(id))]
  }

  /**
   * Revisione delle Radici, lanciata A MANO (vedi src/roots/review.ts): cerca codice o documenti
   * d'origine cambiati e ricordi più recenti che le contraddicono, e pubblica le segnalazioni
   * (`root.flag`). Le Radici segnalate diventano "da rivedere"; nessuna viene cambiata da sola.
   * @param ids Radici da rivedere (default: tutte)
   */
  async rootReview (ids?: string[]): Promise<RootReviewResult> {
    const team = this.requireTeam()
    const wanted = ids?.length ? new Set(ids.map((i) => this.requireRoot(i).id)) : null
    const roots = [...this.rootsById.values()].filter((r) => !wanted || wanted.has(r.id))
    const model = this.embedder?.model
    const report = await reviewRoots({
      roots,
      memories: this.enrich(this.index.all()),
      localKey: team.localKey,
      // I repository dei progetti si cercano nelle cartelle che l'utente ha abilitato su questo PC
      folders: [...this.config.watch.sessions, ...this.config.watch.documents.map((d) => d.path)],
      documents: () => this.privateStore.allDocuments(),
      links: this.dreamLinks,
      vectors: model ? this.index.vectors(model) : null,
      threshold: model ? semanticThreshold(model) : 1,
      llm: this.llm,
      model: this.config.llm.distillModel,
      language: (await team.config<string>('memory.language')) ?? 'it',
      log: this.log
    })
    for (const f of report.findings) await team.append({ type: 'root.flag', id: f.id, reason: f.reason, refs: f.refs })
    if (report.findings.length) await this.sync()
    // Raggruppa le segnalazioni per Radice, con il titolo
    const flagged = new Map<string, { id: string, title: string, reasons: string[] }>()
    for (const f of report.findings) {
      const e = flagged.get(f.id) ?? { id: f.id, title: this.index.get(f.id)?.title ?? f.id, reasons: [] }
      e.reasons.push(f.reason)
      flagged.set(f.id, e)
    }
    this.log(`revisione Radici: ${report.checked} esaminate, ${flagged.size} da rivedere`)
    return { checked: report.checked, flagged: [...flagged.values()], notes: report.notes }
  }

  private requireRoot (id: string): RootView {
    const rec = this.index.get(id)
    const r = rec ? this.rootsById.get(rec.id) : undefined
    if (!rec || !r) throw new UserError(`Il ricordo ${id} non è una Radice`)
    return { ...r, memory: this.enrich([rec])[0], byName: rec.authorName, reviewedByName: null }
  }

  /** Pubblica al team i contatori d'uso locali non ancora inviati (usage.report). */
  async flushUsage (): Promise<void> {
    if (!this.team?.writable) return
    const counts = this.privateStore.unreportedUsage()
    if (Object.keys(counts).length === 0) return
    await this.team.append({ type: 'usage.report', counts })
    this.privateStore.markUsageReported(counts)
  }

  /** Attivazione 0..1 di un ricordo (vedi src/rank/activation.ts). */
  private activationOf (id: string, signals = this.index.signals()): number {
    const s = signals.get(id)
    const rec = this.index.get(id)
    if (!rec) return 0
    return activation({ kind: rec.kind, createdAt: rec.ts, lastUsed: s?.lastUsed ?? undefined, uses: s?.uses ?? 0, votes: s?.votes ?? 0, degree: this.degrees.get(id) ?? 0, pinned: !!s?.pinned, root: this.rootsById.has(id) })
  }

  /** Aggiunge ai risultati attivazione, voti, usi e pin. */
  private enrich (hits: RecallHit[], signals = this.index.signals()): RecallHit[] {
    return hits.map((h) => {
      const s = signals.get(h.id)
      const r = this.rootsById.get(h.id)
      return { ...h, activation: this.activationOf(h.id, signals), votes: s?.votes ?? 0, uses: s?.uses ?? 0, pinned: !!s?.pinned, ...(r ? { root: { category: r.category, status: r.status } } : {}) }
    })
  }

  private requireMemory (id: string): RecallHit {
    const rec = this.index.get(id)
    if (!rec) throw new UserError(`Nessun ricordo con id ${id}`)
    return rec
  }

  /**
   * Calcola in background i vettori dei ricordi che non ce l'hanno (nuovi, o di un altro
   * modello), a blocchi di 32. Alla fine notifica "memories": la costellazione si aggiorna con
   * i collegamenti semantici.
   */
  private scheduleEmbedding (): void {
    const embedder = this.embedder
    if (!embedder) return
    this.embedding = this.embedding.catch(() => {}).then(async () => {
      let done = 0
      for (;;) {
        const batch = this.index.missingVectors(embedder.model, 32)
        if (batch.length === 0) break
        const vecs = await embedder.embed(batch.map((b) => b.text), 'passage')
        this.index.setVectors(embedder.model, batch.map((b, i) => ({ id: b.id, vec: vecs[i] })))
        done += batch.length
      }
      if (done > 0) {
        this.log(`embedding calcolati per ${done} ricordi`)
        this.changed('memories')
      }
    }).catch((err) => this.log(`embedding non calcolati: ${err.message}`))
  }

  /**
   * Collegamenti per affinità di significato, per la costellazione: per ogni ricordo i 2 più
   * simili sopra la soglia del modello. Peso: quanto la similarità supera la soglia.
   */
  private semanticLinks (): GraphLink[] {
    if (!this.embedder) return []
    const vectors = this.index.vectors(this.embedder.model)
    const min = semanticThreshold(this.embedder.model)
    const links: GraphLink[] = []
    for (const [id, v] of vectors) {
      for (const n of nearest(v, vectors, 3, min)) {
        if (n.id === id || id > n.id) continue // una sola volta per coppia
        links.push({ source: id, target: n.id, weight: Math.min(1, (n.score - min) / (1 - min) * 2), kind: 'semantic' })
      }
    }
    return links
  }

  /** Collegamenti creati dal dreaming, fra ricordi ancora attivi (peso fisso: sono "decisi"). */
  private explicitLinks (): GraphLink[] {
    return this.dreamLinks.map((l) => ({ source: l.from, target: l.to, weight: 0.8, kind: 'dream' as const }))
  }

  /** Ultimi ricordi arrivati nel team, dal più recente. */
  recent (limit = 20): RecallHit[] {
    return this.index.recent(limit)
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

  /**
   * Controlla le trascrizioni di Claude Code e accoda la parte nuova delle sessioni (in corso o
   * concluse) delle cartelle abilitate. Chiamato all'avvio, periodicamente e da `micelio ingest scan`.
   * @returns quante sessioni sono state accodate
   */
  scanSessions (): number {
    const s = this.config.watch.sessionScan
    if (!this.team || !s.enabled) return 0
    try {
      const found = this.scanner.scan({ projectsDir: claudeProjectsDir(), watched: this.config.watch.sessions, ...s })
      for (const c of found) this.pipeline.enqueueSession(c)
      if (found.length) this.log(`raccolta periodica: ${found.length} sessioni con parti nuove accodate`)
      return found.length
    } catch (err) {
      this.log(`raccolta periodica non riuscita: ${(err as Error).message}`)
      return 0
    }
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
    return { llm: { adapter, command, classifyModel, distillModel, dailyBudget }, watched: this.config.watch.sessions, documents: this.config.watch.documents, port: this.config.port, network: this.networkSettings() }
  }

  // ═══════════════════════════════ Rete ═══════════════════════════════

  /** Impostazioni di rete correnti (vedi NetworkSettings). */
  networkSettings (): NetworkSettings {
    return {
      mode: networkMode(this.config.network),
      bootstrap: this.config.network.bootstrap,
      active: (this.opts.bootstrap ?? []).map((b) => `${b.host}:${b.port}`),
      fixedByEnv: process.env.MICELIO_DHT_BOOTSTRAP || null
    }
  }

  /**
   * Sceglie la DHT (pubblica o privata) e la applica SUBITO: salva config.json e, se il nodo è
   * in un team, chiude e riapre la rete con i nuovi nodi di avvio (i dati locali restano; dopo
   * pochi secondi il nodo ritrova i colleghi che usano la stessa DHT).
   * ATTENZIONE: tutti i membri devono usare la stessa DHT, altrimenti non si trovano.
   * @param bootstrap nodi "host:porta" della DHT privata; con "public" si possono omettere
   *                  (restano quelli salvati, per poter tornare alla privata)
   */
  async setNetwork (mode: 'public' | 'private', bootstrap?: string[]): Promise<NetworkSettings> {
    if (process.env.MICELIO_DHT_BOOTSTRAP) throw new UserError('La rete è fissata dalla variabile MICELIO_DHT_BOOTSTRAP: toglila per sceglierla da qui')
    if (mode !== 'public' && mode !== 'private') throw new UserError('Rete: "public" oppure "private"')
    const list = bootstrap?.map((b) => b.trim()).filter(Boolean)
    if (list?.some((b) => !BOOTSTRAP_RE.test(b))) throw new UserError('Formato dei nodi di avvio: host:porta (es. 203.0.113.10:49737)')
    if (mode === 'private' && !(list ?? this.config.network.bootstrap).length) throw new UserError('Per la DHT privata serve almeno un nodo di avvio (il server del team)')
    this.config = updateConfig(this.paths, (c) => {
      c.network.mode = mode
      if (list) c.network.bootstrap = list
    })
    this.opts.bootstrap = dhtBootstrap(this.config)
    await this.reconnect()
    this.changed('settings', 'status')
    return this.networkSettings()
  }

  /**
   * Diagnosi di una DHT PRIMA di sceglierla (pulsante "Verifica" della UI): non cambia nulla.
   * Senza argomenti verifica la DHT in uso.
   */
  async checkNetwork (mode?: 'public' | 'private', bootstrap?: string[]): Promise<NetworkCheck> {
    if (mode === undefined) return checkNetwork(this.opts.bootstrap)
    if (mode === 'public') return checkNetwork(undefined)
    const list = (bootstrap ?? this.config.network.bootstrap).map((b) => b.trim()).filter(Boolean)
    if (!list.length || list.some((b) => !BOOTSTRAP_RE.test(b))) throw new UserError('Indica almeno un nodo di avvio nel formato host:porta')
    return checkNetwork(parseBootstrap(list))
  }

  /**
   * Chiude e riapre la connessione al team con i nodi di avvio attuali (dopo un cambio di DHT).
   * Il log locale non si tocca: la riapertura riparte dai dati su disco.
   */
  private async reconnect (): Promise<void> {
    const state = loadState(this.paths)
    if (!state || !this.team) return
    const where = this.opts.bootstrap ? 'DHT privata ' + this.opts.bootstrap.map((b) => `${b.host}:${b.port}`).join(', ') : 'DHT pubblica'
    this.log(`rete: riconnessione (${where})`)
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    await this.materializing.catch(() => {})
    const old = this.team
    this.team = null
    await old.close()
    const team = this.newTeamNode()
    await team.open(state)
    this.attach(team)
    await this.materialize()
  }

  // ═══════════════════════════ Spazio occupato ═══════════════════════════

  /** Spazio occupato dal sapere, su disco e per membro (vedi StorageReport). */
  async storage (): Promise<StorageReport> {
    // I database SQLite in modalità WAL hanno due file accessori (-wal, -shm)
    const db = (base: string) => [base, base + '-wal', base + '-shm'].reduce((n, f) => n + fileSize(f), 0)
    const disk = {
      log: dirSize(this.paths.store),
      index: db(this.paths.index),
      private: db(this.paths.private),
      cache: dirSize(path.join(this.paths.home, 'sources')),
      export: dirSize(this.paths.export),
      total: 0
    }
    disk.total = disk.log + disk.index + disk.private + disk.cache + disk.export

    const members = this.team ? await this.members() : []
    const feeds = this.team ? await this.team.feedSizes(members.map((m) => m.key)) : {}
    // Ricordi attivi per autore, con la loro dimensione in testo
    const byAuthor = new Map<string, { n: number, bytes: number }>()
    for (const m of this.index.all()) {
      const a = byAuthor.get(m.author) ?? { n: 0, bytes: 0 }
      a.n++
      a.bytes += Buffer.byteLength(m.title + m.body + m.tags.join(' '))
      byAuthor.set(m.author, a)
    }
    const teamLogBytes = members.reduce((n, m) => n + (feeds[m.key]?.bytes ?? 0), 0)
    return {
      disk,
      teamLogBytes,
      members: members.map((m) => ({
        key: m.key,
        name: m.name,
        removed: m.removed,
        bytes: feeds[m.key]?.bytes ?? 0,
        share: teamLogBytes ? (feeds[m.key]?.bytes ?? 0) / teamLogBytes : 0,
        memories: byAuthor.get(m.key)?.n ?? 0,
        memoryBytes: byAuthor.get(m.key)?.bytes ?? 0
      })).sort((a, b) => b.bytes - a.bytes)
    }
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

  // ═══════════════════════════ Documenti (Fase 4) ═══════════════════════════

  /**
   * Aggiunge una cartella di documenti sorvegliata.
   * @param shareable se true, i colleghi possono scaricare gli originali su richiesta (D10)
   * @param roots se true, i ricordi distillati dai documenti della cartella diventano Radici (Fase 8)
   */
  async documentsAdd (dir: string, shareable: boolean, roots = false): Promise<NodeSettings['documents']> {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new UserError(`Cartella inesistente: ${path.resolve(dir)}`)
    const abs = canonicalPath(dir)
    this.config = updateConfig(this.paths, (c) => {
      c.watch.documents = [...c.watch.documents.filter((d) => canonicalPath(d.path) !== abs), { path: abs, shareable, roots }]
    })
    await this.documents.start(this.config.watch.documents)
    this.changed('settings')
    return this.config.watch.documents
  }

  /** Smette di sorvegliare una cartella (i ricordi già distillati restano nel team). */
  async documentsRemove (dir: string): Promise<NodeSettings['documents']> {
    const abs = canonicalPath(dir)
    this.config = updateConfig(this.paths, (c) => {
      c.watch.documents = c.watch.documents.filter((d) => canonicalPath(d.path) !== abs)
    })
    await this.documents.start(this.config.watch.documents)
    this.changed('settings')
    return this.config.watch.documents
  }

  /** Conteggi dei documenti per stato (in coda, elaborati, bloccati…). */
  documentStats (): Record<string, number> {
    return this.privateStore.documentStats()
  }

  /**
   * Ottiene l'originale del documento da cui è stato distillato un ricordo (DESIGN §12-bis).
   * - documento di questo nodo → il file locale;
   * - già scaricato → la copia in cache;
   * - altrimenti → richiesta P2P al proprietario (deve essere online, D11).
   * @throws UserError se il ricordo non viene da un documento o il download non riesce
   */
  async fetchSource (memoryId: string): Promise<SourceFile> {
    const rec = this.index.get(memoryId)
    if (!rec) throw new UserError(`Nessun ricordo con id ${memoryId}`)
    const src = rec.source
    if (src?.type !== 'document' || !src.ref) throw new UserError('Questo ricordo non viene da un documento: non c\'è un originale da scaricare')
    const name = path.basename(src.name ?? 'documento')
    // Documento di questo nodo: nessun download.
    if (rec.author === this.team?.localKey) {
      const local = this.privateStore.documentsByHash(src.ref).find((d) => fs.existsSync(d.path))
      if (local) return { path: local.path, name, size: local.size, local: true }
    }
    const cached = path.join(this.paths.home, 'sources', src.ref, name)
    if (fs.existsSync(cached)) return { path: cached, name, size: fs.statSync(cached).size, local: true }
    let r: { data: Buffer, name: string }
    try {
      r = await this.files.fetch(src.ref)
    } catch (err) {
      throw new UserError(`Download non riuscito: ${(err as Error).message}`)
    }
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    fs.writeFileSync(cached, r.data)
    return { path: cached, name, size: r.data.length, local: false }
  }

  /** Testo estratto da un file scaricato (per il tool MCP: l'agente può leggerlo subito). */
  async sourceText (file: string, max = 20_000): Promise<string> {
    try {
      return (await extractText(file)).slice(0, max)
    } catch {
      return ''
    }
  }

  /**
   * Lato proprietario: quale file locale servire per un hash, se condivisibile (D10).
   * Il file deve stare in una cartella sorvegliata CONDIVISIBILE, esistere ed essere invariato.
   */
  private async resolveSharedFile (hash: string): Promise<{ file: string, name: string, size: number } | { denied: string }> {
    const docs: DocumentRecord[] = this.privateStore.documentsByHash(hash)
    if (docs.length === 0) return { denied: 'documento non disponibile su questo nodo' }
    for (const d of docs) {
      const folder = this.config.watch.documents.find((f) => canonicalPath(f.path) === canonicalPath(d.folder))
      if (!folder?.shareable) continue
      if (!fs.existsSync(d.path)) continue
      if (await hashFile(d.path) !== hash) continue // modificato dopo l'elaborazione: non è più "quel" documento
      return { file: d.path, name: path.basename(d.path), size: d.size }
    }
    return { denied: 'il proprietario non condivide gli originali di questa cartella' }
  }

  /** Elimina dalla cache i documenti scaricati più di SOURCE_CACHE_DAYS giorni fa. */
  private sweepSourceCache (): void {
    const dir = path.join(this.paths.home, 'sources')
    if (!fs.existsSync(dir)) return
    const limit = Date.now() - SOURCE_CACHE_DAYS * 24 * 3600 * 1000
    for (const h of fs.readdirSync(dir)) {
      const p = path.join(dir, h)
      if (fs.statSync(p).mtimeMs < limit) fs.rmSync(p, { recursive: true, force: true })
    }
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
    // Canale di scambio documenti su ogni connessione, comprese quelle già aperte.
    team.on('connection', (conn: any) => this.files.attach(conn))
    for (const conn of team.connections) this.files.attach(conn)
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
      const [all, members, votes, pins, usage, links, roots] = await Promise.all([team.memories(), team.members(), team.votes(), team.pins(), team.usage(), team.links(), team.roots()])
      this.rootsById = roots
      // Solo i ricordi ATTIVI entrano in ricerca, costellazione ed export; gli altri sono storico.
      const memories = all.filter((m) => (m.status ?? 'active') === 'active')
      this.inactive = all.filter((m) => (m.status ?? 'active') !== 'active')
      this.dreamLinks = links
      this.index.rebuild(memories, members, { votes, pins, usage })
      writeExport(this.paths.export, memories, members)
      // Collegamenti per ricordo (servono all'attivazione)
      const degrees = new Map<string, number>()
      for (const l of buildGraph(this.index.all(), [...this.semanticLinks(), ...this.explicitLinks()]).links) for (const k of [l.source, l.target]) degrees.set(k, (degrees.get(k) ?? 0) + 1)
      this.degrees = degrees
      this.scheduleEmbedding()
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

/** Crea l'embedder indicato in configurazione; null se "none". Il modello è condiviso da tutti i nodi della macchina. */
function createEmbedder (config: Config): Embedder | null {
  switch (config.embeddings.adapter) {
    case 'local': return new LocalEmbedder(config.embeddings.model, path.join(os.homedir(), '.cache', 'micelio-models'))
    case 'hash': return new HashEmbedder()
    default: return null
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

/** Dimensione di un file in byte (0 se non esiste). */
function fileSize (file: string): number {
  try { return fs.statSync(file).size } catch { return 0 }
}

/** Dimensione totale di una cartella, ricorsiva (0 se non esiste). */
function dirSize (dir: string): number {
  let n = 0
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return 0 }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    n += e.isDirectory() ? dirSize(p) : fileSize(p)
  }
  return n
}

/**
 * Le Radici sono testi lunghi e generali: per "Radici pertinenti" la soglia semantica è più bassa
 * di quella delle ricerche normali (moltiplicata per questo fattore).
 */
const ROOT_SEMANTIC_FACTOR = 0.85

/** Percorso di file confrontabile: barre "/", senza "./" iniziale, minuscolo. */
function normFile (f: string): string {
  return f.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}
