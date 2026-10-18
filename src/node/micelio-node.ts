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
import { LocalizedError } from '../core/errors'
import { MemoryInput, memoryId, type MemoryData, ROOT_CATEGORIES, type RootCategory } from '../core/events'
import type { GapRecord, InviteRecord, MemberRecord, NodeStatus, RecallHit, RootRecord } from '../core/model'
import type { NodePaths } from '../core/paths'
import { writeExport } from '../export/markdown'
import { buildGraph, type Graph, type GraphLink } from '../graph/constellation'
import { type Embedder, HashEmbedder, LocalEmbedder } from '../embed/embedder'
import { activation } from '../rank/activation'
import { hybridRank, nearest } from '../rank/hybrid'
import { currentEpoch, Dreamer, type DreamReport, dreamOrder } from '../dream/dreamer'
import type { MemoryRecord } from '../core/model'
import os from 'node:os'
import { type ExplicitOutcome, filterMemory, IngestPipeline, InboxNotFoundError } from '../ingest/pipeline'
import { ClaudeCliAdapter } from '../llm/claude-cli'
import { FakeAdapter } from '../llm/fake'
import { LlmRunner } from '../llm/runner'
import type { LlmAdapter } from '../llm/types'
import { TeamNode } from '../net/team-node'
import { applyFilter, builtinDetectors, compileTeamPatterns, mergeRules, type TeamSecretPattern } from '../privacy/filter'
import { DEFAULT_SENSITIVE_FILES, mergeSensitiveFiles, sensitiveMatch } from '../privacy/sensitive-files'
import { mergeBlockedPaths } from '../privacy/paths'
import { DocumentWatcher, hashFile } from '../ingest/documents'
import { extractText } from '../ingest/extract'
import { claudeProjectsDir, SessionScanner } from '../ingest/session-scanner'
import { FileShare } from '../net/file-share'
import { MemoryIndex } from '../store/memory-index'
import { type Decision, type DocumentRecord, type InboxItem, PrivateStore, type SecurityLogEntry } from '../store/private-store'
import { BOOTSTRAP_RE, canonicalPath, type Config, dhtBootstrap, isInsideWatched, loadConfig, loadState, networkMode, type NetworkMode, parseBootstrap, saveState, updateConfig } from './config'
import { checkNetwork, type NetworkCheck } from '../net/diagnose'
import { distillQuality, type DistillQuality, MAX_MEMORIES_RANGE, maxMemoriesOf } from '../ingest/quality'
import { localRepos, reviewRoots, type ReviewNote } from '../roots/review'
import { computeStaleness, stalenessFactor } from '../rank/code-staleness'
import { promptContext, sessionContext } from '../context/agent-context'
import { computeDigest, type Digest } from '../insight/digest'
import { gapId, gapKey } from '../insight/gaps'
import { repoInfo } from '../ingest/git-changes'
import { type Identity, signMembership } from '../core/identity'
import { checkDecision, WRITE_CANDIDATES, WriteDecision, writeUpdateInput, writeUpdateSystem } from '../ingest/write-update'

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
  /**
   * Embedder da usare al posto di quello configurato (test, o quello CONDIVISO fra i team di
   * MicelioHost). `null` = nessuna ricerca semantica. Se arriva da fuori, lo chiude chi l'ha creato.
   */
  embedder?: Embedder | null
  /**
   * Esecutore LLM CONDIVISO (B3): con più team le chiamate a Claude devono restare una alla volta
   * e il budget giornaliero è uno solo per macchina. Ha la precedenza su `llm`.
   */
  llmRunner?: LlmRunner | null
  /** Identità personale da legare a questo team (B3, src/core/identity.ts); assente = nessuna. */
  identity?: () => Identity | null
  /**
   * Con più team: true se una cartella di lavoro appartiene a QUESTO team. Una sessione in una
   * cartella abilitata in due team (es. `C:\work` nel team A e `C:\work\clienteX` nel team B)
   * va solo al team con la cartella più specifica. Assente = tutte le cartelle abilitate.
   */
  owns?: (dir: string) => boolean
  /**
   * Con più team: controlla che una cartella si possa abilitare in QUESTO team, e lancia un
   * UserError se un altro team la usa già (vedi MicelioHost.claimFolder).
   */
  claimFolder?: (dir: string, kind: 'sessions' | 'documents') => void
}

/** Errore causato dall'utente o dallo stato del nodo: messaggio pensato per essere mostrato. */
export class UserError extends LocalizedError {}

/**
 * Parti dello stato che possono cambiare, usate come "argomento" degli eventi `change`:
 * - status:    stato del nodo e del team (peer, ruolo, configurazione del team);
 * - memories:  ricordi del team;   members: membri;
 * - inbox, jobs, decisions: archivio privato (inbox, coda di ingestione, registro);
 * - settings:  impostazioni locali (cartelle abilitate, LLM).
 */
export type ChangeTopic = 'status' | 'memories' | 'members' | 'inbox' | 'jobs' | 'decisions' | 'settings' | 'roots' | 'security' | 'gaps'

/** Una lacuna del team come la mostrano UI e CLI (B4). */
export interface GapView extends GapRecord {
  askerNames: string[]
  /** Un ricordo che forse la colma (ricerca per parole chiave), se la lacuna è aperta. */
  answer: { id: string, title: string } | null
}

/** Impostazioni LOCALI modificabili dalla UI (config.json). */
export interface NodeSettings {
  llm: { adapter: string, command: string, classifyModel: string, distillModel: string, dailyBudget: number }
  watched: string[]
  /** Cartelle di documenti sorvegliate: originali scaricabili dai colleghi? cartella "di Radici"? */
  documents: { path: string, shareable: boolean, roots: boolean }[]
  port: number
  /** Rete P2P: DHT pubblica o privata del team (vedi server/README.md). */
  network: NetworkSettings
  /** Contesto automatico per gli agenti (B4). */
  context: { sessionStart: boolean, prompt: boolean, maxChars: number }
}

/** Impostazioni di rete come le mostra la UI. */
export interface NetworkSettings {
  /** DHT scelta nelle impostazioni del team ("local" = nessuna rete, B4). */
  mode: NetworkMode
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

/** Regole di sicurezza come le mostra la schermata Sicurezza (Fase 9). */
export interface SecurityRules {
  /** Tipi di segreto e dato personale riconosciuti sempre (non modificabili). */
  builtin: { type: string, label: string }[]
  /** Pattern di file sensibili di default (non modificabili). */
  defaultSensitiveFiles: string[]
  /** Regole del TEAM, modificabili dall'admin. */
  team: { secretPatterns: TeamSecretPattern[], allow: string[], sensitiveFiles: string[] }
}

/** Esito del banco di prova: cosa farebbe il filtro con un testo e/o un nome di file. */
export interface SecurityTestResult {
  /** Testo dopo la redazione. */
  text: string
  redactions: Record<string, number>
  /** Parole chiave HR/personali trovate: il contenuto resterebbe privato. */
  blockedBy: string[]
  /** Se è stato indicato un file: il pattern che lo rende sensibile, o null. */
  sensitiveFile: string | null
}

/** Un ricordo pubblicato che contiene segreti secondo le regole attuali (scansione retroattiva). */
export interface SecurityFinding {
  id: string
  title: string
  author: string
  authorName: string | null
  /** Tipi trovati, con il conteggio. */
  kinds: Record<string, number>
  /** È una Radice: dopo la pulizia lo resta. */
  root: boolean
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
  /** Cosa non è stato possibile verificare da questo PC, e perché (codice, valori e testo italiano). */
  notes: ReviewNote[]
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

/** Contesto automatico (B4): Radici e ricordi a inizio sessione, ricordi per richiesta, lunghezza minima della richiesta. */
const CONTEXT_ROOTS = 8
const CONTEXT_MEMORIES = 6
const CONTEXT_PER_PROMPT = 4
const CONTEXT_MIN_PROMPT = 15

/** Ricordi e codice (B4): primo controllo dopo l'avvio, poi ogni 6 ore. */
const STALE_FIRST_CHECK_MS = 60 * 1000
const STALE_CHECK_MS = 6 * 60 * 60 * 1000

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
  /** Ricordi il cui codice citato è cambiato (B4, src/rank/code-staleness.ts), da private.db. */
  private staleness = new Map<string, { commits: number, missing: number, checked: number }>()
  private staleTimer: NodeJS.Timeout | null = null
  /** Contesto automatico (B4): ricordi già mostrati in ogni sessione, per non ripeterli. */
  private injected = new Map<string, Set<string>>()
  /** Id dei ricordi PERSONALI presenti nell'indice (B4): restano su questo PC. */
  private personalIds = new Set<string>()
  /** Nome del team letto all'ultima materializzazione (vedi teamName). */
  private teamNameCache: string | null = null
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

    if (opts.llmRunner !== undefined) {
      // Esecutore condiviso da MicelioHost: una sola coda e un solo budget per tutti i team.
      this.llm = opts.llmRunner
    } else {
      // Scelta dell'adapter: override dei test > configurazione.
      const adapter = opts.llm !== undefined ? opts.llm : createAdapter(this.config)
      // Budget e modelli si leggono da this.config a ogni uso: la UI può cambiarli senza riavvio.
      this.llm = adapter ? new LlmRunner(adapter, this.privateStore, { dailyBudget: () => this.config.llm.dailyBudget, log: this.log }) : null
    }

    this.pipeline = new IngestPipeline({
      store: this.privateStore,
      llm: this.llm,
      models: () => ({ classify: this.config.llm.classifyModel, distill: this.config.llm.distillModel }),
      publish: (m) => this.publish(m),
      // Regole e lingua si leggono dalla vista a ogni uso: un admin può cambiarle in qualunque momento.
      // Regole del filtro: default + quelle del team (parole chiave, pattern di segreti, eccezioni)
      rules: async () => mergeRules(await this.team?.config('filter.blockKeywords'), await this.team?.config('security.secretPatterns'), await this.team?.config('security.allow')),
      sensitiveFiles: async () => mergeSensitiveFiles(await this.team?.config('security.sensitiveFiles')).filter((p) => !DEFAULT_SENSITIVE_FILES.includes(p)),
      blockedPaths: async () => mergeBlockedPaths(await this.team?.config('filter.blockedPaths')),
      language: async () => (await this.team?.config<string>('memory.language')) ?? 'it',
      maxMemories: async () => maxMemoriesOf(await this.team?.config('distill.maxMemories')),
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
      memories: () => this.enrich(this.teamMemories()),
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
    // B4: ricordi che invecchiano con il codice. Primo controllo poco dopo l'avvio (non lo rallenta),
    // poi a intervalli: i repository cambiano con il lavoro di tutti i giorni.
    this.staleness = this.privateStore.staleness()
    const firstCheck = setTimeout(() => { this.checkStaleness() }, STALE_FIRST_CHECK_MS)
    firstCheck.unref()
    this.staleTimer = setInterval(() => { this.checkStaleness() }, STALE_CHECK_MS)
    this.staleTimer.unref()
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
    await this.linkIdentity()
    await this.documents.start(this.config.watch.documents)
    // Recupero: sessioni lavorate mentre il daemon era spento (o parti nuove di sessioni lunghe).
    this.scanSessions()
  }

  /** Ferma tutto in ordine: worker, indicizzazione in corso, rete, database. */
  async stop (): Promise<void> {
    if (this.usageTimer) clearInterval(this.usageTimer)
    if (this.dreamTimer) clearInterval(this.dreamTimer)
    if (this.scanTimer) clearInterval(this.scanTimer)
    if (this.staleTimer) clearInterval(this.staleTimer)
    while (this.dreamer.busy) await new Promise((r) => setTimeout(r, 200))
    await this.flushUsage().catch(() => {})
    await this.embedding.catch(() => {})
    // Si chiude solo l'embedder creato qui: quello passato da fuori è condiviso con altri team.
    if (this.opts.embedder === undefined) await this.embedder?.close()
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

  /** Nome del team, dall'ultima lettura della vista (null prima della prima sincronizzazione). */
  get teamName (): string | null {
    return this.teamNameCache
  }

  /**
   * Rilegge la configurazione dal disco. Con più team (B3) la parte della macchina (modelli LLM,
   * budget) è condivisa: quando un team la cambia, MicelioHost fa rileggere gli altri.
   */
  reloadConfig (): void {
    this.config = loadConfig(this.paths)
  }

  /** true se il nodo appartiene a un team (state.json presente). */
  get configured (): boolean {
    return this.team !== null || loadState(this.paths) !== null
  }

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
    await this.linkIdentity()
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
    await this.linkIdentity()
    await this.documents.start(this.config.watch.documents)
    this.changed('status')
    return this.status()
  }

  /** Crea un invito (qualunque membro). Vedi TeamNode.createInvite per `replicated`. */
  async invite (): Promise<{ code: string, expires: number, replicated: boolean }> {
    const team = this.requireTeam()
    // Solo locale: nessuno potrebbe raggiungere questo nodo per usare l'invito
    if (this.localOnly) throw new UserError('Il team è in modalità solo locale: per invitare qualcuno scegli prima una rete (Impostazioni → Rete)', 'The team is in local-only mode: to invite someone, choose a network first (Settings → Network)')
    return team.createInvite()
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
    if (target.key === this.team?.localKey) throw new UserError('Un nodo non può espellere se stesso', 'A node cannot remove itself')
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
    // Validazione delle chiavi note: un valore sbagliato vale per tutto il team
    if (key === 'memory.updateOnWrite' && typeof value !== 'boolean') {
      throw new UserError('memory.updateOnWrite: true oppure false', 'memory.updateOnWrite: true or false')
    }
    if (key === 'distill.maxMemories' && maxMemoriesOf(value) !== value) {
      throw new UserError(`distill.maxMemories: un intero fra ${MAX_MEMORIES_RANGE.min} e ${MAX_MEMORIES_RANGE.max}`, `distill.maxMemories: an integer between ${MAX_MEMORIES_RANGE.min} and ${MAX_MEMORIES_RANGE.max}`)
    }
    await this.requireAdmin()
    await this.requireTeam().append({ type: 'team.config', key, value })
    await this.sync()
    this.changed('status')
  }

  /** Configurazione condivisa del team (lingua, parole chiave del filtro), per la UI. */
  async teamConfig (): Promise<{ language: string, blockKeywords: string[], maxMemories: number, updateOnWrite: boolean }> {
    const team = this.requireTeam()
    const kw = await team.config<unknown>('filter.blockKeywords')
    return {
      language: (await team.config<string>('memory.language')) ?? 'it',
      blockKeywords: Array.isArray(kw) ? kw.filter((k): k is string => typeof k === 'string') : [],
      maxMemories: maxMemoriesOf(await team.config('distill.maxMemories')),
      // B4: aggiornare invece di aggiungere (attivo salvo scelta contraria dell'admin)
      updateOnWrite: (await team.config('memory.updateOnWrite')) !== false
    }
  }

  /**
   * Qualità della distillazione (Fase 10): per fascia di posizione nel distillato, quanti ricordi
   * risultano utili, inutili, rimossi o mai usati, la saturazione del limite e un'indicazione per
   * l'admin. Calcolata sulla vista replicata: la stessa su ogni PC.
   */
  async distillQuality (now = Date.now()): Promise<DistillQuality> {
    const team = this.requireTeam()
    const signals = this.index.signals()
    const active = this.teamMemories().map((m) => ({ ts: m.ts, status: 'active' as const, source: m.source, votes: signals.get(m.id)?.votes ?? 0, uses: signals.get(m.id)?.uses ?? 0 }))
    const inactive = this.inactive.map((m) => ({ ts: m.ts, status: (m.status ?? 'archived') as 'superseded' | 'archived' | 'redacted', source: m.source, votes: 0, uses: 0 }))
    return distillQuality([...active, ...inactive], maxMemoriesOf(await team.config('distill.maxMemories')), now)
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
    const g = buildGraph(this.teamMemories(), [...this.semanticLinks(), ...this.explicitLinks()])
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
    // L'uso dei ricordi personali non si conta: verrebbe pubblicato al team (usage.report)
    const used = hits.filter((h) => !this.personalIds.has(h.id)).map((h) => h.id)
    if (track && used.length) this.privateStore.countUsage(used)
    // B4: una ricerca esplicita senza risultati è una lacuna di conoscenza (solo su questo PC)
    if (track && hits.length === 0) await this.recordMiss(query)
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
    if (this.dreamer.busy) throw new UserError('Un sogno è già in corso', 'A dream is already running')
    if (!this.llm) throw new UserError('Serve un LLM per sognare (llm.adapter in config.json)', 'Dreaming needs an LLM (llm.adapter in config.json)')
    const r = await this.runDream(`manuale-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`)
    if (!r) throw new UserError('Un altro nodo sta già sognando questa epoca', 'Another node is already dreaming this epoch')
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
    if (!m) throw new UserError(`Nessun ricordo archiviato con id ${id}`, `No archived memory with id ${id}`)
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
    if (!ROOT_CATEGORIES.includes(category)) throw new UserError(`Categoria sconosciuta: ${category} (${ROOT_CATEGORIES.join(', ')})`, `Unknown category: ${category} (${ROOT_CATEGORIES.join(', ')})`)
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
      memories: this.enrich(this.teamMemories()),
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
    if (!rec || !r) throw new UserError(`Il ricordo ${id} non è una Radice`, `Memory ${id} is not a Root`)
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

  /**
   * Attivazione 0..1 di un ricordo (vedi src/rank/activation.ts), ridotta se il codice citato è
   * cambiato dopo il ricordo (B4). Radici e ricordi fissati non si riducono: per le Radici c'è la
   * revisione, i fissati sono una scelta esplicita del team.
   */
  private activationOf (id: string, signals = this.index.signals()): number {
    const s = signals.get(id)
    const rec = this.index.get(id)
    if (!rec) return 0
    const root = this.rootsById.has(id)
    const a = activation({ kind: rec.kind, createdAt: rec.ts, lastUsed: s?.lastUsed ?? undefined, uses: s?.uses ?? 0, votes: s?.votes ?? 0, degree: this.degrees.get(id) ?? 0, pinned: !!s?.pinned, root })
    return root || s?.pinned ? a : a * stalenessFactor(this.staleness.get(id))
  }

  /**
   * Controlla quanto è cambiato il codice citato dai ricordi del team (B4), sui repository di
   * questo PC (cartelle abilitate e loro sotto-cartelle). Sincrono ma con UNA chiamata a git per
   * repository. Chiamato all'avvio, ogni 6 ore e da `micelio stale --check`.
   * @returns ricordi controllati e quanti risultano con codice cambiato
   */
  checkStaleness (): { checked: number, stale: number } {
    if (!this.team) return { checked: 0, stale: 0 }
    try {
      const found = computeStaleness(this.teamMemories(), localRepos(this.config.watch.sessions))
      for (const [id, st] of found) this.privateStore.setStaleness(id, st.commits, st.missing)
      this.staleness = this.privateStore.staleness()
      const stale = [...found.values()].filter((s) => s.commits || s.missing).length
      if (found.size) this.changed('memories')
      return { checked: found.size, stale }
    } catch (err) {
      this.log(`controllo del codice citato non riuscito: ${(err as Error).message}`)
      return { checked: 0, stale: 0 }
    }
  }

  /** Ricordi del team con il codice citato cambiato, dai più cambiati. */
  staleMemories (): RecallHit[] {
    return this.enrich(this.teamMemories()).filter((h) => h.stale).sort((a, b) => (b.stale!.commits + 5 * b.stale!.missing) - (a.stale!.commits + 5 * a.stale!.missing))
  }

  /** Aggiunge ai risultati attivazione, voti, usi e pin. */
  private enrich (hits: RecallHit[], signals = this.index.signals()): RecallHit[] {
    return hits.map((h) => {
      const s = signals.get(h.id)
      const r = this.rootsById.get(h.id)
      return {
        ...h,
        activation: this.activationOf(h.id, signals),
        votes: s?.votes ?? 0,
        uses: s?.uses ?? 0,
        pinned: !!s?.pinned,
        ...(r ? { root: { category: r.category, status: r.status } } : {}),
        ...(this.personalIds.has(h.id) ? { personal: true } : {}),
        ...this.staleOf(h.id)
      }
    })
  }

  /** Un ricordo DEL TEAM (le operazioni di team non valgono per i ricordi personali). */
  private requireMemory (id: string): RecallHit {
    const rec = this.index.get(id)
    if (!rec) throw new UserError(`Nessun ricordo con id ${id}`, `No memory with id ${id}`)
    if (this.personalIds.has(rec.id)) throw new UserError('È un ricordo personale: condividilo prima con il team', 'This is a personal memory: share it with the team first')
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
    return this.enrich(this.index.recent(limit))
  }

  // ═══════════════════════════ Contesto automatico (B4) ═══════════════════════════

  /**
   * Contesto da inserire nella conversazione di un agente (hook di Claude Code, vedi
   * src/context/agent-context.ts). Mai un errore: nel dubbio, nessun contesto.
   * @param o.event    "session-start" (Radici e ricordi del progetto) o "prompt" (pertinenti al testo)
   * @param o.cwd      cartella di lavoro dell'agente: dà il progetto
   * @param o.sessionId per non ripetere nella stessa sessione ciò che è già stato mostrato
   */
  async agentContext (o: { event: 'session-start' | 'prompt', cwd: string, sessionId?: string, prompt?: string }): Promise<string> {
    const cfg = this.config.context
    if (!this.team) return ''
    try {
      const seen = o.sessionId ? (this.injected.get(o.sessionId) ?? new Set<string>()) : new Set<string>()
      const team = this.teamNameCache ?? ''
      let text = ''
      let shown: RecallHit[] = []
      if (o.event === 'session-start') {
        if (!cfg.sessionStart) return ''
        const project = repoInfo(o.cwd)?.project ?? path.basename(o.cwd)
        // Radici del progetto, più quelle generali (best practice e policy valgono ovunque)
        const all = await this.roots()
        const roots = all.filter((r) => r.memory.source?.code?.project?.toLowerCase() === project.toLowerCase() || r.memory.tags.includes(project.toLowerCase()) ||
          ((r.category === 'practice' || r.category === 'policy') && !r.memory.source?.code?.project)).map((r) => r.memory).slice(0, CONTEXT_ROOTS)
        const rootIds = new Set(roots.map((r) => r.id))
        const memories = this.enrich(this.index.all())
          .filter((h) => !rootIds.has(h.id) && (h.source?.code?.project?.toLowerCase() === project.toLowerCase() || h.tags.includes(project.toLowerCase())))
          .sort((a, b) => (b.activation ?? 0) - (a.activation ?? 0)).slice(0, CONTEXT_MEMORIES)
        text = sessionContext({ team, project, roots, memories, maxChars: cfg.maxChars })
        shown = [...roots, ...memories]
      } else {
        if (!cfg.prompt || !o.prompt || o.prompt.trim().length < CONTEXT_MIN_PROMPT) return ''
        const hits = (await this.relevantTo(o.prompt, CONTEXT_MEMORIES)).filter((h) => !seen.has(h.id))
        const roots = (await this.relatedRoots(o.prompt, hits.map((h) => h.id), 2)).filter((h) => !seen.has(h.id))
        shown = [...roots, ...hits].slice(0, CONTEXT_PER_PROMPT)
        text = promptContext({ team, memories: shown, maxChars: cfg.maxChars })
      }
      if (o.sessionId && text) {
        for (const h of shown) seen.add(h.id)
        this.injected.set(o.sessionId, seen)
        // Memoria limitata: le sessioni più vecchie si dimenticano
        if (this.injected.size > 200) this.injected.delete(this.injected.keys().next().value!)
      }
      return text
    } catch (err) {
      this.log(`contesto per l'agente non calcolato: ${(err as Error).message}`)
      return ''
    }
  }

  /**
   * Ricordi PERTINENTI a un testo libero (la richiesta di un utente): solo per significato e sopra
   * la soglia del modello. Le sole parole chiave su un testo lungo trovano troppo rumore. Senza
   * embedding: nessun risultato. Non conta come uso (l'agente potrebbe ignorarli).
   */
  private async relevantTo (text: string, n: number): Promise<RecallHit[]> {
    if (!this.embedder) return []
    const [q] = await this.embedder.embed([text.slice(0, 2000)], 'query')
    const ids = nearest(q, this.index.vectors(this.embedder.model), n, semanticThreshold(this.embedder.model)).map((r) => r.id)
    return this.enrich(this.index.getMany(ids))
  }

  // ═══════════════════════ Lacune e riepilogo settimanale (B4) ═══════════════════════

  /** Registra una ricerca senza risultato, dopo la redazione dei segreti (src/insight/gaps.ts). */
  private async recordMiss (query: string): Promise<void> {
    const key = gapKey(query)
    if (!key) return
    try {
      const { text } = applyFilter(query.trim().slice(0, 300), await this.filterRules())
      this.privateStore.addSearchMiss(key, text)
      this.changed('gaps')
    } catch (err) {
      this.log(`lacuna non registrata: ${(err as Error).message}`)
    }
  }

  /**
   * Le TUE ricerche senza risposta (solo su questo PC), dalle più frequenti. `answer` = un ricordo
   * arrivato nel frattempo che forse la colma (ricerca per parole chiave).
   */
  myGaps (): { key: string, query: string, count: number, first: number, last: number, answer: { id: string, title: string } | null }[] {
    return this.privateStore.searchMisses('open').map((m) => {
      const [id] = this.index.keywordIds(m.query, 1)
      const hit = id ? this.index.get(id) : null
      return { key: m.key, query: m.query, count: m.count, first: m.first, last: m.last, answer: hit ? { id: hit.id, title: hit.title } : null }
    })
  }

  /** Ignora una tua lacuna (non riapparirà). */
  dismissGap (key: string): void {
    this.privateStore.setSearchMissStatus(key, 'dismissed')
    this.changed('gaps')
  }

  /** Segnala al team una tua lacuna: tutti la vedono e chi ha lo stesso bisogno si aggiunge. */
  async reportGap (key: string, question?: string): Promise<GapView[]> {
    const team = this.requireTeam()
    const mine = this.privateStore.searchMisses('open', 1000).find((m) => m.key === key)
    const text = (question ?? mine?.query ?? '').trim()
    if (text.length < 3) throw new UserError('Scrivi la domanda (almeno 3 caratteri)', 'Write the question (at least 3 characters)')
    const { text: clean, blocked } = applyFilter(text, await this.filterRules())
    if (blocked) throw new UserError('La domanda contiene parole che non possono andare al team: riformulala', 'The question contains words that cannot go to the team: rephrase it')
    await team.append({ type: 'gap.report', id: gapId(gapKey(clean) || key), question: clean.slice(0, 300) })
    if (mine) this.privateStore.setSearchMissStatus(key, 'reported')
    await this.sync()
    this.changed('gaps')
    return this.teamGaps()
  }

  /** Lacune segnalate al team, aperte prima, con chi le condivide e un possibile ricordo che le colma. */
  async teamGaps (): Promise<GapView[]> {
    const team = this.requireTeam()
    const names = new Map((await team.members()).map((m) => [m.key, m.name]))
    return (await team.gaps()).map((g) => {
      const [id] = g.status === 'open' ? this.index.keywordIds(g.question, 1) : []
      const hit = id ? this.index.get(id) : null
      return { ...g, askerNames: g.askers.map((k) => names.get(k) ?? k.slice(0, 8)), answer: hit ? { id: hit.id, title: hit.title } : null }
    }).sort((a, b) => (a.status === b.status ? b.askers.length - a.askers.length || b.ts - a.ts : a.status === 'open' ? -1 : 1))
  }

  /** Chiude una lacuna del team, facoltativamente con il ricordo che la colma. */
  async closeGap (id: string, memory?: string): Promise<GapView[]> {
    const team = this.requireTeam()
    const found = (await team.gaps()).find((g) => g.id === id || g.id.startsWith(id))
    if (!found) throw new UserError(`Nessuna lacuna con id ${id}`, `No gap with id ${id}`)
    const mem = memory ? this.requireMemory(memory).id : undefined
    await team.append({ type: 'gap.close', id: found.id, ...(mem ? { memory: mem } : {}) })
    await this.sync()
    this.changed('gaps')
    return this.teamGaps()
  }

  /** Riepilogo degli ultimi `days` giorni (src/insight/digest.ts). */
  async digest (days = 7, now = Date.now()): Promise<Digest> {
    const team = this.requireTeam()
    const signals = this.index.signals()
    const lastUsed = new Map<string, number>()
    for (const [id, s] of signals) if (s.lastUsed) lastUsed.set(id, s.lastUsed)
    return computeDigest({
      now,
      days,
      memories: this.enrich(this.teamMemories(), signals),
      roots: [...this.rootsById.values()],
      lastUsed,
      gaps: await team.gaps(),
      myMisses: this.privateStore.searchMisses('open', 1000),
      dreams: await team.dreamLogs()
    })
  }

  // ═══════════════════════════ Ricordi personali (B4) ═══════════════════════════

  /** Campo `stale` di un risultato, se il codice citato è cambiato (le Radici hanno la revisione). */
  private staleOf (id: string): { stale?: { commits: number, missing: number } } {
    const st = this.staleness.get(id)
    if (!st || (!st.commits && !st.missing) || this.rootsById.has(id)) return {}
    return { stale: { commits: st.commits, missing: st.missing } }
  }

  /** Ricordi del TEAM nell'indice (senza i personali): per costellazione, dreaming, metriche, export. */
  private teamMemories (): RecallHit[] {
    return this.personalIds.size ? this.index.all().filter((m) => !this.personalIds.has(m.id)) : this.index.all()
  }

  /** I ricordi personali come record dell'indice (autore = questo nodo). */
  private personalRecords (me: string): MemoryRecord[] {
    return this.privateStore.personal().map(({ id, memory, created }) => ({
      id, kind: memory.kind, title: memory.title, body: memory.body, tags: memory.tags, source: memory.source, author: me, ts: created, status: 'active' as const
    }))
  }

  /**
   * Salva un ricordo PERSONALE: resta su questo PC e compare nelle ricerche (anche degli agenti)
   * insieme a quelli del team. Passa comunque dalla redazione dei segreti (agli agenti arriva il
   * testo); il blocco dei contenuti personali/HR non si applica, perché non lascia il PC.
   */
  async rememberPersonal (input: MemoryInput): Promise<{ id: string, duplicate: boolean }> {
    this.requireTeam()
    const parsed = MemoryInput.safeParse(input)
    if (!parsed.success) throw new UserError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    const { memory } = filterMemory(parsed.data, await this.filterRules())
    const id = memoryId(memory)
    const added = this.privateStore.addPersonal(id, memory)
    await this.materialize()
    return { id, duplicate: !added }
  }

  /** I ricordi personali, dal più recente. */
  personal (): RecallHit[] {
    return this.enrich(this.index.getMany([...this.personalIds])).sort((a, b) => b.ts - a.ts)
  }

  /**
   * Condivide un ricordo personale con il team: esce dai personali e passa dalla stessa strada
   * di un salvataggio esplicito (filtro e classificazione, D6), quindi può finire in inbox.
   */
  async sharePersonal (id: string): Promise<ExplicitOutcome> {
    const p = this.privateStore.personal().find((x) => x.id === id || x.id.startsWith(id))
    if (!p) throw new UserError(`Nessun ricordo personale con id ${id}`, `No personal memory with id ${id}`)
    const outcome = await this.pipeline.ingestExplicit({ ...p.memory, source: { ...p.memory.source, type: 'personal' } })
    this.privateStore.removePersonal(p.id)
    await this.materialize()
    return outcome
  }

  /** Cancella un ricordo personale (non lascia tracce: non è mai stato nel log). */
  async deletePersonal (id: string): Promise<void> {
    const p = this.privateStore.personal().find((x) => x.id === id || x.id.startsWith(id))
    if (!p) throw new UserError(`Nessun ricordo personale con id ${id}`, `No personal memory with id ${id}`)
    this.privateStore.removePersonal(p.id)
    await this.materialize()
  }

  /** Un elemento dell'inbox non va al team ma resta come ricordo personale. */
  async keepPersonal (inboxId: string): Promise<{ id: string, duplicate: boolean }> {
    this.requireTeam()
    const memory = this.pipeline.keepPrivately(inboxId)
    const id = memoryId(memory)
    const added = this.privateStore.addPersonal(id, memory)
    await this.materialize()
    return { id, duplicate: !added }
  }

  /** Un ricordo per id (anche abbreviato). */
  get (id: string): RecallHit | null {
    return this.index.get(id)
  }

  /**
   * Pubblica un ricordo nel team SENZA filtri: usato dalla pipeline dopo che ha deciso.
   * Non esposto all'esterno: tutto ciò che arriva da fuori passa da `remember`.
   */
  private async publish (memory: MemoryData): Promise<{ id: string, duplicate: boolean, updated?: string }> {
    const team = this.requireTeam()
    const id = memoryId(memory)
    // Controllo locale dei duplicati: evita di scrivere nel log un evento che apply ignorerebbe.
    // Un ricordo personale con lo stesso contenuto non conta: è proprio quello che si sta condividendo
    if (this.index.get(id)?.id === id && !this.personalIds.has(id)) return { id, duplicate: true }
    // B4: aggiornare invece di aggiungere (src/ingest/write-update.ts)
    const d = await this.writeDecision(memory)
    if (d?.action === 'duplicate' && d.target) {
      this.log(`ricordo non aggiunto, duplica ${d.target.slice(0, 8)}: ${d.reason}`)
      return { id: d.target, duplicate: true }
    }
    if (d?.action === 'update' && d.target && d.merged) {
      const merged = { ...d.merged, source: memory.source }
      await team.append({ type: 'memory.supersede', old: [d.target], memory: merged, reason: `aggiornato alla scrittura: ${d.reason}` })
      await this.sync()
      this.log(`ricordo ${d.target.slice(0, 8)} aggiornato alla scrittura: ${d.reason}`)
      return { id: memoryId({ kind: merged.kind, title: merged.title, body: merged.body }), duplicate: false, updated: d.target }
    }
    await team.append({ type: 'memory.add', memory })
    await this.sync()
    return { id, duplicate: false }
  }

  /**
   * Decisione "aggiungi, duplicato o aggiorna" per un ricordo nuovo (B4). null = aggiungi e basta:
   * nessun ricordo simile, nessun LLM o budget finito, o disattivata dal team
   * (`memory.updateOnWrite` = false).
   */
  private async writeDecision (memory: MemoryData): Promise<WriteDecision | null> {
    if (!this.embedder || !this.llm?.hasBudget() || (await this.team?.config('memory.updateOnWrite')) === false) return null
    try {
      const [vec] = await this.embedder.embed([`${memory.title}\n${memory.body}`], 'passage')
      const vectors = this.index.vectors(this.embedder.model)
      for (const id of this.personalIds) vectors.delete(id)
      const near = nearest(vec, vectors, WRITE_CANDIDATES, semanticThreshold(this.embedder.model))
      if (!near.length) return null
      const pins = this.index.signals()
      const candidates = near.flatMap((n) => {
        const hit = this.index.get(n.id)
        return hit ? [{ hit, score: n.score, protected: this.rootsById.has(n.id) || !!pins.get(n.id)?.pinned }] : []
      })
      if (!candidates.length) return null
      const language = (await this.team?.config<string>('memory.language')) ?? 'it'
      const d = await this.llm.run({ name: 'write-update', system: writeUpdateSystem(language), input: writeUpdateInput(memory, candidates), schema: WriteDecision, model: this.config.llm.classifyModel })
      return checkDecision(d, candidates)
    } catch (err) {
      // Qualunque problema (modello, LLM, budget): si aggiunge come prima, nessun sapere va perso
      this.log(`controllo dei ricordi simili non riuscito: ${(err as Error).message}`)
      return null
    }
  }

  // ═══════════════════════════ Ingestione automatica ═══════════════════════════

  /**
   * Riceve la notifica di fine sessione di Claude Code (dall'hook SessionEnd).
   * Accoda la sessione SOLO se la cartella di lavoro è opt-in (decisione D7).
   * @returns `queued: false` con il motivo se la sessione è stata ignorata
   */
  ingestSession (payload: { sessionId: string, transcriptPath: string, cwd: string }): { queued: boolean, reason?: string, jobId?: number } {
    if (!this.team) return { queued: false, reason: 'nodo non configurato' }
    if (!isInsideWatched(payload.cwd, this.config.watch.sessions) || !this.ownsFolder(payload.cwd)) {
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
      // Con più team si tengono solo le sessioni delle cartelle che appartengono a questo team
      const found = this.scanner.scan({ projectsDir: claudeProjectsDir(), watched: this.config.watch.sessions, ...s }).filter((c) => this.ownsFolder(c.cwd))
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
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new UserError(`Cartella inesistente: ${path.resolve(dir)}`, `Folder not found: ${path.resolve(dir)}`)
    // Salviamo la forma canonica (nome lungo, link risolti): è quella che si vede nell'elenco.
    const abs = canonicalPath(dir)
    this.opts.claimFolder?.(abs, 'sessions')
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
    return { llm: { adapter, command, classifyModel, distillModel, dailyBudget }, watched: this.config.watch.sessions, documents: this.config.watch.documents, port: this.config.port, network: this.networkSettings(), context: { ...this.config.context } }
  }

  // ═══════════════════════════ Sicurezza (Fase 9) ═══════════════════════════

  /** Regole in vigore: riconoscitori fissi, file sensibili di default e regole del team. */
  async securityRules (): Promise<SecurityRules> {
    const team = this.team
    const patterns = await team?.config<unknown>('security.secretPatterns')
    const allow = await team?.config<unknown>('security.allow')
    const files = await team?.config<unknown>('security.sensitiveFiles')
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return {
      builtin: builtinDetectors(),
      defaultSensitiveFiles: DEFAULT_SENSITIVE_FILES,
      team: {
        secretPatterns: Array.isArray(patterns) ? patterns.filter((p): p is TeamSecretPattern => typeof p?.name === 'string' && typeof p?.regex === 'string') : [],
        allow: strings(allow),
        sensitiveFiles: strings(files)
      }
    }
  }

  /**
   * Aggiorna le regole del team (solo admin): pattern di segreti, eccezioni, file sensibili.
   * Vengono replicate a tutti i nodi e valgono subito. I pattern non validi vengono rifiutati qui,
   * con un messaggio leggibile, invece di essere ignorati in silenzio dalla pipeline.
   */
  async setSecurityRules (patch: Partial<SecurityRules['team']>): Promise<SecurityRules> {
    if (patch.secretPatterns) {
      for (const p of patch.secretPatterns) {
        if (!p.name?.trim() || !p.regex?.trim()) throw new UserError('Ogni pattern ha un nome e un\'espressione regolare', 'Every pattern needs a name and a regular expression')
        if (p.regex.length > 300) throw new UserError(`Pattern «${p.name}» troppo lungo (massimo 300 caratteri)`, `Pattern “${p.name}” is too long (300 characters at most)`)
        try { new RegExp(p.regex, 'g') } catch (e) { throw new UserError(`Pattern «${p.name}» non valido: ${(e as Error).message}`, `Pattern “${p.name}” is not valid: ${(e as Error).message}`) }
        // Un pattern che riconosce la stringa vuota redigerebbe ovunque
        if (new RegExp(p.regex).test('')) throw new UserError(`Pattern «${p.name}» riconosce anche il testo vuoto: troppo generico`, `Pattern “${p.name}” also matches empty text: too generic`)
      }
      if (compileTeamPatterns(patch.secretPatterns).length !== patch.secretPatterns.length) throw new UserError('Alcuni pattern non sono validi', 'Some patterns are not valid')
      await this.setTeamConfig('security.secretPatterns', patch.secretPatterns.map((p) => ({ name: p.name.trim(), regex: p.regex })))
    }
    if (patch.allow) await this.setTeamConfig('security.allow', patch.allow.map((a) => a.trim()).filter(Boolean))
    if (patch.sensitiveFiles) await this.setTeamConfig('security.sensitiveFiles', patch.sensitiveFiles.map((f) => f.trim()).filter(Boolean))
    this.changed('security')
    return this.securityRules()
  }

  /** Banco di prova: cosa farebbe il filtro con un testo e/o un nome di file. Non salva nulla. */
  async securityTest (text: string, file?: string): Promise<SecurityTestResult> {
    const rules = await this.filterRules()
    const r = applyFilter(text, rules)
    const extra = (await this.securityRules()).team.sensitiveFiles
    return { text: r.text, redactions: r.redactions, blockedBy: r.reasons, sensitiveFile: file ? sensitiveMatch(file, extra) : null }
  }

  /**
   * Scansione retroattiva: i ricordi pubblicati che, con le regole ATTUALI, contengono segreti o
   * dati personali (es. pubblicati prima di una nuova regola). Solo segnalazione: la pulizia è
   * un'azione esplicita (securityClean).
   */
  async securityScan (): Promise<SecurityFinding[]> {
    const rules = await this.filterRules()
    const out: SecurityFinding[] = []
    for (const m of this.teamMemories()) {
      const r = applyFilter(`${m.title}\n${m.body}\n${m.tags.join(' ')}`, rules)
      if (Object.keys(r.redactions).length) out.push({ id: m.id, title: m.title, author: m.author, authorName: m.authorName, kinds: r.redactions, root: this.rootsById.has(m.id) })
    }
    return out
  }

  /**
   * "Ripulisci" un ricordo (solo admin): pubblica la versione REDATTA e rimuove l'originale dalla
   * vista di tutti (memory.redact). Se era una Radice, la versione pulita lo resta.
   * Limite: chi aveva già letto o esportato l'originale ne conserva una copia, e i blocchi cifrati
   * restano nei log replicati (come per ogni redazione, DESIGN §10.3).
   * @returns id della versione pulita
   */
  async securityClean (id: string): Promise<{ id: string }> {
    await this.requireAdmin()
    const rec = this.requireMemory(id)
    const rules = await this.filterRules()
    const clean = {
      kind: rec.kind,
      title: applyFilter(rec.title, rules).text,
      body: applyFilter(rec.body, rules).text,
      tags: rec.tags.map((t) => applyFilter(t, rules).text),
      source: rec.source ?? { type: 'api' }
    }
    if (clean.title === rec.title && clean.body === rec.body) throw new UserError('Il ricordo non contiene segreti secondo le regole attuali', 'The memory contains no secrets according to the current rules')
    const parsed = MemoryInput.parse(clean)
    const newId = memoryId(parsed)
    const team = this.requireTeam()
    await team.append({ type: 'memory.add', memory: parsed })
    const root = this.rootsById.get(rec.id)
    if (root) await team.append({ type: 'root.set', id: newId, category: root.category })
    await team.append({ type: 'memory.redact', id: rec.id, reason: 'ripulito: conteneva segreti o dati personali' })
    this.privateStore.addSecurityLog({ source: { type: 'clean', ref: rec.id }, label: rec.title, kinds: applyFilter(`${rec.title}\n${rec.body}`, rules).redactions, omitted: [] })
    await this.sync()
    this.changed('security')
    return { id: newId }
  }

  /** Registro di sicurezza locale (cosa è stato tolto, da dove, di che tipo). */
  securityLog (limit = 200): SecurityLogEntry[] {
    return this.privateStore.securityLog(limit)
  }

  /** Regole del filtro in vigore (default + team): le stesse usate dalla pipeline. */
  private async filterRules () {
    return mergeRules(await this.team?.config('filter.blockKeywords'), await this.team?.config('security.secretPatterns'), await this.team?.config('security.allow'))
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
   * Sceglie la rete (DHT pubblica, privata, o "local" = nessuna rete) e la applica SUBITO: salva le impostazioni del team e, se il nodo è
   * in un team, chiude e riapre la rete con i nuovi nodi di avvio (i dati locali restano; dopo
   * pochi secondi il nodo ritrova i colleghi che usano la stessa DHT).
   * ATTENZIONE: tutti i membri devono usare la stessa DHT, altrimenti non si trovano.
   * @param bootstrap nodi "host:porta" della DHT privata; con "public" si possono omettere
   *                  (restano quelli salvati, per poter tornare alla privata)
   */
  async setNetwork (mode: NetworkMode, bootstrap?: string[]): Promise<NetworkSettings> {
    // La modalità solo locale si può scegliere anche con la rete fissata dalla variabile (demo, test)
    if (process.env.MICELIO_DHT_BOOTSTRAP && mode !== 'local' && !this.localOnly) throw new UserError('La rete è fissata dalla variabile MICELIO_DHT_BOOTSTRAP: toglila per sceglierla da qui', 'The network is set by the MICELIO_DHT_BOOTSTRAP variable: remove it to choose from here')
    if (mode !== 'public' && mode !== 'private' && mode !== 'local') throw new UserError('Rete: "public", "private" oppure "local"', 'Network: "public", "private" or "local"')
    const list = bootstrap?.map((b) => b.trim()).filter(Boolean)
    if (list?.some((b) => !BOOTSTRAP_RE.test(b))) throw new UserError('Formato dei nodi di avvio: host:porta (es. 203.0.113.10:49737)', 'Bootstrap node format: host:port (e.g. 203.0.113.10:49737)')
    if (mode === 'private' && !(list ?? this.config.network.bootstrap).length) throw new UserError('Per la DHT privata serve almeno un nodo di avvio (il server del team)', 'The private DHT needs at least one bootstrap node (the team server)')
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
  async checkNetwork (mode?: NetworkMode, bootstrap?: string[]): Promise<NetworkCheck> {
    if (mode === 'local' || (mode === undefined && this.localOnly)) throw new UserError('In modalità solo locale non c\'è nessuna rete da verificare', 'In local-only mode there is no network to check')
    if (mode === undefined) return checkNetwork(this.opts.bootstrap)
    if (mode === 'public') return checkNetwork(undefined)
    const list = (bootstrap ?? this.config.network.bootstrap).map((b) => b.trim()).filter(Boolean)
    if (!list.length || list.some((b) => !BOOTSTRAP_RE.test(b))) throw new UserError('Indica almeno un nodo di avvio nel formato host:porta', 'Give at least one bootstrap node as host:port')
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
    for (const m of this.teamMemories()) {
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
      throw new UserError('Il budget giornaliero deve essere un intero maggiore o uguale a 0', 'The daily budget must be an integer greater than or equal to 0')
    }
    this.config = updateConfig(this.paths, (c) => {
      if (patch.classifyModel) c.llm.classifyModel = patch.classifyModel
      if (patch.distillModel) c.llm.distillModel = patch.distillModel
      if (patch.dailyBudget !== undefined) c.llm.dailyBudget = patch.dailyBudget
    })
    this.changed('settings')
    return this.settings()
  }

  /** Contesto automatico per gli agenti (B4): cosa inseriscono gli hook. Vale per la macchina. */
  updateContextSettings (patch: { sessionStart?: boolean, prompt?: boolean, maxChars?: number }): NodeSettings {
    this.config = updateConfig(this.paths, (c) => {
      if (patch.sessionStart !== undefined) c.context.sessionStart = patch.sessionStart
      if (patch.prompt !== undefined) c.context.prompt = patch.prompt
      if (patch.maxChars !== undefined) c.context.maxChars = patch.maxChars
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
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new UserError(`Cartella inesistente: ${path.resolve(dir)}`, `Folder not found: ${path.resolve(dir)}`)
    const abs = canonicalPath(dir)
    this.opts.claimFolder?.(abs, 'documents')
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
    if (!rec) throw new UserError(`Nessun ricordo con id ${memoryId}`, `No memory with id ${memoryId}`)
    const src = rec.source
    if (src?.type !== 'document' || !src.ref) throw new UserError('Questo ricordo non viene da un documento: non c\'è un originale da scaricare', 'This memory does not come from a document: there is no original to download')
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
      throw new UserError(`Download non riuscito: ${(err as Error).message}`, `Download failed: ${(err as Error).message}`)
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
      throw err instanceof InboxNotFoundError ? new UserError(err.message, err.en) : err
    }
  }

  /** Rifiuta un elemento dell'inbox. */
  reject (id: string): void {
    try {
      this.pipeline.reject(id)
    } catch (err) {
      throw err instanceof InboxNotFoundError ? new UserError(err.message, err.en) : err
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
      localOnly: this.localOnly,
      nodeName: this.nodeName,
      nodeKey: team.localKey,
      team: await team.team(),
      writable: team.writable,
      indexer: team.isIndexer,
      role: me?.role ?? null,
      peers: team.peers,
      members: members.length,
      memories: this.index.count() - this.personalIds.size
    }
  }

  /** Scarica ciò che è disponibile dai peer e riallinea indice ed export. */
  async sync (): Promise<void> {
    await this.requireTeam().update()
    await this.materialize()
  }

  // ═════════════════════════════════ Interni ═══════════════════════════════════

  private newTeamNode (): TeamNode {
    return new TeamNode({ storeDir: this.paths.store, bootstrap: this.opts.bootstrap, log: this.log, offline: this.localOnly })
  }

  /** true se il team è in modalità solo locale (B4): nessuna rete. */
  get localOnly (): boolean {
    return networkMode(this.config.network) === 'local'
  }

  /**
   * Sceglie la rete PRIMA di creare il team (es. «Solo per me» nel primo avvio). Dopo la
   * creazione si usa setNetwork, che riconnette il nodo.
   */
  prepareNetwork (mode: NetworkMode): void {
    if (this.team) throw new UserError('Il team esiste già: cambia la rete dalle Impostazioni', 'The team already exists: change the network from Settings')
    this.config = updateConfig(this.paths, (c) => { c.network.mode = mode })
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
      this.teamNameCache = (await team.team())?.name ?? this.teamNameCache
      // Solo i ricordi ATTIVI entrano in ricerca, costellazione ed export; gli altri sono storico.
      const memories = all.filter((m) => (m.status ?? 'active') === 'active')
      this.inactive = all.filter((m) => (m.status ?? 'active') !== 'active')
      this.dreamLinks = links
      // Nell'indice anche i ricordi personali (B4), così ricerca e agenti li trovano insieme a quelli
      // del team; restano fuori da export, costellazione, dreaming e metriche (vedi teamMemories).
      const teamIds = new Set(memories.map((m) => m.id))
      const personal = this.personalRecords(team.localKey ?? '').filter((p) => !teamIds.has(p.id))
      this.personalIds = new Set(personal.map((p) => p.id))
      this.index.rebuild([...memories, ...personal], members, { votes, pins, usage })
      writeExport(this.paths.export, memories, members)
      // Collegamenti per ricordo (servono all'attivazione)
      const degrees = new Map<string, number>()
      for (const l of buildGraph(this.teamMemories(), [...this.semanticLinks(), ...this.explicitLinks()]).links) for (const k of [l.source, l.target]) degrees.set(k, (degrees.get(k) ?? 0) + 1)
      this.degrees = degrees
      this.scheduleEmbedding()
      this.changed('memories', 'members', 'status')
    })
    return this.materializing
  }

  /** true se la cartella di lavoro va a questo team (vedi MicelioNodeOptions.owns). */
  private ownsFolder (dir: string): boolean {
    return this.opts.owns ? this.opts.owns(dir) : true
  }

  /**
   * Lega il feed di questo nodo all'identità personale (B3), se non è già fatto: pubblica
   * `member.identity` con la firma. Serve anche ai team creati prima di B3, che al primo avvio
   * ricevono il legame. Errori solo nel log: il team funziona anche senza.
   */
  private async linkIdentity (): Promise<void> {
    const identity = this.opts.identity?.()
    const team = this.team
    if (!identity || !team?.writable || !team.localKey) return
    try {
      const me = (await team.members()).find((m) => m.key === team.localKey)
      if (!me || me.person === identity.publicKey) return
      await team.append({ type: 'member.identity', person: identity.publicKey, sig: signMembership(identity, team.localKey) })
      this.log('identità personale collegata al team')
    } catch (err) {
      this.log(`identità non collegata: ${(err as Error).message}`)
    }
  }

  private requireTeam (): TeamNode {
    if (!this.team) throw new UserError('Nodo non configurato: esegui prima `micelio init` o `micelio join`', 'Node not configured: run `micelio init` or `micelio join` first')
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
    if ((await this.status()).role !== 'admin') throw new UserError('Operazione riservata agli admin del team', 'Only team admins can do this')
  }

  private assertNotConfigured (): void {
    if (this.team || loadState(this.paths)) throw new UserError('Questo nodo appartiene già a un team', 'This node already belongs to a team')
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
    if (found.length === 0) throw new UserError(`Nessun membro attivo corrisponde a "${ref}"`, `No active member matches "${ref}"`)
    if (found.length > 1) throw new UserError(`"${ref}" è ambiguo: usa una parte più lunga della chiave`, `"${ref}" is ambiguous: use a longer part of the key`)
    return found[0]
  }
}

/** Crea l'embedder indicato in configurazione; null se "none". Il modello è condiviso da tutti i nodi della macchina. */
export function createEmbedder (config: Config): Embedder | null {
  switch (config.embeddings.adapter) {
    case 'local': return new LocalEmbedder(config.embeddings.model, path.join(os.homedir(), '.cache', 'micelio-models'))
    case 'hash': return new HashEmbedder()
    default: return null
  }
}

/** Crea l'adapter LLM indicato in configurazione; null se "none". */
export function createAdapter (config: Config): LlmAdapter | null {
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
