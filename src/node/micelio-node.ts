/**
 * @file Nodo Micelio: l'orchestratore di tutto ciò che vive su una macchina.
 *
 * EN: Micelio node: the orchestrator of everything that lives on one machine.
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
 * EN: It brings together:
 * - `TeamNode`        P2P network and team log (src/net);
 * - `MemoryIndex`     local search, derived from the view (src/store/memory-index);
 * - `PrivateStore`    private store: inbox, decisions, queue, budget (src/store/private-store);
 * - `IngestPipeline`  filter + classification + distillation (src/ingest);
 * - `DocumentWatcher` watched document folders (src/ingest/documents, Phase 4);
 * - `FileShare`       download of a document's original from colleagues (src/net/file-share);
 * - Markdown export   (src/export).
 *
 * Non dipende da NestJS né da HTTP: il daemon lo espone via API e MCP, i test lo usano
 * direttamente. Ogni operazione "utente" (CLI, API, MCP, UI) passa da qui.
 *
 * EN: It doesn't depend on NestJS or HTTP: the daemon exposes it through the API and MCP, tests use it
 * directly. Every "user" operation (CLI, API, MCP, UI) goes through here.
 *
 * Eventi: il nodo è un EventEmitter che emette `change` con un "argomento" (ChangeTopic) ogni
 * volta che una parte del suo stato cambia. Il daemon li inoltra alla UI (SSE /api/events),
 * che ricarica solo i dati interessati invece di interrogare il daemon a intervalli.
 *
 * EN: Events: the node is an EventEmitter that emits `change` with a "topic" (ChangeTopic) every
 * time part of its state changes. The daemon forwards them to the UI (SSE /api/events),
 * which reloads only the affected data instead of polling the daemon.
 *
 * Errori: le condizioni causate dall'utente (nodo non configurato, permessi, input non valido)
 * sono `UserError` e diventano HTTP 400 con un messaggio leggibile; il resto sono bug (500).
 *
 * EN: Errors: conditions caused by the user (node not configured, permissions, invalid input)
 * are `UserError` and become HTTP 400 with a readable message; everything else is a bug (500).
 */
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { LocalizedError } from '../core/errors'
import { MemoryInput, memoryId, type MemoryData, ROOT_CATEGORIES, type RootCategory } from '../core/events'
import type { GapRecord, InviteRecord, MemberRecord, NodeStatus, RecallHit, RootRecord } from '../core/model'
import type { NodePaths } from '../core/paths'
import type { TeamCheck } from '../core/team-check'
import { writeExport } from '../export/markdown'
import { buildGraph, type Graph, type GraphLink } from '../graph/constellation'
import { type Embedder, HashEmbedder, LocalEmbedder } from '../embed/embedder'
import { activation } from '../rank/activation'
import { hybridRank, nearest } from '../rank/hybrid'
import { currentEpoch, Dreamer, type DreamReport, dreamOrder } from '../dream/dreamer'
import type { MemoryRecord, RedactAck } from '../core/model'
import os from 'node:os'
import { BACKUP_EXT, type BackupContent, type BackupManifest, backupFileName, countsOf, decodeBackup, encodeBackup } from '../backup/archive'
import { planRestore } from '../backup/restore-plan'
import { actionsAfter, findDeliveries, judgeUse, parseLines } from '../insight/efficacy'
import { buildMindMap, CHAT_SEARCH_HITS, ChatAnswer, chatInput, type ChatMemory, chatSystem, expandWithNeighbors, lineOf, type MapLink, type MindMap } from '../insight/chat'
import type { ChatMessage, ChatSummary } from '../store/private-store'
import type { Consultation, Outcome, OutcomeVerdict } from '../store/private-store'
import type { Distilled } from '../ingest/prompts'
import { type ExplicitOutcome, filterMemory, IngestPipeline, InboxNotFoundError } from '../ingest/pipeline'
import { ClaudeCliAdapter } from '../llm/claude-cli'
import { FakeAdapter } from '../llm/fake'
import { LlmRunner } from '../llm/runner'
import type { LlmAdapter } from '../llm/types'
import { TeamNode } from '../net/team-node'
import { ROOTS_ADMIN_ONLY } from '../net/apply'
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
import { SemanticNeighbors } from '../rank/semantic-neighbors'
import { habituationFactor, habituationStreaks, softHabituation } from '../rank/habituation'
import { CO_USE_BRING_MAX, CO_USE_BRING_MIN, coUseLinks, coUseNeighbors, sessionPairs } from '../rank/co-use'
import { detectCommunities, galaxyLinks, OTHER_GALAXY } from '../graph/communities'
import { promptContext, sessionContext } from '../context/agent-context'
import { computeDigest, type Digest } from '../insight/digest'
import { gapId, gapKey } from '../insight/gaps'
import { AGENT_FILE_FORMATS, type AgentFileFormat, renderRootsBlock, writeAgentFile } from '../roots/agent-files'
import { type ImportItem, readImport } from '../roots/import'
import { repoInfo } from '../ingest/git-changes'
import { type Identity, signMembership, signRedactAck } from '../core/identity'
import { buildReceipt } from '../insight/redaction-receipt'
import { checkDecision, WRITE_CANDIDATES, WriteDecision, writeUpdateInput, writeUpdateSystem } from '../ingest/write-update'

export interface MicelioNodeOptions {
  /** Nodi bootstrap DHT (test o rete privata); assente = DHT pubblica. / EN: DHT bootstrap nodes (tests or private network); missing = public DHT. */
  bootstrap?: { host: string, port: number }[]
  log?: (msg: string) => void
  /** Ritardo con cui si accorpano gli aggiornamenti della vista prima di reindicizzare. / EN: Delay used to batch view updates before reindexing. */
  materializeDelayMs?: number
  /**
   * Adapter LLM da usare al posto di quello configurato (test). `null` = nessun LLM.
   * Se omesso si usa `llm.adapter` di config.json.
   *
   * EN: LLM adapter to use instead of the configured one (tests). `null` = no LLM.
   * If omitted, `llm.adapter` from config.json is used.
   */
  llm?: LlmAdapter | null
  /**
   * Embedder da usare al posto di quello configurato (test, o quello CONDIVISO fra i team di
   * MicelioHost). `null` = nessuna ricerca semantica. Se arriva da fuori, lo chiude chi l'ha creato.
   *
   * EN: Embedder to use instead of the configured one (tests, or the one SHARED across MicelioHost's
   * teams). `null` = no semantic search. If it comes from outside, whoever created it closes it.
   */
  embedder?: Embedder | null
  /**
   * Esecutore LLM CONDIVISO (B3): con più team le chiamate a Claude devono restare una alla volta
   * e il budget giornaliero è uno solo per macchina. Ha la precedenza su `llm`.
   *
   * EN: SHARED LLM runner (B3): with several teams, calls to Claude must still run one at a time
   * and there is a single daily budget per machine. Takes precedence over `llm`.
   */
  llmRunner?: LlmRunner | null
  /** Identità personale da legare a questo team (B3, src/core/identity.ts); assente = nessuna. / EN: Personal identity to bind to this team (B3, src/core/identity.ts); missing = none. */
  identity?: () => Identity | null
  /**
   * Con più team: true se una cartella di lavoro appartiene a QUESTO team. Una sessione in una
   * cartella abilitata in due team (es. `C:\work` nel team A e `C:\work\clienteX` nel team B)
   * va solo al team con la cartella più specifica. Assente = tutte le cartelle abilitate.
   *
   * EN: With several teams: true if a working folder belongs to THIS team. A session in a
   * folder enabled in two teams (e.g. `C:\work` in team A and `C:\work\clienteX` in team B)
   * goes only to the team with the most specific folder. Missing = all enabled folders.
   */
  owns?: (dir: string) => boolean
  /**
   * Con più team: controlla che una cartella si possa abilitare in QUESTO team, e lancia un
   * UserError se un altro team la usa già (vedi MicelioHost.claimFolder).
   *
   * EN: With several teams: checks that a folder can be enabled in THIS team, and throws a
   * UserError if another team already uses it (see MicelioHost.claimFolder).
   */
  claimFolder?: (dir: string, kind: 'sessions' | 'documents') => void
}

/** Errore causato dall'utente o dallo stato del nodo: messaggio pensato per essere mostrato. / EN: Error caused by the user or by the node's state: the message is meant to be shown. */
export class UserError extends LocalizedError {}

/** Risposta della chat (B10): testo, ricordi citati, numeri dei riferimenti, mappa mentale. / EN: Chat reply (B10): text, cited memories, reference numbers, mind map. */
export interface ChatReply {
  chatId: number
  messageId: number
  answer: string
  /** true = la memoria del team non basta a rispondere (proposta: segnalare la lacuna). / EN: true = the team memory is not enough to answer (suggestion: report the knowledge gap). */
  unknown: boolean
  cited: string[]
  /** Numero del riferimento [n] → ricordo. / EN: Reference number [n] → memory. */
  refs: { n: number, id: string, title: string }[]
  map: MindMap
}

/**
 * Una redazione con le conferme dei membri (B12, ricevuta di redazione).
 * Stato per membro: "confirmed" = il suo PC ha tolto il ricordo; "pending" = non ancora (spento o
 * versione precedente alla 0.6.0); "left" = uscito dal team senza confermare (non conta nel totale).
 *
 * EN: A redaction with the members' confirmations (B12, redaction receipt).
 * Status per member: "confirmed" = their PC removed the memory; "pending" = not yet (off or a version
 * older than 0.6.0); "left" = left the team without confirming (not counted in the total).
 */
export interface RedactionView {
  id: string
  reason: string
  /** Quando e da chi (null per le redazioni precedenti alla 0.6.0). / EN: When and by whom (null for redactions before 0.6.0). */
  at: number | null
  by: { key: string, name: string } | null
  confirmed: number
  total: number
  members: { key: string, name: string, status: 'confirmed' | 'pending' | 'left', ack: RedactAck | null }[]
}

/** Un ricordo nel resoconto di efficacia (B11). / EN: A memory in the efficacy report (B11). */
export interface EfficacyMemory { id: string, title: string, root: boolean, teamUseful: number }
/** Resoconto per la pagina «Efficacia» (B11, vedi MicelioNode.efficacyReport). / EN: Report for the "Efficacy" page (B11, see MicelioNode.efficacyReport). */
export interface EfficacyReport {
  days: number
  summary: {
    consultations: number
    withResults: number
    byChannel: Record<string, number>
    /** Ricordi forniti in sessioni già valutate. / EN: Memories delivered in sessions already evaluated. */
    delivered: number
    /** Utili: confermati dall'LLM o con tracce d'uso (euristica). / EN: Useful: confirmed by the LLM or with traces of use (heuristic). */
    useful: number
    confirmed: number
    wrong: number
    thumbsUp: number
    msMedian: number
    msP95: number
    slow: number
  }
  consultations: (Consultation & { memories: EfficacyMemory[] })[]
  outcomes: (Omit<Outcome, 'memory'> & { memory: EfficacyMemory })[]
  topUseful: (EfficacyMemory & { returned: number, useful: number, unused: number, wrong: number })[]
  /** `factor`: peso attuale nelle classifiche per l'abituazione (B12), 1 = pieno. / EN: `factor`: current weight in rankings due to habituation (B12), 1 = full. */
  noisy: (EfficacyMemory & { returned: number, useful: number, unused: number, wrong: number, factor: number })[]
  wrong: (EfficacyMemory & { reason: string | null, session: string, ts: number })[]
  unanswered: { query: string, count: number }[]
}

/**
 * Parti dello stato che possono cambiare, usate come "argomento" degli eventi `change`:
 * - status:    stato del nodo e del team (peer, ruolo, configurazione del team);
 * - memories:  ricordi del team;   members: membri;
 * - inbox, jobs, decisions: archivio privato (inbox, coda di ingestione, registro);
 * - settings:  impostazioni locali (cartelle abilitate, LLM).
 *
 * EN: Parts of the state that can change, used as the "topic" of `change` events:
 * - status:    node and team state (peers, role, team configuration);
 * - memories:  team memories;   members: members;
 * - inbox, jobs, decisions: private store (inbox, ingestion queue, log);
 * - settings:  local settings (enabled folders, LLM).
 */
export type ChangeTopic = 'status' | 'memories' | 'members' | 'inbox' | 'jobs' | 'decisions' | 'settings' | 'roots' | 'security' | 'gaps' | 'efficacy'

/** Una lacuna del team come la mostrano UI e CLI (B4). / EN: A team knowledge gap as the UI and CLI show it (B4). */
export interface GapView extends GapRecord {
  askerNames: string[]
  /** Un ricordo che forse la colma (ricerca per parole chiave), se la lacuna è aperta. / EN: A memory that may fill it (keyword search), if the knowledge gap is open. */
  answer: { id: string, title: string } | null
}

/** Impostazioni LOCALI modificabili dalla UI (config.json). / EN: LOCAL settings editable from the UI (config.json). */
export interface NodeSettings {
  llm: { adapter: string, command: string, classifyModel: string, distillModel: string, dailyBudget: number }
  watched: string[]
  /** Cartelle di documenti sorvegliate: originali scaricabili dai colleghi? cartella "di Radici"? / EN: Watched document folders: can colleagues download the originals? Is it a "Roots" folder? */
  documents: { path: string, shareable: boolean, roots: boolean }[]
  port: number
  /** Rete P2P: DHT pubblica o privata del team (vedi server/README.md). / EN: P2P network: public DHT or the team's private one (see server/README.md). */
  network: NetworkSettings
  /** Contesto automatico per gli agenti (B4). / EN: Automatic context for agents (B4). */
  context: { sessionStart: boolean, prompt: boolean, maxChars: number }
  /** Efficacia (B11): notifiche del desktop per gli esiti "utile" e "sbagliato". / EN: Efficacy (B11): desktop notifications for "useful" and "wrong" outcomes. */
  efficacy: { notify: boolean }
}

/** Impostazioni di rete come le mostra la UI. / EN: Network settings as the UI shows them. */
export interface NetworkSettings {
  /** DHT scelta nelle impostazioni del team ("local" = nessuna rete, B4). / EN: DHT chosen in the team settings ("local" = no network, B4). */
  mode: NetworkMode
  /** Nodi di avvio della DHT privata salvati ("host:porta"), anche se ora si usa la pubblica. / EN: Saved bootstrap nodes of the private DHT ("host:port"), even if the public one is in use now. */
  bootstrap: string[]
  /** Nodi di avvio IN USO adesso ([] = DHT pubblica). / EN: Bootstrap nodes IN USE now ([] = public DHT). */
  active: string[]
  /**
   * Se valorizzato, la rete è fissata dalla variabile d'ambiente MICELIO_DHT_BOOTSTRAP (demo,
   * container, test) e non si può cambiare dalla UI: contiene il suo valore.
   *
   * EN: When set, the network is fixed by the MICELIO_DHT_BOOTSTRAP environment variable (demo,
   * container, tests) and can't be changed from the UI: it holds that variable's value.
   */
  fixedByEnv: string | null
}

/**
 * Spazio occupato dal sapere (schermata "Stato del nodo").
 * - `disk`: byte su QUESTO disco, per componente;
 * - `members`: quanto del log del team viene da ciascun membro. Ogni nodo replica tutto, quindi
 *   la ripartizione è la stessa su ogni PC del team.
 *
 * EN: Space taken by the knowledge ("Node status" screen).
 * - `disk`: bytes on THIS disk, per component;
 * - `members`: how much of the team log comes from each member. Every node replicates everything, so
 *   the breakdown is the same on every PC of the team.
 */
export interface StorageReport {
  disk: {
    /** Log replicato del team (corestore): feed di tutti i membri, cifrati. / EN: Replicated team log (corestore): all members' feeds, encrypted. */
    log: number
    /** Indice di ricerca e vettori (view.db): derivato, ricostruibile. / EN: Search index and vectors (view.db): derived, can be rebuilt. */
    index: number
    /** Archivio privato (private.db): inbox, registro, coda. Mai replicato. / EN: Private store (private.db): inbox, log, queue. Never replicated. */
    private: number
    /** Documenti originali scaricati dai colleghi (cache, svuotata dopo 30 giorni). / EN: Original documents downloaded from colleagues (cache, emptied after 30 days). */
    cache: number
    /** Copia Markdown in sola lettura. / EN: Read-only Markdown copy. */
    export: number
    total: number
  }
  /** Somma dei feed dei membri (byte del log del team). / EN: Sum of the members' feeds (bytes of the team log). */
  teamLogBytes: number
  members: {
    key: string
    name: string
    removed: boolean
    /** Byte del feed del membro: tutti i suoi eventi (ricordi, voti, uso, sogni…). / EN: Bytes of the member's feed: all their events (memories, votes, usage, dreams…). */
    bytes: number
    /** Quota del log del team (0..1). / EN: Share of the team log (0..1). */
    share: number
    /** Ricordi attivi di cui è autore e loro dimensione in testo (titolo + corpo + tag). / EN: Active memories they authored and their text size (title + body + tags). */
    memories: number
    memoryBytes: number
  }[]
}

/** Regole di sicurezza come le mostra la schermata Sicurezza (Fase 9). / EN: Security rules as the Security screen shows them (Phase 9). */
export interface SecurityRules {
  /** Tipi di segreto e dato personale riconosciuti sempre (non modificabili). / EN: Secret and personal data types that are always detected (not editable). */
  builtin: { type: string, label: string }[]
  /** Pattern di file sensibili di default (non modificabili). / EN: Default sensitive file patterns (not editable). */
  defaultSensitiveFiles: string[]
  /** Regole del TEAM, modificabili dall'admin. / EN: TEAM rules, editable by the admin. */
  team: { secretPatterns: TeamSecretPattern[], allow: string[], sensitiveFiles: string[] }
}

/** Esito del banco di prova: cosa farebbe il filtro con un testo e/o un nome di file. / EN: Test bench outcome: what the filter would do with a text and/or a file name. */
export interface SecurityTestResult {
  /** Testo dopo la redazione. / EN: Text after redaction. */
  text: string
  redactions: Record<string, number>
  /** Parole chiave HR/personali trovate: il contenuto resterebbe privato. / EN: HR/personal keywords found: the content would stay private. */
  blockedBy: string[]
  /** Se è stato indicato un file: il pattern che lo rende sensibile, o null. / EN: If a file was given: the pattern that makes it sensitive, or null. */
  sensitiveFile: string | null
}

/** Un ricordo pubblicato che contiene segreti secondo le regole attuali (scansione retroattiva). / EN: A published memory that contains secrets under the current rules (retroactive scan). */
export interface SecurityFinding {
  id: string
  title: string
  author: string
  authorName: string | null
  /** Tipi trovati, con il conteggio. / EN: Types found, with their count. */
  kinds: Record<string, number>
  /** È una Radice: dopo la pulizia lo resta. / EN: It's a Root: it stays one after the cleanup. */
  root: boolean
}

/** Una Radice con il suo ricordo, come la mostrano UI, CLI e MCP. / EN: A Root with its memory, as the UI, CLI and MCP show it. */
export interface RootView extends RootRecord {
  memory: RecallHit
  /** Nome di chi l'ha promossa / confermata per ultimo (null se non più membro). / EN: Name of who last promoted / confirmed it (null if no longer a member). */
  byName: string | null
  reviewedByName: string | null
}

/** Resoconto di una revisione delle Radici, come lo mostrano UI e CLI. / EN: Report of a Roots review, as the UI and CLI show it. */
export interface RootReviewResult {
  /** Radici esaminate. / EN: Roots checked. */
  checked: number
  /** Radici segnalate "da rivedere" in questa revisione, con i motivi. / EN: Roots flagged "to review" in this review, with the reasons. */
  flagged: { id: string, title: string, reasons: string[] }[]
  /** Cosa non è stato possibile verificare da questo PC, e perché (codice, valori e testo italiano). / EN: What couldn't be checked from this PC, and why (code, values and Italian text). */
  notes: ReviewNote[]
}

/** Filtri per l'elenco delle Radici (tool MCP `architecture`, API, CLI). / EN: Filters for the Roots list (MCP tool `architecture`, API, CLI). */
export interface RootFilter {
  /** Progetto: confrontato con `source.code.project` e con i tag (maiuscole indifferenti). / EN: Project: compared with `source.code.project` and with the tags (case-insensitive). */
  project?: string
  category?: RootCategory
  /**
   * File su cui si sta lavorando: restituisce le Radici che citano quei file o le loro cartelle
   * (una Radice su "src/orders/" vale per "src/orders/order.service.ts").
   *
   * EN: Files being worked on: returns the Roots that mention those files or their folders
   * (a Root on "src/orders/" applies to "src/orders/order.service.ts").
   */
  files?: string[]
  /** Testo: ordina le Radici per pertinenza (stessa ricerca ibrida di recall). / EN: Text: sorts the Roots by relevance (same hybrid search as recall). */
  query?: string
}

/** Esito del download di un documento originale. / EN: Outcome of downloading an original document. */
export interface SourceFile {
  /** Percorso locale del file (copia in cache, o l'originale se il documento è di questo nodo). / EN: Local path of the file (cached copy, or the original if the document belongs to this node). */
  path: string
  name: string
  size: number
  /** true se il file era già in cache o è locale (nessun download). / EN: true if the file was already cached or is local (no download). */
  local: boolean
}

/** Ogni quanto si pubblica al team l'uso locale dei ricordi (usage.report, DESIGN §8.3). / EN: How often local memory usage is published to the team (usage.report, DESIGN §8.3). */
const USAGE_FLUSH_MS = 30 * 60 * 1000

/**
 * Soglia di similarità sotto la quale un risultato semantico non è considerato pertinente.
 * Dipende dal modello: i punteggi di e5 sono "compressi" fra 0,8 e 0,9 (spike C), quelli
 * dell'embedder finto sono più bassi e sparsi.
 *
 * EN: Similarity threshold below which a semantic result is not considered relevant.
 * It depends on the model: e5 scores are "squeezed" between 0.8 and 0.9 (spike C), the
 * fake embedder's are lower and more spread out.
 */
function semanticThreshold (model: string): number {
  return model.includes('e5') ? 0.83 : 0.3
}

/**
 * Soglia per il contesto automatico di ogni richiesta (B4): più alta di quella della ricerca. Una
 * richiesta in linguaggio libero «somiglia» un po' a molti ricordi, e inserirli tutti sarebbe solo
 * rumore nella conversazione: meglio nessun contesto che un contesto fuori tema.
 *
 * EN: Threshold for the automatic per-request context (B4): higher than the search one. A
 * free-text request "looks like" many memories a little, and injecting them all would just be
 * noise in the conversation: no context is better than off-topic context.
 */
function promptThreshold (model: string): number {
  return model.includes('e5') ? 0.86 : 0.45
}

/**
 * Soglia effettiva del contesto per richiesta: la soglia fissa del modello, ma anche "nettamente
 * sopra gli altri" (media + 2 deviazioni standard delle somiglianze della richiesta con TUTTI i
 * ricordi). Con e5 i punteggi sono compressi (0,80–0,90): una frase qualunque supera la soglia
 * fissa per molti ricordi, specie se si somigliano fra loro (es. note di un vault con la stessa
 * struttura). Ciò che conta è distaccarsi dal resto. Con pochi ricordi la statistica non dice
 * nulla: vale solo la soglia fissa.
 *
 * EN: Effective threshold for the per-request context: the model's fixed threshold, but also "clearly
 * above the others" (mean + 2 standard deviations of the request's similarities with ALL
 * memories). With e5 scores are squeezed (0.80–0.90): any sentence exceeds the fixed
 * threshold for many memories, especially if they resemble each other (e.g. vault notes with the same
 * structure). What matters is standing out from the rest. With few memories the statistics say
 * nothing: only the fixed threshold applies.
 */
export function relevanceCutoff (scores: number[], floor: number): number {
  if (scores.length < 8) return floor
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const std = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length)
  return Math.max(floor, mean + 2 * std)
}

/** Soglia "quasi duplicato" per il dreaming: più alta di quella di pertinenza. / EN: "Near duplicate" threshold for dreaming: higher than the relevance one. */
function duplicateThreshold (model: string): number {
  return model.includes('e5') ? 0.92 : 0.7
}

/** Ogni quanto il nodo controlla se è il suo turno di sognare. / EN: How often the node checks whether it's its turn to dream. */
const DREAM_CHECK_MS = 10 * 60 * 1000

/** Contesto automatico (B4): Radici e ricordi a inizio sessione, ricordi per richiesta, lunghezza minima della richiesta. / EN: Automatic context (B4): Roots and memories at session start, memories per request, minimum request length. */
const CONTEXT_ROOTS = 8
const CONTEXT_MEMORIES = 6
const CONTEXT_PER_PROMPT = 4
const CONTEXT_MIN_PROMPT = 15

/** Ritardo del ricalcolo del grado dei nodi dopo un aggiornamento (raggruppa le scritture vicine). / EN: Delay before recomputing node degrees after an update (groups nearby writes). */
const DEGREES_DELAY_MS = 2000

/** Oltre questa durata l'aggiornamento della vista finisce nel log con i tempi per fase. / EN: Beyond this duration the view update is logged with per-phase timings. */
const SLOW_MATERIALIZE_MS = 300
/** Sotto questi ricordi la costellazione vecchia si ricalcola subito alla richiesta (costa poche decine di ms). / EN: Below this many memories a stale constellation is recomputed right away on request (it costs a few tens of ms). */
const SYNC_GRAPH_MAX = 1000

/**
 * Cronometro per fasi: `lap('nome')` chiude la fase corrente; `report(soglia)` restituisce
 * "vista 120 ms · indice 80 ms · …" se il totale supera la soglia, altrimenti null.
 *
 * EN: Phase stopwatch: `lap('nome')` closes the current phase; `report(soglia)` returns
 * "vista 120 ms · indice 80 ms · …" if the total exceeds the threshold, otherwise null.
 */
function phaseTimer (): ((name: string) => void) & { report: (thresholdMs: number) => string | null } {
  const t0 = Date.now()
  let last = t0
  const phases: string[] = []
  const lap = ((name: string) => { const now = Date.now(); phases.push(`${name} ${now - last} ms`); last = now }) as ((name: string) => void) & { report: (t: number) => string | null }
  lap.report = (threshold) => (Date.now() - t0 >= threshold ? `${phases.join(' · ')} (totale ${Date.now() - t0} ms)` : null)
  return lap
}

/** Progetto di una cartella: il repository git che la contiene, altrimenti il nome della cartella. / EN: Project of a folder: the git repository that contains it, otherwise the folder name. */
function projectOf (dir: string): string {
  return repoInfo(dir)?.project ?? path.basename(dir)
}

/** Ricordi e codice (B4): primo controllo dopo l'avvio, poi ogni 6 ore. / EN: Memories and code (B4): first check after startup, then every 6 hours. */
const STALE_FIRST_CHECK_MS = 60 * 1000

/** Prima scansione delle sessioni: subito dopo l'avvio, non dentro. / EN: First session scan: right after startup, not inside it. */
const FIRST_SCAN_DELAY_MS = 5 * 1000
const STALE_CHECK_MS = 6 * 60 * 60 * 1000
/** Ogni quanto si controlla se è ora del backup automatico (B7): uno al giorno. / EN: How often we check whether the automatic backup is due (B7): one per day. */
const AUTO_BACKUP_CHECK_MS = 60 * 60 * 1000
const AUTO_BACKUP_EVERY_MS = 24 * 60 * 60 * 1000
/** Eventi per scrittura durante un ripristino: blocchi grandi, ma il daemon risponde fra l'uno e l'altro. / EN: Events per write during a restore: large blocks, but the daemon stays responsive between them. */
const RESTORE_BATCH = 500
/**
 * Oltre questi ricordi nuovi in un solo giro di embedding (ripristino di un backup, import, primo
 * avvio con un team già pieno) i vicini per significato si ricalcolano tutti insieme invece che uno
 * per uno: l'aggiornamento singolo costa un confronto con TUTTI gli altri, quindi N nuovi su N
 * totali è N² (5 000 ricordi: 13 s), il ricalcolo completo N²/2 ed è a blocchi, in sottofondo.
 *
 * EN: Above this many new memories in a single embedding round (backup restore, import, first
 * start with an already full team) the semantic neighbors are recomputed all together instead of one
 * by one: a single update costs a comparison with ALL the others, so N new out of N
 * total is N² (5,000 memories: 13 s), while the full recompute is N²/2, in blocks, in the background.
 */
const BULK_NEIGHBORS = 200
/** Efficacia (B11): consultazioni ed esiti si conservano 90 giorni. / EN: Efficacy (B11): queries and outcomes are kept for 90 days. */
const EFFICACY_KEEP_MS = 90 * 24 * 60 * 60 * 1000
/** Una risposta a un agente oltre questo tempo è "lenta" nelle statistiche (l'hook ha 10 s in tutto). / EN: An answer to an agent beyond this time counts as "slow" in the stats (the hook has 10 s in total). */
const SLOW_CONSULTATION_MS = 1000

/** Dopo quanti giorni le copie scaricate escono dalla cache (decisione D11). / EN: After how many days downloaded copies leave the cache (decision D11). */
const SOURCE_CACHE_DAYS = 30

/**
 * Il riferimento di un ricordo «da documento» è l'hash SHA-256 del file (64 cifre esadecimali).
 * Lo scrive un collega: prima di usarlo in un percorso va controllato (vedi fetchSource).
 *
 * EN: The reference of a "from document" memory is the file's SHA-256 hash (64 hex digits).
 * A colleague writes it: it must be checked before using it in a path (see fetchSource).
 */
export function isDocumentRef (ref: string): boolean {
  return /^[0-9a-f]{64}$/.test(ref)
}

/** Stato dell'ingestione, per `micelio ingest status` e la futura Dashboard. / EN: Ingestion status, for `micelio ingest status` and the future Dashboard. */
export interface IngestStatus {
  llm: { adapter: string, available: boolean, budget: { used: number, limit: number } } | null
  jobs: Record<string, number>
  inbox: number
  watched: string[]
}

export class MicelioNode extends EventEmitter {
  private team: TeamNode | null = null
  /** Radici del team (Fase 8), dalla vista: id del ricordo → record. / EN: Team Roots (Phase 8), from the view: memory id → record. */
  private rootsById = new Map<string, RootRecord>()
  private nodeName: string | null = null
  /** Vicini per significato di ogni ricordo, aggiornati in modo incrementale (src/rank/semantic-neighbors.ts). / EN: Semantic neighbors of each memory, updated incrementally (src/rank/semantic-neighbors.ts). */
  private semantic = new SemanticNeighbors(2)
  /** Ricordi con un vettore nuovo arrivati durante un ricalcolo completo dei vicini. / EN: Memories with a new vector that arrived during a full neighbor recompute. */
  private semanticPending: string[] = []
  /** Un ricalcolo completo dei vicini è stato chiesto mentre ne era già in corso uno. / EN: A full neighbor recompute was requested while one was already running. */
  private semanticRedo = false
  /** Ricordi il cui codice citato è cambiato (B4, src/rank/code-staleness.ts), da private.db. / EN: Memories whose cited code changed (B4, src/rank/code-staleness.ts), from private.db. */
  private staleness = new Map<string, { commits: number, missing: number, checked: number }>()
  /**
   * Abituazione (B12, src/rank/habituation.ts): per ricordo, esiti senza uso di fila dall'ultimo
   * utile, dagli esiti di questo PC. Ricalcolata solo quando arrivano esiti nuovi.
   *
   * EN: Habituation (B12, src/rank/habituation.ts): per memory, outcomes with no use in a row since
   * the last useful one, from this PC's outcomes. Recomputed only when new outcomes arrive.
   */
  private habituation = new Map<string, number>()
  /** Sinapsi d'uso del team (B12, src/rank/co-use.ts): per coppia "idA:idB", sessioni insieme. / EN: The team's use synapses (B12, src/rank/co-use.ts): per pair "idA:idB", sessions together. */
  private coUsePairs = new Map<string, { count: number, last: number }>()
  /** Vicini d'uso per ricordo, dal più forte, ricalcolati con la costellazione. / EN: Use neighbors per memory, strongest first, recomputed with the constellation. */
  private coUseNear = new Map<string, { id: string, weight: number }[]>()
  /** Fatica del capitolo d'origine per ricordo (B12), solo per chi ce l'ha. / EN: Effort of the source chapter per memory (B12), only for those that have it. */
  private effortById = new Map<string, number>()
  /** Redazioni per cui la conferma è già stata inviata (evita doppi invii prima che la vista la mostri). / EN: Redactions whose confirmation was already sent (avoids double sends before the view shows it). */
  private acking = new Set<string>()
  private staleTimer: NodeJS.Timeout | null = null
  /** Timer del backup automatico (B7). / EN: Automatic backup timer (B7). */
  private backupTimer: NodeJS.Timeout | null = null
  /** Esito dell'ultimo backup automatico, per Impostazioni. / EN: Outcome of the last automatic backup, for Settings. */
  private lastAutoBackup: { at: number, file?: string, error?: string } | null = null
  /**
   * true durante il ripristino di un backup: gli aggiornamenti della vista non si materializzano a
   * ogni blocco (con migliaia di ricordi sarebbero secondi ciascuno), ma una volta sola alla fine.
   *
   * EN: true while restoring a backup: view updates are not materialized at
   * every block (with thousands of memories each would take seconds), but just once at the end.
   */
  private bulkWriting = false
  private bulkPending = false
  /** Contesto automatico (B4): ricordi già mostrati in ogni sessione, per non ripeterli. / EN: Automatic context (B4): memories already shown in each session, so we don't repeat them. */
  private injected = new Map<string, Set<string>>()
  /** Id dei ricordi PERSONALI presenti nell'indice (B4): restano su questo PC. / EN: Ids of the PERSONAL memories in the index (B4): they stay on this PC. */
  private personalIds = new Set<string>()
  /** Volte in cui ogni ricordo è stato utile a un agente, nel team (B11, da useful.report). / EN: How many times each memory was useful to an agent, across the team (B11, from useful.report). */
  private usefulCounts = new Map<string, number>()
  /** Collegamenti per la chat (B10), validi per la costellazione indicata. / EN: Links for the chat (B10), valid for the given constellation. */
  private chatLinksCache: { graph: Graph, links: MapLink[] } | null = null
  /** Nome del team letto all'ultima materializzazione (vedi teamName). / EN: Team name read at the last materialization (see teamName). */
  private teamNameCache: string | null = null
  private readonly index: MemoryIndex
  private readonly privateStore: PrivateStore
  private readonly pipeline: IngestPipeline
  private readonly documents: DocumentWatcher
  private readonly files: FileShare
  private readonly llm: LlmRunner | null
  /** Calcolo degli embedding (null = solo ricerca per parole chiave). / EN: Embedding computation (null = keyword search only). */
  private readonly embedder: Embedder | null
  /** Collegamenti per ricordo nell'ultima costellazione calcolata (per l'attivazione). / EN: Links per memory in the last computed constellation (for activation). */
  private degrees = new Map<string, number>()
  /** Catena dei calcoli di embedding: mai due in parallelo. / EN: Chain of embedding computations: never two in parallel. */
  private embedding: Promise<void> = Promise.resolve()
  private usageTimer: NodeJS.Timeout | null = null
  private dreamTimer: NodeJS.Timeout | null = null
  private scanTimer: NodeJS.Timeout | null = null
  private readonly scanner: SessionScanner
  private readonly dreamer: Dreamer
  /** Ricordi non attivi (archiviati o sostituiti), per la schermata Archivio. / EN: Inactive memories (archived or superseded), for the Archive screen. */
  private inactive: MemoryRecord[] = []
  /** Collegamenti espliciti creati dal dreaming (per la costellazione). / EN: Explicit links created by dreaming (for the constellation). */
  private dreamLinks: { from: string, to: string, rel: string }[] = []
  private config: Config
  /** Timer di accorpamento degli aggiornamenti della vista (vedi scheduleMaterialize). / EN: Timer that batches view updates (see scheduleMaterialize). */
  private timer: NodeJS.Timeout | null = null
  /** Versione della vista all'ultimo aggiornamento dell'indice: se non cambia non si ricalcola nulla. / EN: View version at the last index update: if it doesn't change, nothing is recomputed. */
  private materializedVersion = -1
  /** Timer del ricalcolo in sottofondo di costellazione e grado dei nodi (vedi scheduleGraph). / EN: Timer for the background recompute of the constellation and node degrees (see scheduleGraph). */
  private degreesTimer: NodeJS.Timeout | null = null
  /** Costellazione con le galassie, pronta per graph() (null = da ricalcolare). / EN: Constellation with galaxies, ready for graph() (null = must be recomputed). */
  private graphCache: Graph | null = null
  /** true se ci sono aggiornamenti della vista non ancora nella costellazione in cache. / EN: true if there are view updates not yet in the cached constellation. */
  private graphStale = false
  /** Catena delle materializzazioni: mai due ricostruzioni dell'indice in parallelo. / EN: Chain of materializations: never two index rebuilds in parallel. */
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
      // EN: Runner shared by MicelioHost: a single queue and a single budget for all teams.
      this.llm = opts.llmRunner
    } else {
      // Scelta dell'adapter: override dei test > configurazione.
      // EN: Adapter choice: test override > configuration.
      const adapter = opts.llm !== undefined ? opts.llm : createAdapter(this.config)
      // Budget e modelli si leggono da this.config a ogni uso: la UI può cambiarli senza riavvio.
      // EN: Budget and models are read from this.config on every use: the UI can change them without a restart.
      this.llm = adapter ? new LlmRunner(adapter, this.privateStore, { dailyBudget: () => this.config.llm.dailyBudget, log: this.log }) : null
    }

    this.pipeline = new IngestPipeline({
      store: this.privateStore,
      llm: this.llm,
      models: () => ({ classify: this.config.llm.classifyModel, distill: this.config.llm.distillModel }),
      publish: (m) => this.publish(m),
      // Regole e lingua si leggono dalla vista a ogni uso: un admin può cambiarle in qualunque momento.
      // EN: Rules and language are read from the view on every use: an admin can change them at any time.
      // Regole del filtro: default + quelle del team (parole chiave, pattern di segreti, eccezioni)
      // EN: Filter rules: defaults + the team's (keywords, secret patterns, exceptions)
      rules: async () => mergeRules(await this.team?.config('filter.blockKeywords'), await this.team?.config('security.secretPatterns'), await this.team?.config('security.allow')),
      sensitiveFiles: async () => mergeSensitiveFiles(await this.team?.config('security.sensitiveFiles')).filter((p) => !DEFAULT_SENSITIVE_FILES.includes(p)),
      blockedPaths: async () => mergeBlockedPaths(await this.team?.config('filter.blockedPaths')),
      language: async () => (await this.team?.config<string>('memory.language')) ?? 'it',
      maxMemories: async () => maxMemoriesOf(await this.team?.config('distill.maxMemories')),
      gitChanges: () => this.config.watch.gitChanges,
      log: this.log,
      notify: (topic) => this.changed(topic),
      // B11: efficacia dei ricordi forniti agli agenti
      // EN: B11: efficacy of the memories delivered to agents
      efficacy: {
        evaluate: (transcriptPath, fromLine, sessionId, cwd) => this.evaluateSession(transcriptPath, fromLine, sessionId, cwd),
        verdicts: (sessionId, cwd, verdicts) => this.applyVerdicts(sessionId, cwd, verdicts)
      },
      // Radici (Fase 8): suggerimenti del distillatore e cartelle di documenti "di Radici"
      // EN: Roots (Phase 8): distiller suggestions and "Roots" document folders
      suggestRoot: (id, category, title) => {
        if (this.rootsById.has(id)) return
        this.privateStore.addRootSuggestion(id, category, title)
        this.changed('roots')
      },
      // Con «Radici solo per gli admin» un membro non promuove: la Radice diventa un suggerimento
      // EN: With "Roots for admins only" a member doesn't promote: the Root becomes a suggestion
      promoteRoot: async (id, category) => {
        if (await this.canManageRoots()) await this.team?.append({ type: 'root.set', id, category })
        else if (!this.rootsById.has(id)) { this.privateStore.addRootSuggestion(id, category, this.index.get(id)?.title ?? id); this.changed('roots') }
      },
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
  // EN: Lifecycle

  /** Avvia il nodo: se il team è già configurato si ricollega alla rete. Avvia il worker di ingestione. / EN: Starts the node: if the team is already configured it reconnects to the network. Starts the ingestion worker. */
  async start (): Promise<void> {
    this.pipeline.start()
    this.sweepSourceCache()
    // Pubblicazione periodica dell'uso locale dei ricordi (Fase 5).
    // EN: Periodic publishing of local memory usage (Phase 5).
    this.usageTimer = setInterval(() => { this.flushUsage().catch(() => {}); this.flushUseful().catch(() => {}); this.flushCoUse().catch(() => {}) }, USAGE_FLUSH_MS)
    // B11: conservazione di consultazioni ed esiti (all'avvio basta: il daemon si riavvia spesso)
    // EN: B11: retention of queries and outcomes (at startup is enough: the daemon restarts often)
    try { this.privateStore.pruneEfficacy(Date.now() - EFFICACY_KEEP_MS) } catch { /* archivio non ancora pronto / EN: private store not ready yet */ }
    this.usageTimer.unref()
    // Raccolta delle sessioni in corso e recupero di quelle finite mentre il daemon era spento.
    // EN: Collect running sessions and recover those that ended while the daemon was off.
    const scanEvery = this.config.watch.sessionScan.intervalMinutes * 60_000
    this.scanTimer = setInterval(() => { void this.scanSessions() }, scanEvery)
    this.scanTimer.unref()
    // Controllo periodico del turno di sogno (Fase 6).
    // EN: Periodic check of the dream turn (Phase 6).
    this.dreamTimer = setInterval(() => { this.checkDreamTurn().catch((e) => this.log(`dreaming: ${e.message}`)) }, DREAM_CHECK_MS)
    this.dreamTimer.unref()
    // B4: ricordi che invecchiano con il codice. Primo controllo poco dopo l'avvio (non lo rallenta),
    // poi a intervalli: i repository cambiano con il lavoro di tutti i giorni.
    // EN: B4: memories that age with the code. First check shortly after startup (it doesn't slow it down),
    //     then at intervals: repositories change with everyday work.
    this.staleness = this.privateStore.staleness()
    this.refreshHabituation()
    const firstCheck = setTimeout(() => { this.checkStaleness() }, STALE_FIRST_CHECK_MS)
    firstCheck.unref()
    this.staleTimer = setInterval(() => { this.checkStaleness() }, STALE_CHECK_MS)
    this.staleTimer.unref()
    // B7: backup automatico giornaliero (se attivato). Primo controllo poco dopo l'avvio.
    // EN: B7: daily automatic backup (if enabled). First check shortly after startup.
    const firstBackup = setTimeout(() => { this.autoBackup().catch(() => {}) }, STALE_FIRST_CHECK_MS)
    firstBackup.unref()
    this.backupTimer = setInterval(() => { this.autoBackup().catch(() => {}) }, AUTO_BACKUP_CHECK_MS)
    this.backupTimer.unref()
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
    // Poco DOPO l'avvio, non durante: la scansione legge trascrizioni anche di centinaia di MB e
    // l'app aspetta che il daemon risponda (bug del 2026-10-21: avvio a 55 s, oltre i 30 s dell'app).
    // EN: Recovery: sessions worked on while the daemon was off (or new parts of long sessions).
    //     Shortly AFTER startup, not during it: the scan reads transcripts of even hundreds of MB and
    //     the app waits for the daemon to respond (bug of 2026-10-21: startup at 55 s, past the app's 30 s).
    const firstScan = setTimeout(() => { void this.scanSessions() }, FIRST_SCAN_DELAY_MS)
    firstScan.unref()
  }

  /** Ferma tutto in ordine: worker, indicizzazione in corso, rete, database. / EN: Stops everything in order: worker, running indexing, network, databases. */
  async stop (): Promise<void> {
    if (this.usageTimer) clearInterval(this.usageTimer)
    if (this.dreamTimer) clearInterval(this.dreamTimer)
    if (this.scanTimer) clearInterval(this.scanTimer)
    if (this.staleTimer) clearInterval(this.staleTimer)
    if (this.backupTimer) clearInterval(this.backupTimer)
    while (this.dreamer.busy) await new Promise((r) => setTimeout(r, 200))
    await this.flushUsage().catch(() => {})
    await this.flushUseful().catch(() => {})
    await this.flushCoUse().catch(() => {})
    await this.embedding.catch(() => {})
    // Si chiude solo l'embedder creato qui: quello passato da fuori è condiviso con altri team.
    // EN: Only close the embedder created here: one passed from outside is shared with other teams.
    if (this.opts.embedder === undefined) await this.embedder?.close()
    await this.documents.stop()
    await this.pipeline.stop()
    if (this.timer) clearTimeout(this.timer)
    if (this.degreesTimer) clearTimeout(this.degreesTimer)
    await this.materializing.catch(() => {})
    await this.team?.close()
    this.team = null
    this.index.close()
    this.privateStore.close()
  }

  // ═══════════════════════════════════ Team ════════════════════════════════════
  // EN: Team

  /** Nome del team, dall'ultima lettura della vista (null prima della prima sincronizzazione). / EN: Team name, from the last view read (null before the first sync). */
  get teamName (): string | null {
    return this.teamNameCache
  }

  /**
   * Rilegge la configurazione dal disco. Con più team (B3) la parte della macchina (modelli LLM,
   * budget) è condivisa: quando un team la cambia, MicelioHost fa rileggere gli altri.
   *
   * EN: Reloads the configuration from disk. With several teams (B3) the machine part (LLM models,
   * budget) is shared: when one team changes it, MicelioHost makes the others reload it.
   */
  reloadConfig (): void {
    this.config = loadConfig(this.paths)
  }

  /** true se il nodo appartiene a un team (state.json presente). / EN: true if the node belongs to a team (state.json present). */
  get configured (): boolean {
    return this.team !== null || loadState(this.paths) !== null
  }

  /** Crea un nuovo team con questo nodo come fondatore. / EN: Creates a new team with this node as founder. */
  async init (teamName: string, nodeName: string): Promise<NodeStatus> {
    this.assertNotConfigured()
    const team = this.newTeamNode()
    try {
      const secrets = await team.create(teamName, nodeName)
      saveState(this.paths, { nodeName, ...secrets })
    } catch (err) {
      await team.close() // non lasciare swarm e file aperti se qualcosa va storto / EN: don't leave the swarm and files open if something goes wrong
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

  /** Entra in un team esistente con un codice d'invito. / EN: Joins an existing team with an invite code. */
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

  /** Crea un invito (qualunque membro). Vedi TeamNode.createInvite per `replicated`. / EN: Creates an invite (any member). See TeamNode.createInvite for `replicated`. */
  async invite (): Promise<{ code: string, expires: number, replicated: boolean }> {
    const team = this.requireTeam()
    // Solo locale: nessuno potrebbe raggiungere questo nodo per usare l'invito
    // EN: Local only: nobody could reach this node to use the invite
    if (this.localOnly) throw new UserError('Il team è in modalità solo locale: per invitare qualcuno scegli prima una rete (Impostazioni → Rete)', 'The team is in local-only mode: to invite someone, choose a network first (Settings → Network)')
    return team.createInvite()
  }

  /** Inviti non ancora usati. / EN: Invites not used yet. */
  async invites (): Promise<InviteRecord[]> {
    return this.requireTeam().invites()
  }

  /** Tutti i membri, compresi gli espulsi. / EN: All members, removed ones included. */
  async members (): Promise<MemberRecord[]> {
    return this.requireTeam().members()
  }

  /** Espelle un membro (solo admin). Un nodo non può espellere se stesso. / EN: Removes a member (admin only). A node cannot remove itself. */
  async removeMember (ref: string): Promise<MemberRecord> {
    await this.requireAdmin()
    const target = await this.resolveMember(ref)
    if (target.key === this.team?.localKey) throw new UserError('Un nodo non può espellere se stesso', 'A node cannot remove itself')
    await this.requireTeam().append({ type: 'member.remove', key: target.key })
    await this.sync()
    return target
  }

  /** Promuove un membro ad admin e indexer (solo admin). / EN: Promotes a member to admin and indexer (admin only). */
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
   *
   * EN: Sets a shared team configuration value (admin only).
   * Known keys: `memory.language` (e.g. "it", "en"), `filter.blockKeywords` (array of strings).
   */
  async setTeamConfig (key: string, value: unknown): Promise<void> {
    // Validazione delle chiavi note: un valore sbagliato vale per tutto il team
    // EN: Validate known keys: a wrong value applies to the whole team
    if (key === ROOTS_ADMIN_ONLY && typeof value !== 'boolean') {
      throw new UserError(`${ROOTS_ADMIN_ONLY}: true oppure false`, `${ROOTS_ADMIN_ONLY}: true or false`)
    }
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

  /** Configurazione condivisa del team (lingua, parole chiave del filtro), per la UI. / EN: Shared team configuration (language, filter keywords), for the UI. */
  async teamConfig (): Promise<{ language: string, blockKeywords: string[], maxMemories: number, updateOnWrite: boolean, rootsAdminOnly: boolean }> {
    const team = this.requireTeam()
    const kw = await team.config<unknown>('filter.blockKeywords')
    return {
      language: (await team.config<string>('memory.language')) ?? 'it',
      blockKeywords: Array.isArray(kw) ? kw.filter((k): k is string => typeof k === 'string') : [],
      maxMemories: maxMemoriesOf(await team.config('distill.maxMemories')),
      // B4: aggiornare invece di aggiungere (attivo salvo scelta contraria dell'admin)
      // EN: B4: update instead of add (on unless the admin decides otherwise)
      updateOnWrite: (await team.config('memory.updateOnWrite')) !== false,
      // 0.6.2: solo gli admin creano e tolgono Radici (acceso nei team nuovi)
      // EN: 0.6.2: only admins create and remove Roots (on in new teams)
      rootsAdminOnly: (await team.config(ROOTS_ADMIN_ONLY)) === true
    }
  }

  /**
   * Qualità della distillazione (Fase 10): per fascia di posizione nel distillato, quanti ricordi
   * risultano utili, inutili, rimossi o mai usati, la saturazione del limite e un'indicazione per
   * l'admin. Calcolata sulla vista replicata: la stessa su ogni PC.
   *
   * EN: Distillation quality (Phase 10): per position band in the distilled output, how many memories
   * turn out useful, useless, removed or never used, the saturation of the limit and a hint for
   * the admin. Computed on the replicated view: the same on every PC.
   */
  async distillQuality (now = Date.now()): Promise<DistillQuality> {
    const team = this.requireTeam()
    const signals = this.index.signals()
    const active = this.teamMemories().map((m) => ({ ts: m.ts, status: 'active' as const, source: m.source, votes: signals.get(m.id)?.votes ?? 0, uses: signals.get(m.id)?.uses ?? 0 }))
    const inactive = this.inactive.map((m) => ({ ts: m.ts, status: (m.status ?? 'archived') as 'superseded' | 'archived' | 'redacted', source: m.source, votes: 0, uses: 0 }))
    return distillQuality([...active, ...inactive], maxMemoriesOf(await team.config('distill.maxMemories')), now)
  }

  // ═════════════════════════════════ Ricordi ═══════════════════════════════════
  // EN: Memories

  /**
   * Salvataggio ESPLICITO (CLI, API, MCP). Passa da filtro e classificazione (decisione D6):
   * l'esito può essere "team", "inbox" o "private".
   *
   * EN: EXPLICIT save (CLI, API, MCP). It goes through the filter and classification (decision D6):
   * the outcome can be "team", "inbox" or "private".
   */
  async remember (input: MemoryInput, hold?: TeamCheck): Promise<ExplicitOutcome> {
    this.requireTeam()
    const parsed = MemoryInput.safeParse(input)
    if (!parsed.success) throw new UserError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    return this.pipeline.ingestExplicit(parsed.data, hold)
  }

  /** Ricerca full-text nella memoria del team (indice locale). / EN: Full-text search in the team memory (local index). */
  recall (query: string, limit = 5): RecallHit[] {
    return this.index.search(query, limit)
  }

  /** Costellazione del sapere: ricordi come nodi, correlazioni come collegamenti (src/graph). / EN: Knowledge constellation: memories as nodes, correlations as links (src/graph). */
  /**
   * Costellazione del team con le galassie. Con migliaia di ricordi calcolarla costa (secondi),
   * quindi si tiene pronta: la ricalcola in sottofondo `scheduleGraph` dopo ogni aggiornamento.
   * Se viene chiesta prima, si calcola qui.
   *
   * EN: Team constellation with galaxies. With thousands of memories computing it is costly (seconds),
   * so it's kept ready: `scheduleGraph` recomputes it in the background after every update.
   * If it's requested before that, it's computed here.
   */
  graph (): Graph {
    // Vecchia (scritture dopo l'ultimo calcolo): nei team piccoli costa poco e si ricalcola subito;
    // nei grandi si restituisce quella di pochi secondi fa, mentre la nuova arriva in sottofondo
    // EN: Stale (writes after the last computation): in small teams it's cheap and recomputed right away;
    //     in large ones we return the one from a few seconds ago, while the new one arrives in the background
    const stale = this.graphStale && (this.graphCache?.nodes.length ?? 0) < SYNC_GRAPH_MAX
    if (!this.graphCache || stale) this.computeGraph()
    return this.graphCache!
  }

  /** Calcola costellazione, galassie e grado dei nodi; li tiene pronti per graph() e l'attivazione. / EN: Computes the constellation, galaxies and node degrees; keeps them ready for graph() and activation. */
  private computeGraph (): void {
    const lap = phaseTimer()
    const memories = this.teamMemories()
    // B12: sinapsi d'uso, solo fra ricordi del team ancora attivi
    // EN: B12: use synapses, only between team memories still active
    const use = coUseLinks(this.coUsePairs, new Set(memories.map((m) => m.id)))
    this.coUseNear = coUseNeighbors(use)
    const extra = [...this.semanticLinks(), ...this.explicitLinks(), ...use]
    lap('vicini')
    const g = buildGraph(memories, extra)
    lap('costellazione')
    // Grado dei nodi PRIMA dell'attivazione, che lo usa
    // EN: Node degrees BEFORE activation, which uses them
    const degrees = new Map<string, number>()
    for (const l of g.links) for (const k of [l.source, l.target]) degrees.set(k, (degrees.get(k) ?? 0) + 1)
    this.degrees = degrees
    const signals = this.index.signals()
    const nodes = g.nodes.map((n) => {
      const r = this.rootsById.get(n.id)
      return { ...n, activation: this.activationOf(n.id, signals, { kind: n.kind as MemoryRecord['kind'], ts: n.ts }), ...(r ? { root: { category: r.category, status: r.status } } : {}) }
    })
    // Galassie per la vista d'insieme dei team grandi (src/graph/communities.ts): lineari nei collegamenti
    // EN: Galaxies for the overview of large teams (src/graph/communities.ts): linear in the number of links
    lap('attivazione')
    const c = detectCommunities(nodes, g.links)
    lap('galassie')
    const slow = lap.report(SLOW_MATERIALIZE_MS)
    if (slow) this.log(`costellazione (${nodes.length} ricordi): ${slow}`)
    this.graphStale = false
    this.graphCache = {
      nodes: nodes.map((n) => ({ ...n, galaxy: c.of.get(n.id) ?? OTHER_GALAXY })),
      links: g.links,
      galaxies: c.galaxies,
      galaxyLinks: galaxyLinks(g.links, c.of)
    }
  }

  /** Un ricordo completo con i segnali di priorità (attivazione, voti, usi, pin). / EN: A full memory with its priority signals (activation, votes, uses, pins). */
  detail (id: string): RecallHit | null {
    const rec = this.index.get(id)
    return rec ? this.enrich([rec])[0] : null
  }

  // ═══════════════════════════ Priorità (Fase 5) ═══════════════════════════
  // EN: Priority (Phase 5)

  /**
   * Ricerca IBRIDA (DESIGN §8.1): parole chiave + significato + attivazione. È quella usata da
   * API, MCP e UI. Conta anche l'uso dei ricordi restituiti (segnale per l'attivazione).
   *
   * EN: HYBRID search (DESIGN §8.1): keywords + meaning + activation. It's the one used by the
   * API, MCP and UI. It also counts usage of the returned memories (a signal for activation).
   * @param track false per non contare l'uso (es. ricerche interne)
   *        EN: false to not count usage (e.g. internal searches)
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
        // EN: Model not available (e.g. first download failed): fall back to keywords.
        this.log(`ricerca semantica non disponibile: ${(err as Error).message}`)
      }
    }
    const signals = this.index.signals()
    const act = (id: string) => this.activationOf(id, signals)
    // B12: abituazione attenuata (ricerca esplicita), poi si riordina
    // EN: B12: softened habituation (explicit search), then re-sort
    const ranked = hybridRank(keyword, semantic, act)
      .map((r) => ({ ...r, score: r.score * softHabituation(this.habitFactor(r.id, signals)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    // B12: i primi risultati si portano dietro i vicini d'uso più forti (servono di solito insieme),
    // al massimo CO_USE_BRING_MAX, subito dopo il ricordo che li porta. Punteggio: quello del
    // ricordo che li porta per la forza del legame.
    // EN: B12: the top results bring along their strongest use neighbors (usually needed together),
    //     at most CO_USE_BRING_MAX, right after the memory that brings them. Score: the bringing
    //     memory's score times the link strength.
    const present = new Set(ranked.map((r) => r.id))
    const brought = new Map<string, { score: number, by: string }>()
    for (const r of ranked.slice(0, 3)) {
      for (const n of this.coUseNear.get(r.id) ?? []) {
        if (brought.size >= CO_USE_BRING_MAX || n.weight < CO_USE_BRING_MIN) break
        if (present.has(n.id) || brought.has(n.id)) continue
        brought.set(n.id, { score: r.score * n.weight, by: r.id })
      }
    }
    const order: { id: string, score: number, by?: string }[] = []
    for (const r of ranked) {
      order.push(r)
      for (const [id, b] of brought) if (b.by === r.id) order.push({ id, score: b.score, by: r.id })
    }
    const hits = this.enrich(this.index.getMany(order.map((r) => r.id)), signals)
    // getMany salta gli id non più presenti: si riallinea per id, non per posizione
    // EN: getMany skips ids no longer present: realign by id, not by position
    const meta = new Map(order.map((r) => [r.id, r]))
    for (const h of hits) {
      const m = meta.get(h.id)!
      h.score = m.score
      if (m.by) h.broughtBy = m.by
    }
    // L'uso dei ricordi personali non si conta: verrebbe pubblicato al team (usage.report)
    // EN: Usage of personal memories isn't counted: it would be published to the team (usage.report)
    const used = hits.filter((h) => !this.personalIds.has(h.id)).map((h) => h.id)
    if (track && used.length) this.privateStore.countUsage(used)
    // B4: una ricerca esplicita senza risultati è una lacuna di conoscenza (solo su questo PC)
    // EN: B4: an explicit search with no results is a knowledge gap (only on this PC)
    if (track && hits.length === 0) await this.recordMiss(query)
    return hits
  }

  // ═══════════════════════════ Dreaming (Fase 6) ═══════════════════════════
  // EN: Dreaming (Phase 6)

  /**
   * Controlla se oggi tocca a questo nodo sognare (DESIGN §10.1): turnazione deterministica fra
   * i membri attivi; il primo può iniziare dall'ora configurata, ogni turno successivo dopo
   * `slotMinutes` se nessuno ha ancora rivendicato l'epoca.
   *
   * EN: Checks whether it's this node's turn to dream today (DESIGN §10.1): deterministic rotation among
   * active members; the first can start from the configured hour, each next turn after
   * `slotMinutes` if nobody has claimed the epoch yet.
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

  /** Sogno manuale (`micelio dream now`, pulsante nell'app): epoca dedicata, nessuna attesa. / EN: Manual dream (`micelio dream now`, button in the app): dedicated epoch, no waiting. */
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

  /** Diario dei sogni del team, dal più recente. / EN: The team's dream journal, newest first. */
  async dreams (): Promise<{ epoch: string, by: string, ts: number, summary: string, stats: Record<string, number> }[]> {
    return this.requireTeam().dreamLogs()
  }

  /** Ricordi archiviati o sostituiti (storico), dal più recente. / EN: Archived or superseded memories (history), newest first. */
  archived (): MemoryRecord[] {
    return [...this.inactive].sort((a, b) => b.ts - a.ts)
  }

  /**
   * Redazione (solo admin): toglie dalla vista di tutti il contenuto di un ricordo pubblicato per
   * errore (es. un dato sensibile sfuggito al filtro). Limite intrinseco: chi l'aveva già letto
   * o esportato ne conserva una copia, e i blocchi cifrati restano nei log replicati.
   *
   * EN: Redaction (admin only): removes from everyone's view the content of a memory published by
   * mistake (e.g. sensitive data that slipped past the filter). Inherent limit: whoever already read
   * or exported it keeps a copy, and the encrypted blocks stay in the replicated logs.
   */
  async redact (id: string, reason: string): Promise<void> {
    await this.requireAdmin()
    const rec = this.requireMemory(id)
    await this.requireTeam().append({ type: 'memory.redact', id: rec.id, reason: reason || 'rimosso da un admin' })
    await this.sync()
  }

  // ═══════════════════════════ Ricevuta di redazione (B12) ═══════════════════════════
  // EN: Redaction receipt (B12)

  /**
   * Per ogni ricordo redatto non ancora confermato da questo nodo: toglie le copie locali rimaste
   * fuori da indice ed export (risposte della chat, proposte in Inbox, copie personali), conta i
   * backup automatici precedenti e pubblica `redact.ack`, firmato dall'identità personale se c'è.
   * Chiamata a ogni materializzazione: vale anche per le redazioni arrivate mentre il PC era spento
   * o prima dell'aggiornamento alla 0.6.0.
   *
   * EN: For each redacted memory not yet confirmed by this node: removes the local copies left
   * outside the index and export (chat answers, Inbox proposals, personal copies), counts the earlier
   * automatic backups and publishes `redact.ack`, signed by the personal identity if there is one.
   * Called on every materialization: it also covers redactions that arrived while the PC was off or
   * before the update to 0.6.0.
   */
  private confirmRedactions (inactive: MemoryRecord[], acks: Map<string, Map<string, RedactAck>>): void {
    const team = this.team
    if (!team?.writable || !team.localKey) return
    for (const m of inactive) {
      if (m.status !== 'redacted' || acks.get(m.id)?.has(team.localKey) || this.acking.has(m.id)) continue
      this.acking.add(m.id)
      try {
        const cleaned = this.cleanRedacted(m.id)
        const backups = this.backupsBefore(m.redactedAt ?? Date.now())
        const ts = Date.now()
        const identity = this.opts.identity?.()
        const sig = identity ? { person: identity.publicKey, sig: signRedactAck(identity, m.id, team.localKey, ts) } : {}
        team.append({ type: 'redact.ack', id: m.id, cleaned, backups, ...sig }, ts)
          .then(() => this.log(`redazione confermata per ${m.id.slice(0, 8)} (chat ${cleaned.chat}, inbox ${cleaned.inbox}, personali ${cleaned.personal}, backup precedenti ${backups})`))
          .catch((err) => { this.acking.delete(m.id); this.log(`conferma di redazione non inviata: ${(err as Error).message}`) })
      } catch (err) {
        this.acking.delete(m.id)
        this.log(`redazione non ripulita su questo PC: ${(err as Error).message}`)
      }
    }
  }

  /** Copie locali di un ricordo redatto fuori da indice ed export. / EN: Local copies of a redacted memory outside the index and export. */
  private cleanRedacted (id: string): RedactAck['cleaned'] {
    const chat = this.privateStore.redactChats(id)
    let inbox = 0
    for (const item of this.privateStore.listInbox()) {
      if (memoryId(item.memory) !== id) continue
      this.privateStore.removeInbox(item.id)
      this.privateStore.logDecision(item.source, 'rejected', 'redatto da un admin del team', '[contenuto rimosso]')
      inbox++
    }
    const personal = this.privateStore.personal().some((p) => p.id === id) ? 1 : 0
    if (personal) this.privateStore.removePersonal(id)
    if (chat || inbox) this.changed('inbox')
    return { chat, inbox, personal }
  }

  /**
   * Backup automatici di questo team fatti prima della redazione, ancora nella cartella dei backup:
   * possono contenere il ricordo. Non si toccano (cancellarli o riscriverli è troppo rischioso), ma
   * si dichiarano nella ricevuta. I backup fatti a mano altrove non si possono conoscere.
   *
   * EN: Automatic backups of this team made before the redaction, still in the backup folder: they
   * may contain the memory. They are not touched (deleting or rewriting them is too risky), but
   * they're declared in the receipt. Backups made by hand elsewhere can't be known.
   */
  private backupsBefore (at: number): number {
    const folder = this.config.backup.folder
    if (!folder || !this.teamNameCache || !fs.existsSync(folder)) return 0
    const prefix = backupFileName(this.teamNameCache).replace(/-\d{4}-\d{2}-\d{2}-\d{4}\.micelio-backup$/, '-')
    try {
      return fs.readdirSync(folder).filter((f) => f.startsWith(prefix) && f.endsWith(BACKUP_EXT) && fs.statSync(path.join(folder, f)).mtimeMs < at).length
    } catch {
      return 0
    }
  }

  /** Redazioni del team con le conferme dei membri, dalla più recente. / EN: The team's redactions with the members' confirmations, newest first. */
  async redactions (): Promise<RedactionView[]> {
    const team = this.requireTeam()
    const [all, members, acks] = await Promise.all([team.memories(), team.members(), team.redactAcks()])
    const names = new Map(members.map((m) => [m.key, m.name]))
    return all.filter((m) => m.status === 'redacted').map((m) => {
      const mine = acks.get(m.id) ?? new Map<string, RedactAck>()
      const rows = members.map((mem) => {
        const ack = mine.get(mem.key) ?? null
        const status = ack ? 'confirmed' as const : mem.removed ? 'left' as const : 'pending' as const
        return { key: mem.key, name: mem.name, status, ack }
      })
      // Chi è uscito senza confermare resta in elenco ma non conta: non può più confermare
      // EN: Whoever left without confirming stays listed but doesn't count: they can't confirm anymore
      const counted = rows.filter((r) => r.status !== 'left')
      return {
        id: m.id,
        reason: m.statusReason ?? '',
        at: m.redactedAt ?? null,
        by: m.redactedBy ? { key: m.redactedBy, name: names.get(m.redactedBy) ?? m.redactedBy.slice(0, 8) } : null,
        confirmed: counted.filter((r) => r.status === 'confirmed').length,
        total: counted.length,
        members: rows
      }
    }).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  }

  /** Ricevuta di una redazione (testo leggibile e JSON verificabile, src/insight/redaction-receipt.ts). / EN: Receipt of a redaction (readable text and verifiable JSON, src/insight/redaction-receipt.ts). */
  async redactionReceipt (id: string, lang: 'it' | 'en' = 'it'): Promise<{ name: string, text: string, json: unknown }> {
    const r = (await this.redactions()).find((x) => x.id === id || x.id.startsWith(id.toLowerCase()))
    if (!r) throw new UserError(`Nessuna redazione per il ricordo ${id}`, `No redaction for memory ${id}`)
    const team = this.requireTeam()
    const me = (await team.members()).find((m) => m.key === team.localKey)
    return buildReceipt({ redaction: r, team: this.teamNameCache ?? '', by: { name: me?.name ?? '', key: team.localKey ?? '' }, lang })
  }

  // ═══════════════════════════ Backup e ripristino (B7) ═══════════════════════════
  // EN: Backup and restore (B7)

  /**
   * Il sapere del team, pronto per il backup: ricordi attivi e storico (non i redatti), Radici,
   * collegamenti, voti, ricordi fissati, uso, lacune, configurazione condivisa. Letto dalla vista,
   * non dall'indice locale: comprende anche ciò che l'indice non tiene. Mai i ricordi personali.
   *
   * EN: The team's knowledge, ready for backup: active memories and history (not redacted ones), Roots,
   * links, votes, pinned memories, usage, knowledge gaps, shared configuration. Read from the view,
   * not from the local index: it also includes what the index doesn't keep. Never personal memories.
   */
  private async backupSnapshot (): Promise<{ content: BackupContent, manifest: BackupManifest }> {
    const team = this.requireTeam()
    await this.sync()
    const [all, members, roots, links, votes, pins, usage, gaps, config, info] = await Promise.all([
      team.memories(), team.members(), team.roots(), team.links(), team.votes(), team.pins(), team.usage(), team.gaps(), team.configs(), team.team()
    ])
    const names = new Map(members.map((m) => [m.key, m.name]))
    const kept = all.filter((m) => m.status !== 'redacted')
    const ids = new Set(kept.map((m) => m.id))
    const content: BackupContent = {
      memories: kept.map((m) => ({ ...m, authorName: names.get(m.author) ?? null })),
      roots: [...roots.values()].filter((r) => ids.has(r.id)),
      links: links.filter((l) => ids.has(l.from) && ids.has(l.to)),
      votes: Object.fromEntries([...votes].filter(([id, v]) => v !== 0 && ids.has(id))),
      pins: [...pins].filter((id) => ids.has(id)),
      usage: Object.fromEntries([...usage].filter(([id]) => ids.has(id))),
      gaps,
      config
    }
    const manifest: BackupManifest = { team: info?.name ?? this.teamNameCache ?? 'team', createdAt: Date.now(), createdBy: this.nodeName ?? '', counts: countsOf(content) }
    return { content, manifest }
  }

  /**
   * Crea il file di backup del team, cifrato con la password. Qualunque membro (decisione
   * dell'utente): vede già tutto il sapere del team.
   *
   * EN: Creates the team backup file, encrypted with the password. Any member can do it (user's
   * decision): they already see all of the team's knowledge.
   * @returns il file, il nome suggerito e il manifesto (cosa contiene)
   *          EN: the file, the suggested name and the manifest (what it contains)
   */
  async createBackup (password: string): Promise<{ file: Buffer, name: string, manifest: BackupManifest }> {
    const t0 = Date.now()
    const { content, manifest } = await this.backupSnapshot()
    const file = encodeBackup(content, manifest, password)
    this.log(`backup creato: ${manifest.counts.memories} ricordi, ${(file.length / 1024).toFixed(0)} kB in ${Date.now() - t0} ms`)
    return { file, name: backupFileName(manifest.team), manifest }
  }

  /**
   * Ripristina un backup in QUESTO team.
   * - In un team esistente solo un admin (decisione dell'utente): scrive per tutti.
   * - `fresh`: team appena creato per il ripristino (MicelioHost.restoreAsNewTeam), di cui chi
   *   ripristina è fondatore; si riprende anche la configurazione condivisa del backup.
   * Gli eventi si scrivono a blocchi (RESTORE_BATCH) e la vista si materializza UNA volta alla fine.
   *
   * EN: Restores a backup into THIS team.
   * - In an existing team only an admin can (user's decision): it writes for everyone.
   * - `fresh`: team just created for the restore (MicelioHost.restoreAsNewTeam), whose founder is
   *   the person restoring; the backup's shared configuration is restored too.
   * Events are written in blocks (RESTORE_BATCH) and the view is materialized ONCE at the end.
   * @returns quanti ricordi erano nel backup, quanti sono stati aggiunti e quanti c'erano già
   *          EN: how many memories were in the backup, how many were added and how many were already there
   */
  async restoreBackup (file: Buffer, password: string, { fresh = false }: { fresh?: boolean } = {}): Promise<{ team: string, memories: number, added: number, existing: number, events: number, ms: number }> {
    const team = this.requireTeam()
    if (!fresh) await this.requireAdmin()
    const t0 = Date.now()
    const lap = phaseTimer()
    const { manifest, content } = decodeBackup(file, password)
    lap('decifratura')
    const before = new Set((await team.memories()).map((m) => m.id))
    const events = planRestore(content, { includeConfig: fresh, sourceTeam: manifest.team })
    this.bulkWriting = true
    try {
      for (let i = 0; i < events.length; i += RESTORE_BATCH) {
        await team.appendMany(events.slice(i, i + RESTORE_BATCH))
        // Fra un blocco e l'altro il daemon risponde alle altre richieste
        // EN: Between blocks the daemon answers other requests
        await new Promise((r) => setImmediate(r))
      }
    } finally {
      this.bulkWriting = false
    }
    lap('scrittura')
    this.bulkPending = false
    await this.sync()
    lap('sincronizzazione')
    await this.materialize(true)
    lap('indice')
    const inBackup = content.memories.filter((m) => m.status !== 'redacted')
    const existing = inBackup.filter((m) => before.has(m.id)).length
    const report = { team: manifest.team, memories: inBackup.length, added: inBackup.length - existing, existing, events: events.length, ms: Date.now() - t0 }
    this.log(`backup di «${report.team}» ripristinato: ${report.added} ricordi aggiunti, ${report.existing} già presenti, ${report.events} eventi (${lap.report(0)})`)
    return report
  }

  /** Impostazioni dei backup automatici (senza la password) ed esito dell'ultimo. / EN: Automatic backup settings (without the password) and the outcome of the last one. */
  backupSettings (): { enabled: boolean, folder: string, keep: number, hasPassword: boolean, last: { at: number, file?: string, error?: string } | null } {
    const b = this.config.backup
    return { enabled: b.enabled, folder: b.folder, keep: b.keep, hasPassword: b.password.length > 0, last: this.lastAutoBackup }
  }

  /**
   * Cambia le impostazioni dei backup automatici. `password` vuota o assente = resta quella salvata.
   *
   * EN: Changes the automatic backup settings. Empty or missing `password` = keep the saved one.
   * @throws UserError se si attivano senza cartella o senza password
   *         EN: if enabled without a folder or without a password
   */
  async setBackupSettings (s: { enabled?: boolean, folder?: string, keep?: number, password?: string }): Promise<void> {
    const next = { ...this.config.backup, ...Object.fromEntries(Object.entries(s).filter(([k, v]) => v !== undefined && !(k === 'password' && v === ''))) }
    if (next.enabled && !next.folder.trim()) throw new UserError('Scegli la cartella dei backup', 'Choose the backup folder')
    if (next.enabled && next.password.length < 8) throw new UserError('Imposta una password di almeno 8 caratteri per i backup', 'Set a backup password of at least 8 characters')
    if (next.enabled) fs.mkdirSync(next.folder, { recursive: true })
    this.config = updateConfig(this.paths, (c) => { c.backup = next })
    this.changed('settings')
    // Appena attivati: il primo backup subito, senza aspettare il controllo orario
    // EN: Just enabled: run the first backup now, without waiting for the hourly check
    if (next.enabled) this.autoBackup().catch(() => {})
  }

  /**
   * Backup automatico: se attivato e l'ultimo backup di questo team nella cartella ha più di un
   * giorno (o non c'è), ne crea uno e tiene solo gli ultimi `keep`. Errori nel log e in Impostazioni.
   *
   * EN: Automatic backup: if enabled and this team's latest backup in the folder is more than a
   * day old (or missing), it creates one and keeps only the last `keep`. Errors go to the log and Settings.
   */
  private async autoBackup (): Promise<void> {
    const b = this.config.backup
    if (!b.enabled || !b.folder || !b.password || !this.team || !this.teamNameCache) return
    try {
      const prefix = backupFileName(this.teamNameCache).replace(/-\d{4}-\d{2}-\d{2}-\d{4}\.micelio-backup$/, '-')
      const mine = () => fs.readdirSync(b.folder).filter((f) => f.startsWith(prefix) && f.endsWith(BACKUP_EXT)).sort()
      const files = fs.existsSync(b.folder) ? mine() : []
      const newest = files.length ? fs.statSync(path.join(b.folder, files[files.length - 1])).mtimeMs : 0
      if (Date.now() - newest < AUTO_BACKUP_EVERY_MS) return
      fs.mkdirSync(b.folder, { recursive: true })
      const { file, name } = await this.createBackup(b.password)
      fs.writeFileSync(path.join(b.folder, name), file)
      // Si tengono gli ultimi `keep` (il nome contiene la data: in ordine alfabetico = cronologico)
      // EN: Keep the last `keep` (the name contains the date: alphabetical order = chronological)
      const all = mine()
      for (const old of all.slice(0, Math.max(0, all.length - b.keep))) fs.rmSync(path.join(b.folder, old), { force: true })
      this.lastAutoBackup = { at: Date.now(), file: name }
    } catch (err) {
      this.lastAutoBackup = { at: Date.now(), error: (err as Error).message }
      this.log(`backup automatico non riuscito: ${(err as Error).message}`)
    }
    this.changed('settings')
  }

  // ═══════════════════════════ Chat sulla memoria (B10) ═══════════════════════════
  // EN: Chat over the memory (B10)

  /**
   * Collegamenti della costellazione per la chat, con il tipo del dreaming dove c'è (approfondisce,
   * dipende da, contraddice). La costellazione è già in cache (graph()): nessun ricalcolo.
   *
   * EN: Constellation links for the chat, with the dreaming type where present (deepens,
   * depends on, contradicts). The constellation is already cached (graph()): no recompute.
   */
  private chatLinks (): MapLink[] {
    // Ricalcolati solo quando la costellazione cambia: con 5 000 ricordi sono decine di migliaia
    // EN: Recomputed only when the constellation changes: with 5,000 memories there are tens of thousands
    const g = this.graph()
    if (this.chatLinksCache?.graph === g) return this.chatLinksCache.links
    const rel = new Map(this.dreamLinks.map((l) => [`${l.from}|${l.to}`, l.rel]))
    const links = g.links.map((l) => {
      const r = rel.get(`${l.source}|${l.target}`) ?? rel.get(`${l.target}|${l.source}`)
      return { source: l.source, target: l.target, kind: l.kind, weight: l.weight, ...(l.kind === 'dream' && r ? { rel: r } : {}) }
    })
    this.chatLinksCache = { graph: g, links }
    return links
  }

  /**
   * Ricordi per una domanda e la loro mappa mentale, SENZA LLM (subito): ricerca ibrida, Radici
   * pertinenti, poi i vicini nella costellazione.
   *
   * EN: Memories for a question and their mind map, WITHOUT the LLM (immediate): hybrid search, relevant
   * Roots, then the neighbors in the constellation.
   */
  async chatContext (question: string): Promise<{ map: MindMap, memories: ChatMemory[] }> {
    this.requireTeam()
    const q = question.trim()
    // track = false: è la chat, non una ricerca d'uso; finisce comunque fra le consultazioni (askChat)
    // EN: track = false: it's the chat, not a usage search; it still ends up among the queries (askChat)
    const hits = await this.recallHybrid(q, CHAT_SEARCH_HITS, false)
    const roots = await this.relatedRoots(q, hits.map((h) => h.id))
    const found = [...hits, ...roots]
    const links = this.chatLinks()
    const ids = expandWithNeighbors(found.map((h) => h.id), links)
    const score = new Map(found.map((h, i) => [h.id, found.length - i]))
    const byId = new Map(this.enrich(this.index.getMany(ids)).map((h) => [h.id, h]))
    const memories: ChatMemory[] = ids.flatMap((id) => {
      const h = byId.get(id)
      return h ? [{ id, title: h.title, body: h.body, kind: h.kind, tags: h.tags, score: score.get(id) ?? 0, activation: h.activation ?? 0, authorName: h.authorName, ...(h.root ? { root: { category: h.root.category } } : {}) }] : []
    })
    return { map: buildMindMap(q, memories, links, new Set(found.map((h) => h.id))), memories }
  }

  /**
   * Domanda alla chat: mappa (come chatContext) e risposta dell'LLM scritta SOLO sui ricordi
   * trovati, con i riferimenti. Domanda e risposta finiscono nella cronologia (solo su questo PC).
   * Senza ricordi pertinenti non si chiama l'LLM: la risposta è "non lo so" (budget risparmiato).
   *
   * EN: A question to the chat: the map (as in chatContext) and an LLM answer written ONLY from the memories
   * found, with references. Question and answer go into the history (only on this PC).
   * Without relevant memories the LLM isn't called: the answer is "I don't know" (budget saved).
   * @param chatId conversazione esistente; assente = nuova
   *        EN: existing conversation; missing = new one
   */
  async askChat (question: string, chatId?: number): Promise<ChatReply> {
    const t0 = Date.now()
    const q = question.trim()
    if (q.length < 3) throw new UserError('Scrivi una domanda', 'Write a question')
    const { map, memories } = await this.chatContext(q)
    const id = chatId ?? this.privateStore.createChat(q)
    // Conversazione precedente: coppie domanda → risposta, per le domande che ne seguono un'altra
    // EN: Previous conversation: question → answer pairs, for questions that follow another one
    const prev = this.privateStore.chatMessages(id)
    const history: { question: string, answer: string }[] = []
    for (let i = 0; i + 1 < prev.length; i++) if (prev[i].role === 'user' && prev[i + 1].role === 'assistant') history.push({ question: prev[i].text, answer: prev[i + 1].text })
    this.privateStore.addChatMessage(id, 'user', q)

    let answer: ChatAnswer
    let numbers = new Map<number, string>()
    if (!memories.length) {
      answer = { answer: 'La memoria del team non ha ricordi su questo argomento.', cited: [], themes: [], unknown: true }
    } else if (!this.llm) {
      answer = { answer: 'Nessun LLM configurato (Impostazioni → LLM): ecco i ricordi più pertinenti nella mappa.', cited: [], themes: [], unknown: false }
    } else {
      const language = (await this.team?.config<string>('memory.language')) ?? 'it'
      const built = chatInput(q, memories, map, history)
      numbers = built.numbers
      answer = await this.llm.run({ name: 'chat', system: chatSystem(language), input: built.input, schema: ChatAnswer, model: this.config.llm.distillModel })
    }
    // Nomi leggibili dei temi dati dall'LLM (se mancano restano i tag caratteristici)
    // EN: Readable theme names given by the LLM (if missing, the characteristic tags stay)
    const titles = new Map(answer.themes.map((t) => [t.id, t.title.trim()]))
    for (const t of map.themes) if (titles.get(t.id)) t.label = titles.get(t.id)!
    const cited = [...new Set(answer.cited)].flatMap((n) => (numbers.has(n) ? [numbers.get(n)!] : []))
    const refs = [...numbers].map(([n, mid]) => ({ n, id: mid, title: memories.find((m) => m.id === mid)?.title ?? '' }))
    const messageId = this.privateStore.addChatMessage(id, 'assistant', answer.answer, { cited, refs, map, unknown: answer.unknown })
    this.consulted('chat', q, memories.filter((m) => map.memories.find((x) => x.id === m.id)?.found).map((m) => m.id), Date.now() - t0)
    return { chatId: id, messageId, answer: answer.answer, unknown: answer.unknown, cited, refs, map }
  }

  /** I vicini di un ricordo nella costellazione, per "espandi" nella mappa (senza LLM). / EN: A memory's neighbors in the constellation, for "expand" in the map (no LLM). */
  chatExpand (id: string, max = 8): { memories: MindMap['memories'], links: MapLink[] } {
    const rec = this.index.get(id)
    if (!rec) throw new UserError(`Nessun ricordo con id ${id}`, `No memory with id ${id}`)
    const links = this.chatLinks().filter((l) => l.source === rec.id || l.target === rec.id).sort((a, b) => b.weight - a.weight).slice(0, max)
    const ids = links.map((l) => (l.source === rec.id ? l.target : l.source))
    const memories = this.index.getMany(ids).map((h) => ({ id: h.id, title: h.title, line: lineOf(h.body), kind: h.kind, root: this.rootsById.has(h.id), found: false }))
    return { memories, links }
  }

  /**
   * "Salva come ricordo": la risposta diventa un ricordo del team, con le fonti. Passa dalla stessa
   * strada di un salvataggio esplicito (filtro privacy, eventuale Inbox).
   *
   * EN: "Save as memory": the answer becomes a team memory, with its sources. It goes the same
   * way as an explicit save (privacy filter, possibly the Inbox).
   */
  async saveChatAnswer (messageId: number): Promise<ExplicitOutcome> {
    const msg = this.privateStore.chatMessage(messageId)
    if (!msg || msg.role !== 'assistant') throw new UserError('Risposta non trovata', 'Answer not found')
    const msgs = this.privateStore.chatMessages(msg.chat)
    const question = [...msgs].reverse().find((m) => m.role === 'user' && m.id < msg.id)?.text ?? 'Risposta della chat'
    const sources = this.index.getMany(msg.data?.cited ?? [])
    const tags = [...new Set(sources.flatMap((s) => s.tags))].slice(0, 5)
    // Il testo cita i ricordi con [n]: in fondo l'elenco, perché nel ricordo il numero da solo non dice nulla
    // EN: The text cites memories as [n]: the list goes at the end, because in the memory the number alone means nothing
    const refs: { n: number, id: string, title: string }[] = msg.data?.refs ?? []
    const used = refs.filter((r) => (msg.data?.cited ?? []).includes(r.id))
    const body = `${msg.text}${used.length ? `\n\nFonti:\n${used.map((r) => `- [${r.n}] ${r.title} (id:${r.id.slice(0, 12)})`).join('\n')}` : ''}`
    const title = question.length > 200 ? question.slice(0, 197) + '…' : question.length < 3 ? `Domanda: ${question}` : question
    const out = await this.remember({ kind: 'reference', title, body: body.slice(0, 20_000), tags, source: { type: 'chat' } })
    this.privateStore.setChatMessageData(messageId, { ...msg.data, saved: out.outcome === 'team' ? { outcome: 'team', id: out.id } : { outcome: out.outcome } })
    return out
  }

  /** Conversazioni della chat (solo su questo PC). / EN: Chat conversations (only on this PC). */
  chats (): ChatSummary[] { return this.privateStore.chats() }
  chatMessages (chatId: number): ChatMessage[] { return this.privateStore.chatMessages(chatId) }
  renameChat (chatId: number, title: string): void { this.privateStore.renameChat(chatId, title.trim() || 'Conversazione') }
  deleteChat (chatId: number): void { this.privateStore.deleteChat(chatId) }

  /** Metriche sintetiche del nodo (per monitoraggio esterno o diagnostica). / EN: Summary node metrics (for external monitoring or diagnostics). */
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

  /** Ripristina un ricordo archiviato o sostituito. / EN: Restores an archived or superseded memory. */
  async restore (id: string): Promise<void> {
    const m = this.inactive.find((x) => (x.id === id || x.id.startsWith(id.toLowerCase())) && x.status !== 'redacted')
    if (!m) throw new UserError(`Nessun ricordo archiviato con id ${id}`, `No archived memory with id ${id}`)
    await this.requireTeam().append({ type: 'memory.restore', id: m.id })
    await this.sync()
  }

  /** Voto di utilità su un ricordo: +1, -1, 0 per ritirarlo. Un voto per nodo. / EN: Usefulness vote on a memory: +1, -1, 0 to withdraw it. One vote per node. */
  async vote (id: string, delta: -1 | 0 | 1): Promise<void> {
    const rec = this.requireMemory(id)
    await this.requireTeam().append({ type: 'memory.vote', id: rec.id, delta })
    await this.sync()
  }

  /** Fissa (o sblocca) un ricordo importante: non decade e il dreaming non lo archivia. / EN: Pins (or unpins) an important memory: it doesn't decay and dreaming doesn't archive it. */
  async pin (id: string, pinned: boolean): Promise<void> {
    const rec = this.requireMemory(id)
    await this.requireTeam().append({ type: pinned ? 'memory.pin' : 'memory.unpin', id: rec.id })
    await this.sync()
  }

  // ═══════════════════════════ Radici (Fase 8) ═══════════════════════════
  // EN: Roots (Phase 8)

  /**
   * Promuove un ricordo a Radice (o ne cambia la categoria). Qualunque membro può farlo.
   *
   * EN: Promotes a memory to Root (or changes its category). Any member can do it.
   * @param category vedi ROOT_CATEGORIES in events.ts
   *        EN: see ROOT_CATEGORIES in events.ts
   */
  async rootSet (id: string, category: RootCategory): Promise<RootView> {
    if (!ROOT_CATEGORIES.includes(category)) throw new UserError(`Categoria sconosciuta: ${category} (${ROOT_CATEGORIES.join(', ')})`, `Unknown category: ${category} (${ROOT_CATEGORIES.join(', ')})`)
    const rec = this.requireMemory(id)
    await this.requireRootsRight()
    await this.requireTeam().append({ type: 'root.set', id: rec.id, category })
    this.privateStore.removeRootSuggestion(rec.id)
    this.changed('roots')
    await this.sync()
    return this.requireRoot(rec.id)
  }

  /**
   * Radici suggerite dal distillatore su QUESTO nodo (archivio privato), ancora da decidere.
   * Si escludono i ricordi spariti (archiviati, sostituiti) o già diventati Radici.
   *
   * EN: Roots suggested by the distiller on THIS node (private store), still to be decided.
   * Memories that are gone (archived, superseded) or already Roots are excluded.
   */
  rootSuggestions (): { id: string, category: RootCategory, title: string, created: number }[] {
    return this.privateStore.rootSuggestions()
      .filter((s) => this.index.get(s.id) && !this.rootsById.has(s.id))
      .map((s) => ({ ...s, category: s.category as RootCategory }))
  }

  /** Ignora un suggerimento di Radice (resta un ricordo normale). / EN: Ignores a Root suggestion (it stays a normal memory). */
  dismissRootSuggestion (id: string): void {
    this.privateStore.removeRootSuggestion(id)
    this.changed('roots')
  }

  /** Il ricordo smette di essere una Radice. / EN: The memory stops being a Root. */
  async rootUnset (id: string): Promise<void> {
    const r = this.requireRoot(id)
    await this.requireRootsRight()
    await this.requireTeam().append({ type: 'root.unset', id: r.id })
    await this.sync()
  }

  /** Radice rivista e confermata: si azzerano le segnalazioni, la data di revisione riparte. / EN: Root reviewed and confirmed: flags are cleared, the review date restarts. */
  async rootConfirm (id: string): Promise<RootView> {
    const r = this.requireRoot(id)
    await this.requireTeam().append({ type: 'root.confirm', id: r.id })
    await this.sync()
    return this.requireRoot(r.id)
  }

  /**
   * Elenco delle Radici, filtrato e ordinato (vedi RootFilter). Senza `query`: per categoria,
   * poi quelle da rivedere prima, poi per titolo.
   *
   * EN: List of Roots, filtered and sorted (see RootFilter). Without `query`: by category,
   * then those to review first, then by title.
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
   *
   * EN: Roots relevant to a search, EXCLUDING those already among the results: it's the "Relevant
   * Roots" section at the end of every recall. This way the founding knowledge reaches the agent even when the
   * search doesn't put it among the top results.
   * @param exclude id già mostrati
   *        EN: ids already shown
   * @param n quante al massimo
   *        EN: how many at most
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
   *
   * EN: Sorts a set of Roots by relevance to a query: keywords + meaning, with
   * a lower semantic threshold than usual (Roots are long, general texts).
   * @param strict true = solo quelle con un minimo di pertinenza (per "Radici pertinenti")
   *        EN: true = only those with a minimum of relevance (for "Relevant Roots")
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
      } catch { /* modello non disponibile: solo parole chiave / EN: model not available: keywords only */ }
    }
    const ranked = hybridRank(keyword, semantic, () => 0).map((r) => r.id)
    if (strict) return ranked
    // Elenco completo: prima le pertinenti, poi le altre nell'ordine dato
    // EN: Full list: relevant ones first, then the others in the given order
    return [...ranked, ...ids.filter((id) => !ranked.includes(id))]
  }

  /**
   * Revisione delle Radici, lanciata A MANO (vedi src/roots/review.ts): cerca codice o documenti
   * d'origine cambiati e ricordi più recenti che le contraddicono, e pubblica le segnalazioni
   * (`root.flag`). Le Radici segnalate diventano "da rivedere"; nessuna viene cambiata da sola.
   *
   * EN: Roots review, started BY HAND (see src/roots/review.ts): looks for changed source code or
   * documents and newer memories that contradict them, and publishes the flags
   * (`root.flag`). Flagged Roots become "to review"; none is changed automatically.
   * @param ids Radici da rivedere (default: tutte)
   *        EN: Roots to review (default: all)
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
      // EN: Project repositories are looked up in the folders the user enabled on this PC
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
    // EN: Group the flags by Root, with the title
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

  /** Pubblica al team i contatori d'uso locali non ancora inviati (usage.report). / EN: Publishes to the team the local usage counters not sent yet (usage.report). */
  async flushUsage (): Promise<void> {
    if (!this.team?.writable) return
    const counts = this.privateStore.unreportedUsage()
    if (Object.keys(counts).length === 0) return
    await this.team.append({ type: 'usage.report', counts })
    this.privateStore.markUsageReported(counts)
  }

  /** Pubblica al team le volte in cui i ricordi sono stati utili agli agenti (B11, useful.report). / EN: Publishes to the team how many times memories were useful to agents (B11, useful.report). */
  async flushUseful (): Promise<void> {
    if (!this.team?.writable) return
    const counts = Object.fromEntries(Object.entries(this.privateStore.unreportedUseful()).filter(([id]) => !this.personalIds.has(id)))
    if (Object.keys(counts).length === 0) return
    await this.team.append({ type: 'useful.report', counts })
    this.privateStore.markUsefulReported(counts)
  }

  /** Pubblica al team le sinapsi d'uso nuove (B12, couse.report). / EN: Publishes the new use synapses to the team (B12, couse.report). */
  async flushCoUse (): Promise<void> {
    if (!this.team?.writable) return
    const counts = this.privateStore.unreportedCoUse()
    if (Object.keys(counts).length === 0) return
    await this.team.append({ type: 'couse.report', counts })
    this.privateStore.markCoUseReported(counts)
  }

  /**
   * Sinapsi d'uso di una sessione (B12): ogni coppia di ricordi del team serviti nella sessione si
   * rafforza di uno, una volta sola per sessione. Chiamata quando cambiano gli esiti della sessione.
   *
   * EN: A session's use synapses (B12): every pair of team memories that helped in the session gets
   * one stronger, only once per session. Called when the session's outcomes change.
   */
  private recordCoUse (sessionId: string): void {
    try {
      const ids = this.privateStore.sessionUseful(sessionId).filter((id) => !this.personalIds.has(id) && this.index.get(id))
      const added = this.privateStore.countCoUse(sessionId, sessionPairs(ids))
      if (added) this.log(`sinapsi d'uso: ${added} coppie rafforzate (sessione ${sessionId.slice(0, 8)})`)
    } catch (err) {
      this.log(`sinapsi d'uso non registrate: ${(err as Error).message}`)
    }
  }

  // ═══════════════════════════ Efficacia (B11) ═══════════════════════════
  // EN: Efficacy (B11)

  /**
   * Registra una richiesta di un agente a Micelio (tool MCP o contesto automatico) e avvisa la UI.
   * Sincrona e leggera (un INSERT): la risposta all'agente non deve aspettare.
   *
   * EN: Records an agent query to Micelio (MCP tool or automatic context) and notifies the UI.
   * Synchronous and light (one INSERT): the answer to the agent must not wait.
   */
  consulted (channel: string, query: string | null, ids: string[], ms: number, extra: { project?: string | null, session?: string | null } = {}): void {
    try {
      // La domanda (es. il testo di un prompt) passa dalla redazione dei segreti: resta su questo PC,
      // ma si vede nella pagina «Efficacia» e un prompt può contenere una password incollata
      // EN: The question (e.g. the text of a prompt) goes through secret redaction: it stays on this PC,
      //     but it's visible on the "Efficacy" page and a prompt may contain a pasted password
      const q = query ? applyFilter(query.slice(0, 500)).text : null
      this.privateStore.addConsultation({ channel, query: q, ids, ms, project: extra.project ?? null, session: extra.session ?? null })
      this.changed('efficacy')
    } catch (err) {
      this.log(`consultazione non registrata: ${(err as Error).message}`)
    }
  }

  /**
   * Parte nuova di una sessione (B11): cosa ha fornito Micelio e se l'agente ne ha lasciato tracce
   * (euristica, src/insight/efficacy.ts). Salva gli esiti e restituisce i ricordi forniti, per il
   * giudizio dell'LLM alla distillazione.
   *
   * EN: New part of a session (B11): what Micelio delivered and whether the agent left traces of it
   * (heuristic, src/insight/efficacy.ts). Saves the outcomes and returns the delivered memories, for the
   * LLM's judgment during distillation.
   */
  private evaluateSession (transcriptPath: string, fromLine: number, sessionId: string, cwd: string): { id: string, short: string, title: string }[] {
    const raw = fs.readFileSync(transcriptPath, 'utf8').split('\n').slice(fromLine)
    const rows = parseLines(raw)
    const deliveries = findDeliveries(rows)
    if (!deliveries.length) return []
    const project = projectOf(cwd)
    // Per ricordo l'esito migliore fra le consegne della sessione ("probabilmente utile" vince)
    // EN: Per memory, the best outcome among the session's deliveries ("probably useful" wins)
    const best = new Map<string, { short: string, title: string, verdict: 'likely' | 'none', evidence: string | null }>()
    for (const d of deliveries) {
      const after = actionsAfter(rows, d.index)
      for (const short of d.ids) {
        const rec = this.index.get(short)
        if (!rec) continue
        const prev = best.get(rec.id)
        if (prev?.verdict === 'likely') continue
        const j = judgeUse(rec, after)
        best.set(rec.id, { short, title: rec.title, verdict: j.verdict, evidence: j.evidence })
      }
    }
    let changed = false
    for (const [id, b] of best) changed = this.privateStore.setOutcome({ session: sessionId, memory: id, verdict: b.verdict, judge: 'heuristic', evidence: b.evidence, project }) || changed
    if (changed) { this.refreshHabituation(); this.recordCoUse(sessionId); this.changed('efficacy') }
    return [...best].map(([id, b]) => ({ id, short: b.short, title: b.title }))
  }

  /**
   * Giudizio dell'LLM sui ricordi forniti (B11). "used" → pollice in su automatico (voto +1 di
   * questo nodo, mai sopra un voto già dato) e +1 al contatore di utilità del team.
   *
   * EN: The LLM's judgment on the delivered memories (B11). "used" → automatic thumbs up (+1 vote from
   * this node, never over a vote already given) and +1 to the team's usefulness counter.
   */
  private applyVerdicts (sessionId: string, cwd: string, verdicts: Distilled['micelio']): void {
    const project = projectOf(cwd)
    let changed = false
    for (const v of verdicts) {
      const rec = /^[0-9a-f]{6,64}$/.test(v.id) ? this.index.get(v.id) : null
      if (!rec) continue
      if (!this.privateStore.setOutcome({ session: sessionId, memory: rec.id, verdict: v.verdict, judge: 'llm', evidence: v.reason.slice(0, 300), project })) continue
      changed = true
      if (v.verdict === 'used' && !this.personalIds.has(rec.id)) {
        this.privateStore.countUseful(rec.id)
        this.autoThumbsUp(sessionId, rec.id).catch((err) => this.log(`pollice in su non dato: ${(err as Error).message}`))
      }
      if (v.verdict === 'wrong') this.log(`ricordo forse sbagliato o superato (sessione ${sessionId.slice(0, 8)}): ${rec.title}`)
    }
    if (changed) { this.refreshHabituation(); this.recordCoUse(sessionId); this.changed('efficacy') }
  }

  /** Voto +1 automatico, solo se questo nodo non ha già votato quel ricordo (decisione dell'utente). / EN: Automatic +1 vote, only if this node hasn't already voted on that memory (user's decision). */
  private async autoThumbsUp (sessionId: string, id: string): Promise<void> {
    const team = this.team
    if (!team?.writable) return
    if ((await team.myVote(id)) === null) await team.append({ type: 'memory.vote', id, delta: 1 })
    this.privateStore.markOutcomeVoted(sessionId, id)
  }

  /**
   * Resoconto per la pagina «Efficacia»: consultazioni, esiti, ricordi più utili, rumore,
   * ricordi sbagliati, domande senza risposta, tempi di risposta.
   *
   * EN: Report for the "Efficacy" page: queries, outcomes, most useful memories, noise,
   * wrong memories, unanswered questions, response times.
   * @param days periodo (giorni)
   *        EN: period (days)
   * @param project solo un progetto (nome della cartella), se indicato
   *        EN: a single project (folder name), if given
   */
  efficacyReport (days = 30, project?: string): EfficacyReport {
    const since = Date.now() - days * 24 * 60 * 60 * 1000
    const match = (p: string | null) => !project || (p ?? '').toLowerCase() === project.toLowerCase()
    // Tutte quelle del periodo per i conteggi (90 giorni di uso intenso sono decine di migliaia di
    // righe piccole: si leggono in decimi di secondo); solo le ultime 100 vanno nell'elenco
    // EN: All of the period's rows for the counts (90 days of heavy use are tens of thousands of
    //     small rows: they're read in tenths of a second); only the last 100 go into the list
    const cons = this.privateStore.consultations(since, 1_000_000).filter((c) => match(c.project))
    const outs = this.privateStore.outcomes(since, 1_000_000).filter((o) => match(o.project))
    // Titoli e contatori di team, una lettura per tutti gli id coinvolti
    // EN: Titles and team counters, one read for all the ids involved
    const ids = new Set<string>([...cons.flatMap((c) => c.ids), ...outs.map((o) => o.memory)])
    const byId = new Map(this.index.getMany([...ids]).map((h) => [h.id, h]))
    const mem = (id: string) => ({ id, title: byId.get(id)?.title ?? '(ricordo non più presente)', root: this.rootsById.has(id), teamUseful: this.usefulCounts.get(id) ?? 0 })

    const ms = cons.map((c) => c.ms).sort((a, b) => a - b)
    const pct = (q: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] : 0)
    const useful = (o: Outcome) => o.verdict === 'used' || (o.verdict === 'likely')
    // Per ricordo: volte restituito, esiti utili, esiti senza uso
    // EN: Per memory: times returned, useful outcomes, outcomes with no use
    const stats = new Map<string, { returned: number, useful: number, unused: number, wrong: number }>()
    const st = (id: string) => { if (!stats.has(id)) stats.set(id, { returned: 0, useful: 0, unused: 0, wrong: 0 }); return stats.get(id)! }
    for (const c of cons) for (const id of c.ids) st(id).returned++
    for (const o of outs) {
      if (useful(o)) st(o.memory).useful++
      else if (o.verdict === 'wrong') st(o.memory).wrong++
      else st(o.memory).unused++
    }
    const misses = new Map<string, number>()
    for (const c of cons) if (!c.ids.length && c.query && (c.channel === 'recall' || c.channel === 'architecture')) misses.set(c.query, (misses.get(c.query) ?? 0) + 1)

    return {
      days,
      summary: {
        consultations: cons.length,
        withResults: cons.filter((c) => c.ids.length > 0).length,
        byChannel: Object.fromEntries([...new Set(cons.map((c) => c.channel))].map((ch) => [ch, cons.filter((c) => c.channel === ch).length])),
        delivered: outs.length,
        useful: outs.filter(useful).length,
        confirmed: outs.filter((o) => o.verdict === 'used').length,
        wrong: outs.filter((o) => o.verdict === 'wrong').length,
        thumbsUp: outs.filter((o) => o.voted).length,
        msMedian: pct(0.5),
        msP95: pct(0.95),
        slow: cons.filter((c) => c.ms > SLOW_CONSULTATION_MS).length
      },
      consultations: cons.slice(0, 100).map((c) => ({ ...c, memories: c.ids.slice(0, 8).map(mem) })),
      outcomes: outs.slice(0, 100).map((o) => ({ ...o, memory: mem(o.memory) })),
      topUseful: [...stats].filter(([, s]) => s.useful > 0).sort((a, b) => b[1].useful - a[1].useful).slice(0, 10).map(([id, s]) => ({ ...mem(id), ...s })),
      // Rumore: restituiti spesso ma mai utili (almeno 5 volte e qualche esito senza uso)
      // EN: Noise: often returned but never useful (at least 5 times and some outcomes with no use)
      noisy: [...stats].filter(([, s]) => s.returned >= 5 && s.useful === 0 && s.unused > 0).sort((a, b) => b[1].returned - a[1].returned).slice(0, 10).map(([id, s]) => ({ ...mem(id), ...s, factor: this.habitFactor(id) })),
      wrong: outs.filter((o) => o.verdict === 'wrong').slice(0, 20).map((o) => ({ ...mem(o.memory), reason: o.evidence, session: o.session, ts: o.ts })),
      unanswered: [...misses].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([query, count]) => ({ query, count }))
    }
  }

  /**
   * Esiti da notificare sul desktop (B11): "utile" (confermato) e "sbagliato" dopo `since`.
   * Vuoto se le notifiche sono spente in Impostazioni.
   *
   * EN: Outcomes to notify on the desktop (B11): "useful" (confirmed) and "wrong" after `since`.
   * Empty if notifications are turned off in Settings.
   */
  efficacyNotices (since: number): { ts: number, verdict: OutcomeVerdict, title: string, reason: string | null }[] {
    if (!this.config.efficacy.notify) return []
    return this.privateStore.outcomes(since + 1, 50)
      .filter((o) => o.judge === 'llm' && (o.verdict === 'used' || o.verdict === 'wrong'))
      .map((o) => ({ ts: o.ts, verdict: o.verdict, title: this.index.get(o.memory)?.title ?? o.memory.slice(0, 8), reason: o.evidence }))
  }

  /** Notifiche dell'efficacia accese o spente (impostazione di questo PC). / EN: Efficacy notifications on or off (setting of this PC). */
  setEfficacyNotify (notify: boolean): { notify: boolean } {
    this.config = updateConfig(this.paths, (c) => { c.efficacy.notify = notify })
    this.changed('settings')
    return { notify: this.config.efficacy.notify }
  }

  /**
   * Attivazione 0..1 di un ricordo (vedi src/rank/activation.ts), ridotta se il codice citato è
   * cambiato dopo il ricordo (B4). Radici e ricordi fissati non si riducono: per le Radici c'è la
   * revisione, i fissati sono una scelta esplicita del team.
   *
   * EN: Activation 0..1 of a memory (see src/rank/activation.ts), reduced if the cited code
   * changed after the memory (B4). Roots and pinned memories aren't reduced: Roots have the
   * review, and pinned ones are an explicit team choice.
   */
  /**
   * @param known tipo e data del ricordo, se già noti: con migliaia di ricordi (costellazione)
   *              evita una lettura dal database per ognuno
   *              EN: kind and date of the memory, if already known: with thousands of memories (constellation)
   *              it avoids one database read per memory
   */
  private activationOf (id: string, signals = this.index.signals(), known?: { kind: MemoryRecord['kind'], ts: number }): number {
    const s = signals.get(id)
    const rec = known ?? this.index.get(id)
    if (!rec) return 0
    const root = this.rootsById.has(id)
    const a = activation({ kind: rec.kind, createdAt: rec.ts, lastUsed: s?.lastUsed ?? undefined, uses: s?.uses ?? 0, useful: this.usefulCounts.get(id) ?? 0, votes: s?.votes ?? 0, degree: this.degrees.get(id) ?? 0, pinned: !!s?.pinned, root, effort: this.effortById.get(id) })
    return root || s?.pinned ? a : a * stalenessFactor(this.staleness.get(id))
  }

  /** Ricalcola l'abituazione dagli esiti degli ultimi 90 giorni (B12). / EN: Recomputes habituation from the last 90 days of outcomes (B12). */
  private refreshHabituation (): void {
    try {
      this.habituation = habituationStreaks(this.privateStore.outcomeVerdicts(Date.now() - EFFICACY_KEEP_MS))
    } catch (err) {
      this.log(`abituazione non calcolata: ${(err as Error).message}`)
    }
  }

  /** Fattore di abituazione 0..1 (B12); 1 per i ricordi fissati, che sono una scelta del team. / EN: Habituation factor 0..1 (B12); 1 for pinned memories, which are a team choice. */
  private habitFactor (id: string, signals = this.index.signals()): number {
    const streak = this.habituation.get(id)
    return !streak || signals.get(id)?.pinned ? 1 : habituationFactor(streak)
  }

  /** Campo `habituation` di RecallHit, solo se il ricordo pesa meno del pieno. / EN: RecallHit's `habituation` field, only if the memory weighs less than full. */
  private habituationOf (id: string, pinned: boolean): { habituation?: { streak: number, factor: number } } {
    const streak = this.habituation.get(id)
    if (!streak || pinned) return {}
    const factor = habituationFactor(streak)
    return factor < 1 ? { habituation: { streak, factor } } : {}
  }

  /**
   * Controlla quanto è cambiato il codice citato dai ricordi del team (B4), sui repository di
   * questo PC (cartelle abilitate e loro sotto-cartelle). Sincrono ma con UNA chiamata a git per
   * repository. Chiamato all'avvio, ogni 6 ore e da `micelio stale --check`.
   *
   * EN: Checks how much the code cited by team memories has changed (B4), on the repositories of
   * this PC (enabled folders and their subfolders). Synchronous but with ONE git call per
   * repository. Called at startup, every 6 hours and by `micelio stale --check`.
   * @returns ricordi controllati e quanti risultano con codice cambiato
   *          EN: memories checked and how many have changed code
   */
  checkStaleness (): { checked: number, stale: number } {
    if (!this.team) return { checked: 0, stale: 0 }
    try {
      const found = computeStaleness(this.teamMemories(), localRepos(this.config.watch.sessions))
      for (const [id, st] of found) this.privateStore.setStaleness(id, st.commits, st.missing)
      this.staleness = this.privateStore.staleness()
      const stale = [...found.values()].filter((s) => s.commits || s.missing).length
      // L'attivazione è cambiata: anche la costellazione (dimensione delle stelle) va ricalcolata
      // EN: Activation changed: the constellation (star size) must be recomputed too
      if (found.size) { this.graphCache = null; this.scheduleGraph() }
      return { checked: found.size, stale }
    } catch (err) {
      this.log(`controllo del codice citato non riuscito: ${(err as Error).message}`)
      return { checked: 0, stale: 0 }
    }
  }

  /** Ricordi del team con il codice citato cambiato, dai più cambiati. / EN: Team memories whose cited code changed, most changed first. */
  staleMemories (): RecallHit[] {
    return this.enrich(this.teamMemories()).filter((h) => h.stale).sort((a, b) => (b.stale!.commits + 5 * b.stale!.missing) - (a.stale!.commits + 5 * a.stale!.missing))
  }

  /** Aggiunge ai risultati attivazione, voti, usi e pin. / EN: Adds activation, votes, uses and pins to the results. */
  private enrich (hits: RecallHit[], signals = this.index.signals()): RecallHit[] {
    return hits.map((h) => {
      const s = signals.get(h.id)
      const r = this.rootsById.get(h.id)
      return {
        ...h,
        activation: this.activationOf(h.id, signals, h),
        votes: s?.votes ?? 0,
        uses: s?.uses ?? 0,
        useful: this.usefulCounts.get(h.id) ?? 0,
        pinned: !!s?.pinned,
        ...(r ? { root: { category: r.category, status: r.status } } : {}),
        ...(this.personalIds.has(h.id) ? { personal: true } : {}),
        ...this.staleOf(h.id),
        ...this.habituationOf(h.id, !!s?.pinned)
      }
    })
  }

  /** Un ricordo DEL TEAM (le operazioni di team non valgono per i ricordi personali). / EN: A TEAM memory (team operations don't apply to personal memories). */
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
   *
   * EN: Computes in the background the vectors of memories that don't have one (new ones, or from another
   * model), in blocks of 32. At the end it notifies "memories": the constellation updates with
   * the semantic links.
   */
  private scheduleEmbedding (): void {
    const embedder = this.embedder
    if (!embedder) return
    this.embedding = this.embedding.catch(() => {}).then(async () => {
      let done = 0
      /** Tanti ricordi nuovi in questo giro: i vicini si ricalcolano tutti alla fine (BULK_NEIGHBORS). / EN: Many new memories in this round: neighbors are all recomputed at the end (BULK_NEIGHBORS). */
      let bulk = false
      for (;;) {
        const batch = this.index.missingVectors(embedder.model, 32)
        if (batch.length === 0) break
        const vecs = await embedder.embed(batch.map((b) => b.text), 'passage')
        this.index.setVectors(embedder.model, batch.map((b, i) => ({ id: b.id, vec: vecs[i] })))
        done += batch.length
        // Vicini per significato: solo i ricordi nuovi contro gli altri, non tutte le coppie; salvati su disco.
        // Durante un ricalcolo completo in sottofondo si mettono da parte: si aggiungono alla fine
        // EN: Semantic neighbors: only the new memories against the others, not all pairs; saved to disk.
        //     During a full background recompute they're set aside and added at the end
        if (this.semantic.rebuilding) this.semanticPending.push(...batch.map((b) => b.id))
        else if (done > BULK_NEIGHBORS) bulk = true
        else if (this.semantic.model === embedder.model) {
          this.semantic.add(batch.map((b) => b.id), this.index.vectors(embedder.model), semanticThreshold(embedder.model))
          this.index.saveNeighbors(embedder.model, this.semantic.takeDirty())
        }
      }
      if (bulk) this.startSemanticRebuild(embedder.model, semanticThreshold(embedder.model))
      if (done > 0) {
        this.log(`embedding calcolati per ${done} ricordi`)
        // Nuovi collegamenti per significato: la costellazione va ricalcolata
        // EN: New semantic links: the constellation must be recomputed
        this.scheduleGraph()
      }
    }).catch((err) => this.log(`embedding non calcolati: ${err.message}`))
  }

  /**
   * Collegamenti per affinità di significato, per la costellazione: per ogni ricordo i 2 più
   * simili sopra la soglia del modello. Peso: quanto la similarità supera la soglia.
   * Calcolo completo solo la prima volta, se cambia il modello o se troppe liste citano ricordi
   * non più attivi; per il resto le liste si aggiornano a ogni nuovo vettore (scheduleEmbedding).
   *
   * EN: Links by semantic affinity, for the constellation: for each memory the 2 most
   * similar above the model's threshold. Weight: how far the similarity exceeds the threshold.
   * Full computation only the first time, if the model changes or if too many lists mention memories
   * that are no longer active; otherwise the lists update with every new vector (scheduleEmbedding).
   */
  private semanticLinks (): GraphLink[] {
    if (!this.embedder) return []
    const model = this.embedder.model
    const min = semanticThreshold(model)
    const present = new Set(this.index.all().map((m) => m.id))
    // All'avvio: le liste salvate su disco, se coprono (quasi) tutti i ricordi
    // EN: At startup: the lists saved on disk, if they cover (almost) all memories
    if (this.semantic.model !== model && !this.semantic.rebuilding) {
      const saved = this.index.neighbors(model)
      if (saved.size && saved.size >= present.size * 0.9) this.semantic.load(model, saved)
    }
    // Altrimenti (primo avvio, modello cambiato, troppe liste vecchie): ricalcolo completo A BLOCCHI,
    // in sottofondo; intanto la costellazione usa ciò che c'è, e si ricalcola alla fine
    // EN: Otherwise (first start, model changed, too many stale lists): full recompute IN BLOCKS,
    //     in the background; meanwhile the constellation uses what's there, and is recomputed at the end
    if ((this.semantic.model !== model || this.semantic.staleShare(present) > 0.1) && !this.semantic.rebuilding) {
      this.startSemanticRebuild(model, min)
    }
    return this.semantic.links(min, present)
  }

  /**
   * Ricalcolo completo dei vicini per significato, A BLOCCHI e in sottofondo; alla fine si salvano e
   * si ricalcola la costellazione. Se ne è già in corso uno, se ne fa un altro alla fine (i vettori
   * nuovi non erano nella sua fotografia di partenza).
   *
   * EN: Full recompute of semantic neighbors, IN BLOCKS and in the background; at the end they're saved and
   * the constellation is recomputed. If one is already running, another runs at the end (the new
   * vectors weren't in its starting snapshot).
   */
  private startSemanticRebuild (model: string, min: number): void {
    if (this.semantic.rebuilding) { this.semanticRedo = true; return }
    const t0 = Date.now()
    const vectors = this.index.vectors(model)
    this.semantic.rebuildAsync(vectors, min, model).then(() => {
      // Vettori arrivati durante il ricalcolo: pochi si aggiungono uno per uno, tanti → un altro giro
      // EN: Vectors that arrived during the recompute: a few are added one by one, many → another round
      const pending = this.semanticPending.splice(0)
      if (this.semanticRedo || pending.length > BULK_NEIGHBORS) {
        this.semanticRedo = false
        this.startSemanticRebuild(model, min)
        return
      }
      if (pending.length) this.semantic.add(pending, this.index.vectors(model), min)
      this.index.saveNeighbors(model, this.semantic.takeDirty(), true)
      this.log(`vicini per significato ricalcolati per ${vectors.size} ricordi in ${Date.now() - t0} ms (in sottofondo)`)
      this.scheduleGraph(0)
    }).catch((err) => this.log(`vicini per significato non calcolati: ${err.message}`))
  }

  /** Collegamenti creati dal dreaming, fra ricordi ancora attivi (peso fisso: sono "decisi"). / EN: Links created by dreaming, between still-active memories (fixed weight: they're "decided"). */
  private explicitLinks (): GraphLink[] {
    return this.dreamLinks.map((l) => ({ source: l.from, target: l.to, weight: 0.8, kind: 'dream' as const }))
  }

  /** Ultimi ricordi arrivati nel team, dal più recente. / EN: Latest memories that arrived in the team, newest first. */
  recent (limit = 20): RecallHit[] {
    return this.enrich(this.index.recent(limit))
  }

  // ═══════════════════════════ Contesto automatico (B4) ═══════════════════════════
  // EN: Automatic context (B4)

  /**
   * Contesto da inserire nella conversazione di un agente (hook di Claude Code, vedi
   * src/context/agent-context.ts). Mai un errore: nel dubbio, nessun contesto.
   *
   * EN: Context to inject into an agent's conversation (Claude Code hook, see
   * src/context/agent-context.ts). Never an error: when in doubt, no context.
   * @param o.event    "session-start" (Radici e ricordi del progetto) o "prompt" (pertinenti al testo)
   *                   EN: "session-start" (the project's Roots and memories) or "prompt" (relevant to the text)
   * @param o.cwd      cartella di lavoro dell'agente: dà il progetto
   *                   EN: the agent's working folder: it gives the project
   * @param o.sessionId per non ripetere nella stessa sessione ciò che è già stato mostrato
   *                   EN: to avoid repeating in the same session what was already shown
   */
  async agentContext (o: { event: 'session-start' | 'prompt', cwd: string, sessionId?: string, prompt?: string }): Promise<string> {
    const cfg = this.config.context
    if (!this.team) return ''
    const t0 = Date.now()
    try {
      const seen = o.sessionId ? (this.injected.get(o.sessionId) ?? new Set<string>()) : new Set<string>()
      const team = this.teamNameCache ?? ''
      let text = ''
      let shown: RecallHit[] = []
      if (o.event === 'session-start') {
        if (!cfg.sessionStart) return ''
        const project = projectOf(o.cwd)
        const roots = (await this.projectRoots(project)).slice(0, CONTEXT_ROOTS)
        const rootIds = new Set(roots.map((r) => r.id))
        const memories = this.enrich(this.index.all())
          .filter((h) => !rootIds.has(h.id) && (h.source?.code?.project?.toLowerCase() === project.toLowerCase() || h.tags.includes(project.toLowerCase())))
          // B12: l'abituazione pesa per intero nel contesto automatico
          // EN: B12: habituation weighs in full in automatic context
          .sort((a, b) => (b.activation ?? 0) * (b.habituation?.factor ?? 1) - (a.activation ?? 0) * (a.habituation?.factor ?? 1)).slice(0, CONTEXT_MEMORIES)
        text = sessionContext({ team, project, roots, memories, maxChars: cfg.maxChars })
        shown = [...roots, ...memories]
      } else {
        if (!cfg.prompt || !o.prompt || o.prompt.trim().length < CONTEXT_MIN_PROMPT) return ''
        // Ricordi e Radici con la STESSA soglia stretta: le Radici non passano più da relatedRoots,
        // che è volutamente larga (serve a recall) e su una frase libera portava Radici fuori tema
        // EN: Memories and Roots with the SAME strict threshold: Roots no longer go through relatedRoots,
        //     which is deliberately loose (it serves recall) and on free text brought in off-topic Roots
        const hits = (await this.relevantTo(o.prompt, CONTEXT_MEMORIES)).filter((h) => !seen.has(h.id))
        shown = [...hits.filter((h) => h.root), ...hits.filter((h) => !h.root)].slice(0, CONTEXT_PER_PROMPT)
        text = promptContext({ team, memories: shown, maxChars: cfg.maxChars })
      }
      if (o.sessionId && text) {
        for (const h of shown) seen.add(h.id)
        this.injected.set(o.sessionId, seen)
        // Memoria limitata: le sessioni più vecchie si dimenticano
        // EN: Bounded memory: the oldest sessions are forgotten
        if (this.injected.size > 200) this.injected.delete(this.injected.keys().next().value!)
      }
      // B11: la consultazione (anche senza risultati: è una domanda a cui Micelio non sapeva rispondere)
      // EN: B11: the query (even with no results: it's a question Micelio couldn't answer)
      this.consulted(o.event, o.event === 'prompt' ? (o.prompt ?? null) : null, text ? shown.map((h) => h.id) : [], Date.now() - t0, { project: projectOf(o.cwd), session: o.sessionId ?? null })
      return text
    } catch (err) {
      this.log(`contesto per l'agente non calcolato: ${(err as Error).message}`)
      return ''
    }
  }

  /**
   * Radici di un progetto: quelle che citano il progetto (codice o tag) più quelle GENERALI
   * (best practice e policy senza progetto, che valgono ovunque). Per contesto e file degli agenti.
   *
   * EN: A project's Roots: those that mention the project (code or tags) plus the GENERAL ones
   * (best practices and policies without a project, which apply everywhere). For agent context and files.
   */
  private async projectRoots (project: string): Promise<RecallHit[]> {
    const p = project.toLowerCase()
    return (await this.roots())
      .filter((r) => r.memory.source?.code?.project?.toLowerCase() === p || r.memory.tags.includes(p) ||
        ((r.category === 'practice' || r.category === 'policy') && !r.memory.source?.code?.project))
      .map((r) => r.memory)
  }

  // ═══════════════════════ File per gli agenti e import (B4) ═══════════════════════
  // EN: Agent files and import (B4)

  /**
   * Scrive le Radici del progetto nel file per gli agenti (CLAUDE.md, AGENTS.md o regole di
   * Cursor) della cartella. Con `keep` la cartella entra nell'elenco dei file tenuti aggiornati:
   * si riscrivono da soli quando le Radici cambiano.
   *
   * EN: Writes the project's Roots into the folder's agent file (CLAUDE.md, AGENTS.md or Cursor
   * rules). With `keep` the folder joins the list of files kept up to date:
   * they rewrite themselves when the Roots change.
   */
  async exportAgentFile (o: { dir: string, format: AgentFileFormat, project?: string, keep?: boolean }): Promise<{ file: string, changed: boolean }> {
    this.requireTeam()
    if (!fs.existsSync(o.dir) || !fs.statSync(o.dir).isDirectory()) throw new UserError(`Cartella inesistente: ${path.resolve(o.dir)}`, `Folder not found: ${path.resolve(o.dir)}`)
    if (!(o.format in AGENT_FILE_FORMATS)) throw new UserError('Formato: claude, agents o cursor', 'Format: claude, agents or cursor')
    const dir = canonicalPath(o.dir)
    const project = o.project?.trim() || projectOf(dir)
    const r = writeAgentFile(dir, o.format, renderRootsBlock({ team: this.teamNameCache ?? '', project, roots: await this.projectRoots(project) }))
    if (o.keep) {
      this.config = updateConfig(this.paths, (c) => {
        c.agentFiles = [...c.agentFiles.filter((f) => !(canonicalPath(f.dir) === dir && f.format === o.format)), { dir, format: o.format, ...(o.project?.trim() ? { project: o.project.trim() } : {}) }]
      })
      this.changed('settings')
    }
    return r
  }

  /** I file per gli agenti tenuti aggiornati, e se esistono. / EN: The agent files kept up to date, and whether they exist. */
  agentFiles (): { dir: string, format: AgentFileFormat, project: string, file: string, exists: boolean }[] {
    return this.config.agentFiles.map((f) => {
      const file = path.join(f.dir, AGENT_FILE_FORMATS[f.format])
      return { dir: f.dir, format: f.format, project: f.project ?? projectOf(f.dir), file, exists: fs.existsSync(file) }
    })
  }

  /** Smette di aggiornare un file (il file resta com'è). / EN: Stops updating a file (the file stays as it is). */
  removeAgentFile (dir: string, format: AgentFileFormat): void {
    const d = canonicalPath(dir)
    this.config = updateConfig(this.paths, (c) => { c.agentFiles = c.agentFiles.filter((f) => !(canonicalPath(f.dir) === d && f.format === format)) })
    this.changed('settings')
  }

  /** Riscrive i file tenuti aggiornati (solo quelli cambiati davvero). Dopo ogni aggiornamento della vista. / EN: Rewrites the files kept up to date (only those that really changed). After every view update. */
  private async refreshAgentFiles (): Promise<void> {
    for (const f of this.config.agentFiles) {
      try {
        if (!fs.existsSync(f.dir)) continue
        const project = f.project ?? projectOf(f.dir)
        const r = writeAgentFile(f.dir, f.format, renderRootsBlock({ team: this.teamNameCache ?? '', project, roots: await this.projectRoots(project) }))
        if (r.changed) this.log(`file per gli agenti aggiornato: ${r.file}`)
      } catch (err) {
        this.log(`file per gli agenti non aggiornato (${f.dir}): ${(err as Error).message}`)
      }
    }
  }

  /**
   * Importa come Radici file già scritti dal team (ADR, CLAUDE.md / AGENTS.md a sezioni, vault
   * Markdown), senza LLM: src/roots/import.ts. Passano dal filtro dei segreti; i contenuti
   * bloccati (personali/HR) non entrano. Un ricordo già presente diventa comunque Radice.
   * Reimportare AGGIORNA: un file già importato (stessa chiave, o stesso nome per gli import
   * precedenti alle chiavi) con contenuto diverso sostituisce la versione precedente, che resta
   * nello storico (root.unset → memory.supersede → root.set, nello stesso ordine nel log).
   *
   * EN: Imports as Roots files the team already wrote (ADRs, sectioned CLAUDE.md / AGENTS.md, Markdown
   * vaults), without an LLM: src/roots/import.ts. They go through the secret filter; blocked
   * content (personal/HR) doesn't get in. A memory that's already there still becomes a Root.
   * Reimporting UPDATES: an already imported file (same key, or same name for imports
   * from before keys) with different content replaces the previous version, which stays
   * in the history (root.unset → memory.supersede → root.set, in the same order in the log).
   */
  async importRoots (target: string, category?: RootCategory): Promise<{ imported: number, updated: number, duplicates: number, blocked: string[], ids: string[] }> {
    const team = this.requireTeam()
    if (category && !ROOT_CATEGORIES.includes(category)) throw new UserError(`Categoria sconosciuta: ${category}`, `Unknown category: ${category}`)
    await this.requireRootsRight()
    let items
    try { items = readImport(target) } catch (err) { throw new UserError((err as Error).message, `Path not found: ${target}`) }
    if (!items.length) throw new UserError('Nessun file Markdown da importare', 'No Markdown file to import')
    const rules = await this.filterRules()
    const out = { imported: 0, updated: 0, duplicates: 0, blocked: [] as string[], ids: [] as string[] }
    // Ricordi già importati, per chiave (source.ref) e, per gli import precedenti, per nome del file
    // EN: Memories already imported, by key (source.ref) and, for older imports, by file name
    const previous = this.teamMemories().filter((m) => m.source?.type === 'import')
    const findPrevious = (it: ImportItem) => previous.find((m) => m.source?.ref === it.key) ??
      (!it.key.includes('#') ? previous.find((m) => !m.source?.ref && m.source?.name === it.file) : undefined)
    for (const it of items) {
      const fm = filterMemory(MemoryInput.parse({ kind: it.kind, title: it.title, body: it.body, tags: it.tags, source: { type: 'import', name: it.file, ref: it.key } }), rules)
      if (fm.blocked) { out.blocked.push(`${it.file}: ${it.title}`); continue }
      const id = memoryId(fm.memory)
      // ADR → decisioni architetturali; il resto → best practice, salvo categoria indicata
      // EN: ADR → architecture decisions; the rest → best practice, unless a category is given
      const old = findPrevious(it)
      let cat: RootCategory = category ?? (it.kind === 'decision' ? 'architecture' : 'practice')
      if (this.index.get(id)?.id === id) {
        out.duplicates++
      } else if (old && old.id !== id && !this.index.signals().get(old.id)?.pinned) {
        // Versione nuova di un file già importato: sostituisce la precedente (che resta nello storico)
        // EN: New version of an already imported file: it replaces the previous one (which stays in the history)
        const oldRoot = this.rootsById.get(old.id)
        if (oldRoot) { cat = category ?? oldRoot.category; await team.append({ type: 'root.unset', id: old.id }) }
        await team.append({ type: 'memory.supersede', old: [old.id], memory: fm.memory, reason: 'reimportato: il file è cambiato' })
        out.updated++
      } else {
        await team.append({ type: 'memory.add', memory: fm.memory })
        out.imported++
      }
      await team.append({ type: 'root.set', id, category: cat })
      out.ids.push(id)
    }
    await this.sync()
    this.changed('roots')
    return out
  }

  /**
   * Ricordi e Radici PERTINENTI a un testo libero (la richiesta di un utente): solo per significato
   * e sopra una soglia PIÙ ALTA di quella della ricerca (promptThreshold). Le sole parole chiave su
   * un testo lungo trovano troppo rumore. Senza embedding: nessun risultato. Non conta come uso
   * (l'agente potrebbe ignorarli).
   *
   * EN: Memories and Roots RELEVANT to free text (a user's request): by meaning only
   * and above a HIGHER threshold than the search one (promptThreshold). Keywords alone on
   * a long text find too much noise. Without embeddings: no results. It doesn't count as usage
   * (the agent might ignore them).
   */
  private async relevantTo (text: string, n: number): Promise<RecallHit[]> {
    if (!this.embedder) return []
    const [q] = await this.embedder.embed([text.slice(0, 2000)], 'query')
    const all = nearest(q, this.index.vectors(this.embedder.model), Number.MAX_SAFE_INTEGER)
    const cutoff = relevanceCutoff(all.map((x) => x.score), promptThreshold(this.embedder.model))
    // B12: abituazione piena PRIMA della soglia: un ricordo che è stato solo rumore ne esce.
    // La soglia si calcola sui punteggi originali, così l'abituazione non la sposta.
    // EN: B12: full habituation BEFORE the threshold: a memory that has only been noise drops out.
    //     The threshold is computed on the original scores, so habituation doesn't move it.
    const signals = this.index.signals()
    const ids = all.map((r) => ({ id: r.id, score: r.score * this.habitFactor(r.id, signals) }))
      .filter((r) => r.score >= cutoff).sort((a, b) => b.score - a.score).slice(0, n).map((r) => r.id)
    return this.enrich(this.index.getMany(ids))
  }

  // ═══════════════════════ Lacune e riepilogo settimanale (B4) ═══════════════════════
  // EN: Knowledge gaps and weekly digest (B4)

  /** Registra una ricerca senza risultato, dopo la redazione dei segreti (src/insight/gaps.ts). / EN: Records a search with no result, after secret redaction (src/insight/gaps.ts). */
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
   *
   * EN: YOUR searches with no answer (only on this PC), most frequent first. `answer` = a memory
   * that arrived in the meantime and may fill it (keyword search).
   */
  myGaps (): { key: string, query: string, count: number, first: number, last: number, answer: { id: string, title: string } | null }[] {
    return this.privateStore.searchMisses('open').map((m) => {
      const [id] = this.index.keywordIds(m.query, 1)
      const hit = id ? this.index.get(id) : null
      return { key: m.key, query: m.query, count: m.count, first: m.first, last: m.last, answer: hit ? { id: hit.id, title: hit.title } : null }
    })
  }

  /** Ignora una tua lacuna (non riapparirà). / EN: Ignores one of your knowledge gaps (it won't show up again). */
  dismissGap (key: string): void {
    this.privateStore.setSearchMissStatus(key, 'dismissed')
    this.changed('gaps')
  }

  /** Segnala al team una tua lacuna: tutti la vedono e chi ha lo stesso bisogno si aggiunge. / EN: Reports one of your knowledge gaps to the team: everyone sees it and whoever has the same need joins in. */
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

  /** Lacune segnalate al team, aperte prima, con chi le condivide e un possibile ricordo che le colma. / EN: Knowledge gaps reported to the team, open ones first, with who shares them and a memory that may fill them. */
  async teamGaps (): Promise<GapView[]> {
    const team = this.requireTeam()
    const names = new Map((await team.members()).map((m) => [m.key, m.name]))
    return (await team.gaps()).map((g) => {
      const [id] = g.status === 'open' ? this.index.keywordIds(g.question, 1) : []
      const hit = id ? this.index.get(id) : null
      return { ...g, askerNames: g.askers.map((k) => names.get(k) ?? k.slice(0, 8)), answer: hit ? { id: hit.id, title: hit.title } : null }
    }).sort((a, b) => (a.status === b.status ? b.askers.length - a.askers.length || b.ts - a.ts : a.status === 'open' ? -1 : 1))
  }

  /** Chiude una lacuna del team, facoltativamente con il ricordo che la colma. / EN: Closes a team knowledge gap, optionally with the memory that fills it. */
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

  /** Riepilogo degli ultimi `days` giorni (src/insight/digest.ts). / EN: Digest of the last `days` days (src/insight/digest.ts). */
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
  // EN: Personal memories (B4)

  /** Campo `stale` di un risultato, se il codice citato è cambiato (le Radici hanno la revisione). / EN: A result's `stale` field, if the cited code changed (Roots have the review instead). */
  private staleOf (id: string): { stale?: { commits: number, missing: number } } {
    const st = this.staleness.get(id)
    if (!st || (!st.commits && !st.missing) || this.rootsById.has(id)) return {}
    return { stale: { commits: st.commits, missing: st.missing } }
  }

  /** Ricordi del TEAM nell'indice (senza i personali): per costellazione, dreaming, metriche, export. / EN: TEAM memories in the index (without personal ones): for the constellation, dreaming, metrics, export. */
  private teamMemories (): RecallHit[] {
    return this.personalIds.size ? this.index.all().filter((m) => !this.personalIds.has(m.id)) : this.index.all()
  }

  /** I ricordi personali come record dell'indice (autore = questo nodo). / EN: Personal memories as index records (author = this node). */
  private personalRecords (me: string): MemoryRecord[] {
    return this.privateStore.personal().map(({ id, memory, created }) => ({
      id, kind: memory.kind, title: memory.title, body: memory.body, tags: memory.tags, source: memory.source, author: me, ts: created, status: 'active' as const
    }))
  }

  /**
   * Salva un ricordo PERSONALE: resta su questo PC e compare nelle ricerche (anche degli agenti)
   * insieme a quelli del team. Passa comunque dalla redazione dei segreti (agli agenti arriva il
   * testo); il blocco dei contenuti personali/HR non si applica, perché non lascia il PC.
   *
   * EN: Saves a PERSONAL memory: it stays on this PC and shows up in searches (agents' too)
   * together with the team's. It still goes through secret redaction (agents receive the
   * text); the personal/HR content block doesn't apply, because it doesn't leave the PC.
   */
  async rememberPersonal (input: MemoryInput): Promise<{ id: string, duplicate: boolean }> {
    this.requireTeam()
    const parsed = MemoryInput.safeParse(input)
    if (!parsed.success) throw new UserError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    const { memory } = filterMemory(parsed.data, await this.filterRules())
    const id = memoryId(memory)
    const added = this.privateStore.addPersonal(id, memory)
    await this.materialize(true)
    return { id, duplicate: !added }
  }

  /** I ricordi personali, dal più recente. / EN: Personal memories, newest first. */
  personal (): RecallHit[] {
    return this.enrich(this.index.getMany([...this.personalIds])).sort((a, b) => b.ts - a.ts)
  }

  /**
   * Condivide un ricordo personale con il team: esce dai personali e passa dalla stessa strada
   * di un salvataggio esplicito (filtro e classificazione, D6), quindi può finire in inbox.
   *
   * EN: Shares a personal memory with the team: it leaves the personal ones and goes the same way
   * as an explicit save (filter and classification, D6), so it may end up in the Inbox.
   */
  async sharePersonal (id: string): Promise<ExplicitOutcome> {
    const p = this.privateStore.personal().find((x) => x.id === id || x.id.startsWith(id))
    if (!p) throw new UserError(`Nessun ricordo personale con id ${id}`, `No personal memory with id ${id}`)
    const outcome = await this.pipeline.ingestExplicit({ ...p.memory, source: { ...p.memory.source, type: 'personal' } })
    this.privateStore.removePersonal(p.id)
    await this.materialize(true)
    return outcome
  }

  /** Cancella un ricordo personale (non lascia tracce: non è mai stato nel log). / EN: Deletes a personal memory (it leaves no trace: it was never in the log). */
  async deletePersonal (id: string): Promise<void> {
    const p = this.privateStore.personal().find((x) => x.id === id || x.id.startsWith(id))
    if (!p) throw new UserError(`Nessun ricordo personale con id ${id}`, `No personal memory with id ${id}`)
    this.privateStore.removePersonal(p.id)
    await this.materialize(true)
  }

  /** Un elemento dell'inbox non va al team ma resta come ricordo personale. / EN: An Inbox item doesn't go to the team but stays as a personal memory. */
  async keepPersonal (inboxId: string): Promise<{ id: string, duplicate: boolean }> {
    this.requireTeam()
    const memory = this.pipeline.keepPrivately(inboxId)
    const id = memoryId(memory)
    const added = this.privateStore.addPersonal(id, memory)
    await this.materialize(true)
    return { id, duplicate: !added }
  }

  /** Un ricordo per id (anche abbreviato). / EN: A memory by id (short ids too). */
  get (id: string): RecallHit | null {
    return this.index.get(id)
  }

  /**
   * Pubblica un ricordo nel team SENZA filtri: usato dalla pipeline dopo che ha deciso.
   * Non esposto all'esterno: tutto ciò che arriva da fuori passa da `remember`.
   *
   * EN: Publishes a memory to the team WITHOUT filters: used by the pipeline once it has decided.
   * Not exposed outside: everything coming from outside goes through `remember`.
   */
  private async publish (memory: MemoryData): Promise<{ id: string, duplicate: boolean, updated?: string }> {
    const team = this.requireTeam()
    const id = memoryId(memory)
    // Controllo locale dei duplicati: evita di scrivere nel log un evento che apply ignorerebbe.
    // Un ricordo personale con lo stesso contenuto non conta: è proprio quello che si sta condividendo
    // EN: Local duplicate check: avoids writing to the log an event that apply would ignore.
    //     A personal memory with the same content doesn't count: it's exactly the one being shared
    if (this.index.get(id)?.id === id && !this.personalIds.has(id)) return { id, duplicate: true }
    // B4: aggiornare invece di aggiungere (src/ingest/write-update.ts)
    // EN: B4: update instead of add (src/ingest/write-update.ts)
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
   *
   * EN: "Add, duplicate or update" decision for a new memory (B4). null = just add it:
   * no similar memory, no LLM or budget used up, or turned off by the team
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
      // EN: Any problem (model, LLM, budget): add it as before, no knowledge is lost
      this.log(`controllo dei ricordi simili non riuscito: ${(err as Error).message}`)
      return null
    }
  }

  // ═══════════════════════════ Ingestione automatica ═══════════════════════════
  // EN: Automatic ingestion

  /**
   * Riceve la notifica di fine sessione di Claude Code (dall'hook SessionEnd).
   * Accoda la sessione SOLO se la cartella di lavoro è opt-in (decisione D7).
   *
   * EN: Receives Claude Code's end-of-session notification (from the SessionEnd hook).
   * Queues the session ONLY if the working folder is opt-in (decision D7).
   * @returns `queued: false` con il motivo se la sessione è stata ignorata
   *          EN: `queued: false` with the reason if the session was ignored
   */
  ingestSession (payload: { sessionId: string, transcriptPath: string, cwd: string }): { queued: boolean, reason?: string, jobId?: number } {
    if (!this.team) return { queued: false, reason: 'nodo non configurato' }
    if (!isInsideWatched(payload.cwd, this.config.watch.sessions) || !this.ownsFolder(payload.cwd)) {
      // Riga di log volutamente presente: senza, una sessione ignorata sparisce senza lasciare traccia.
      // EN: Log line on purpose: without it, an ignored session disappears without a trace.
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
   *
   * EN: Checks Claude Code transcripts and queues the new part of the sessions (running or
   * finished) of the enabled folders. Called at startup, periodically and by `micelio ingest scan`.
   * Asincrona e in background: le trascrizioni si leggono in un worker thread, il daemon resta
   * reattivo. Una scansione già in corso non se ne sovrappone un'altra: si restituisce la stessa.
   *
   * EN: Asynchronous and in the background: transcripts are read in a worker thread, the daemon
   * stays responsive. A scan already running isn't overlapped by another: the same one is returned.
   * @returns quante sessioni sono state accodate
   *          EN: how many sessions were queued
   */
  scanSessions (): Promise<number> {
    this.scanning ??= this.runScan().finally(() => { this.scanning = null })
    return this.scanning
  }

  /** Scansione in corso (null = nessuna). / EN: Running scan (null = none). */
  private scanning: Promise<number> | null = null

  /** Una scansione: vedi scanSessions. / EN: One scan: see scanSessions. */
  private async runScan (): Promise<number> {
    const s = this.config.watch.sessionScan
    if (!this.team || !s.enabled) return 0
    try {
      // Con più team si tengono solo le sessioni delle cartelle che appartengono a questo team
      // EN: With several teams, keep only sessions from folders that belong to this team
      const found = (await this.scanner.scan({ projectsDir: claudeProjectsDir(), watched: this.config.watch.sessions, ...s })).filter((c) => this.ownsFolder(c.cwd))
      // Il nodo può essersi fermato durante la lettura (chiusura del daemon)
      // EN: The node may have stopped during the read (daemon shutdown)
      if (!this.team) return 0
      for (const c of found) this.pipeline.enqueueSession(c)
      if (found.length) this.log(`raccolta periodica: ${found.length} sessioni con parti nuove accodate`)
      return found.length
    } catch (err) {
      this.log(`raccolta periodica non riuscita: ${(err as Error).message}`)
      return 0
    }
  }

  /** Cartelle opt-in per la raccolta dalle sessioni. / EN: Opt-in folders for collecting from sessions. */
  watched (): string[] {
    return this.config.watch.sessions
  }

  /** Abilita la raccolta automatica per una cartella (e sottocartelle). / EN: Enables automatic collection for a folder (and its subfolders). */
  watchAdd (dir: string): string[] {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new UserError(`Cartella inesistente: ${path.resolve(dir)}`, `Folder not found: ${path.resolve(dir)}`)
    // Salviamo la forma canonica (nome lungo, link risolti): è quella che si vede nell'elenco.
    // EN: We save the canonical form (long name, links resolved): it's the one shown in the list.
    const abs = canonicalPath(dir)
    this.opts.claimFolder?.(abs, 'sessions')
    this.config = updateConfig(this.paths, (c) => {
      if (!isInsideWatched(abs, c.watch.sessions)) c.watch.sessions.push(abs)
    })
    this.changed('settings')
    return this.config.watch.sessions
  }

  /** Disabilita la raccolta automatica per una cartella. / EN: Disables automatic collection for a folder. */
  watchRemove (dir: string): string[] {
    const abs = canonicalPath(dir)
    this.config = updateConfig(this.paths, (c) => {
      c.watch.sessions = c.watch.sessions.filter((w) => canonicalPath(w) !== abs)
    })
    this.changed('settings')
    return this.config.watch.sessions
  }

  /** Impostazioni locali correnti (per la schermata Impostazioni). / EN: Current local settings (for the Settings screen). */
  settings (): NodeSettings {
    const { adapter, command, classifyModel, distillModel, dailyBudget } = this.config.llm
    return { llm: { adapter, command, classifyModel, distillModel, dailyBudget }, watched: this.config.watch.sessions, documents: this.config.watch.documents, port: this.config.port, network: this.networkSettings(), context: { ...this.config.context }, efficacy: { ...this.config.efficacy } }
  }

  // ═══════════════════════════ Sicurezza (Fase 9) ═══════════════════════════
  // EN: Security (Phase 9)

  /** Regole in vigore: riconoscitori fissi, file sensibili di default e regole del team. / EN: Rules in force: built-in detectors, default sensitive files and team rules. */
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
   *
   * EN: Updates the team rules (admin only): secret patterns, exceptions, sensitive files.
   * They're replicated to all nodes and apply right away. Invalid patterns are rejected here,
   * with a readable message, instead of being silently ignored by the pipeline.
   */
  async setSecurityRules (patch: Partial<SecurityRules['team']>): Promise<SecurityRules> {
    if (patch.secretPatterns) {
      for (const p of patch.secretPatterns) {
        if (!p.name?.trim() || !p.regex?.trim()) throw new UserError('Ogni pattern ha un nome e un\'espressione regolare', 'Every pattern needs a name and a regular expression')
        if (p.regex.length > 300) throw new UserError(`Pattern «${p.name}» troppo lungo (massimo 300 caratteri)`, `Pattern “${p.name}” is too long (300 characters at most)`)
        try { new RegExp(p.regex, 'g') } catch (e) { throw new UserError(`Pattern «${p.name}» non valido: ${(e as Error).message}`, `Pattern “${p.name}” is not valid: ${(e as Error).message}`) }
        // Un pattern che riconosce la stringa vuota redigerebbe ovunque
        // EN: A pattern that matches the empty string would redact everywhere
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

  /** Banco di prova: cosa farebbe il filtro con un testo e/o un nome di file. Non salva nulla. / EN: Test bench: what the filter would do with a text and/or a file name. Saves nothing. */
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
   *
   * EN: Retroactive scan: published memories that, under the CURRENT rules, contain secrets or
   * personal data (e.g. published before a new rule). Report only: the cleanup is
   * an explicit action (securityClean).
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
   *
   * EN: "Clean up" a memory (admin only): publishes the REDACTED version and removes the original from
   * everyone's view (memory.redact). If it was a Root, the clean version stays one.
   * Limit: whoever already read or exported the original keeps a copy, and the encrypted blocks
   * stay in the replicated logs (as with every redaction, DESIGN §10.3).
   * @returns id della versione pulita
   *          EN: id of the clean version
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

  /** Registro di sicurezza locale (cosa è stato tolto, da dove, di che tipo). / EN: Local security log (what was removed, from where, of which type). */
  securityLog (limit = 200): SecurityLogEntry[] {
    return this.privateStore.securityLog(limit)
  }

  /** Regole del filtro in vigore (default + team): le stesse usate dalla pipeline. / EN: Filter rules in force (defaults + team): the same the pipeline uses. */
  private async filterRules () {
    return mergeRules(await this.team?.config('filter.blockKeywords'), await this.team?.config('security.secretPatterns'), await this.team?.config('security.allow'))
  }

  // ═══════════════════════════════ Rete ═══════════════════════════════
  // EN: Network

  /** Impostazioni di rete correnti (vedi NetworkSettings). / EN: Current network settings (see NetworkSettings). */
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
   *
   * EN: Chooses the network (public DHT, private, or "local" = no network) and applies it RIGHT AWAY: it saves the team settings and, if the node is
   * in a team, closes and reopens the network with the new bootstrap nodes (local data stays; after
   * a few seconds the node finds the colleagues using the same DHT again).
   * WARNING: all members must use the same DHT, otherwise they can't find each other.
   * @param bootstrap nodi "host:porta" della DHT privata; con "public" si possono omettere
   *                  (restano quelli salvati, per poter tornare alla privata)
   *                  EN: "host:port" nodes of the private DHT; with "public" they can be omitted
   *                  (the saved ones stay, so you can go back to the private one)
   */
  async setNetwork (mode: NetworkMode, bootstrap?: string[]): Promise<NetworkSettings> {
    // La modalità solo locale si può scegliere anche con la rete fissata dalla variabile (demo, test)
    // EN: Local-only mode can be chosen even when the network is fixed by the variable (demo, tests)
    if (process.env.MICELIO_DHT_BOOTSTRAP && mode !== 'local' && !this.localOnly) throw new UserError('La rete è fissata dalla variabile MICELIO_DHT_BOOTSTRAP: toglila per sceglierla da qui', 'The network is set by the MICELIO_DHT_BOOTSTRAP variable: remove it to choose from here')
    if (mode !== 'public' && mode !== 'private' && mode !== 'local') throw new UserError('Rete: "public", "private" oppure "local"', 'Network: "public", "private" or "local"')
    const list = bootstrap?.map((b) => b.trim()).filter(Boolean)
    if (list?.some((b) => !BOOTSTRAP_RE.test(b))) throw new UserError('Formato dei nodi di avvio: host:porta, con la chiave del relay se il server la indica (es. 203.0.113.10:49737 oppure 203.0.113.10:49737#<chiave>)', 'Bootstrap node format: host:port, with the relay key if the server gives one (e.g. 203.0.113.10:49737 or 203.0.113.10:49737#<key>)')
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
   *
   * EN: Diagnoses a DHT BEFORE choosing it (the UI's "Check" button): changes nothing.
   * Without arguments it checks the DHT in use.
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
   *
   * EN: Closes and reopens the team connection with the current bootstrap nodes (after a DHT change).
   * The local log isn't touched: reopening starts again from the data on disk.
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
    await this.materialize(true)
  }

  // ═══════════════════════════ Spazio occupato ═══════════════════════════
  // EN: Storage used

  /** Spazio occupato dal sapere, su disco e per membro (vedi StorageReport). / EN: Space taken by the knowledge, on disk and per member (see StorageReport). */
  async storage (): Promise<StorageReport> {
    // I database SQLite in modalità WAL hanno due file accessori (-wal, -shm)
    // EN: SQLite databases in WAL mode have two side files (-wal, -shm)
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
    // EN: Active memories per author, with their text size
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
   *
   * EN: Updates LLM models and budget. They take effect right away (they're reread on every call).
   * Changing the adapter or command needs a daemon restart instead: they can't be changed here.
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

  /** Contesto automatico per gli agenti (B4): cosa inseriscono gli hook. Vale per la macchina. / EN: Automatic context for agents (B4): what the hooks inject. Applies to the whole machine. */
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
  // EN: Documents (Phase 4)

  /**
   * Aggiunge una cartella di documenti sorvegliata.
   *
   * EN: Adds a watched document folder.
   * @param shareable se true, i colleghi possono scaricare gli originali su richiesta (D10)
   *        EN: if true, colleagues can download the originals on request (D10)
   * @param roots se true, i ricordi distillati dai documenti della cartella diventano Radici (Fase 8)
   *        EN: if true, memories distilled from the folder's documents become Roots (Phase 8)
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

  /** Smette di sorvegliare una cartella (i ricordi già distillati restano nel team). / EN: Stops watching a folder (memories already distilled stay in the team). */
  async documentsRemove (dir: string): Promise<NodeSettings['documents']> {
    const abs = canonicalPath(dir)
    this.config = updateConfig(this.paths, (c) => {
      c.watch.documents = c.watch.documents.filter((d) => canonicalPath(d.path) !== abs)
    })
    await this.documents.start(this.config.watch.documents)
    this.changed('settings')
    return this.config.watch.documents
  }

  /** Conteggi dei documenti per stato (in coda, elaborati, bloccati…). / EN: Document counts by state (queued, processed, blocked…). */
  documentStats (): Record<string, number> {
    return this.privateStore.documentStats()
  }

  /**
   * Ottiene l'originale del documento da cui è stato distillato un ricordo (DESIGN §12-bis).
   * - documento di questo nodo → il file locale;
   * - già scaricato → la copia in cache;
   * - altrimenti → richiesta P2P al proprietario (deve essere online, D11).
   *
   * EN: Gets the original document a memory was distilled from (DESIGN §12-bis).
   * - document of this node → the local file;
   * - already downloaded → the cached copy;
   * - otherwise → P2P request to the owner (they must be online, D11).
   * @throws UserError se il ricordo non viene da un documento o il download non riesce
   *         EN: if the memory doesn't come from a document or the download fails
   */
  async fetchSource (memoryId: string): Promise<SourceFile> {
    const rec = this.index.get(memoryId)
    if (!rec) throw new UserError(`Nessun ricordo con id ${memoryId}`, `No memory with id ${memoryId}`)
    const src = rec.source
    if (src?.type !== 'document' || !src.ref) throw new UserError('Questo ricordo non viene da un documento: non c\'è un originale da scaricare', 'This memory does not come from a document: there is no original to download')
    // Il riferimento arriva da un collega e finisce in un percorso: deve essere l'hash SHA-256 del
    // documento e nient'altro. Senza questo controllo un ricordo con ref `../../.ssh` e nome
    // `id_rsa` faceva leggere (e passare all'agente) un file qualsiasi del PC (revisione di
    // sicurezza 2026-10-26).
    // EN: The reference comes from a colleague and ends up in a path: it must be the document's
    //     SHA-256 hash and nothing else. Without this check a memory with ref `../../.ssh` and name
    //     `id_rsa` made the PC read (and hand to the agent) any file (security review 2026-10-26).
    if (!isDocumentRef(src.ref)) throw new UserError('Riferimento al documento non valido: questo ricordo non può essere scaricato', 'Invalid document reference: this memory cannot be downloaded')
    const name = path.basename(src.name ?? 'documento')
    // Documento di questo nodo: nessun download.
    // EN: Document of this node: no download.
    if (rec.author === this.team?.localKey) {
      const local = this.privateStore.documentsByHash(src.ref).find((d) => fs.existsSync(d.path))
      if (local) return { path: local.path, name, size: local.size, local: true }
    }
    const cached = path.join(this.paths.home, 'sources', src.ref, name)
    if (fs.existsSync(cached)) return { path: cached, name, size: fs.statSync(cached).size, local: true }
    let r: { data: Buffer, name: string }
    try {
      r = await this.files.fetch(src.ref, rec.author)
    } catch (err) {
      throw new UserError(`Download non riuscito: ${(err as Error).message}`, `Download failed: ${(err as Error).message}`)
    }
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    fs.writeFileSync(cached, r.data)
    return { path: cached, name, size: r.data.length, local: false }
  }

  /** Testo estratto da un file scaricato (per il tool MCP: l'agente può leggerlo subito). / EN: Text extracted from a downloaded file (for the MCP tool: the agent can read it right away). */
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
   *
   * EN: Owner side: which local file to serve for a hash, if shareable (D10).
   * The file must be in a SHAREABLE watched folder, exist and be unchanged.
   */
  private async resolveSharedFile (hash: string): Promise<{ file: string, name: string, size: number } | { denied: string }> {
    const docs: DocumentRecord[] = this.privateStore.documentsByHash(hash)
    if (docs.length === 0) return { denied: 'documento non disponibile su questo nodo' }
    for (const d of docs) {
      const folder = this.config.watch.documents.find((f) => canonicalPath(f.path) === canonicalPath(d.folder))
      if (!folder?.shareable) continue
      if (!fs.existsSync(d.path)) continue
      if (await hashFile(d.path) !== hash) continue // modificato dopo l'elaborazione: non è più "quel" documento / EN: modified after processing: it's no longer "that" document
      return { file: d.path, name: path.basename(d.path), size: d.size }
    }
    return { denied: 'il proprietario non condivide gli originali di questa cartella' }
  }

  /** Elimina dalla cache i documenti scaricati più di SOURCE_CACHE_DAYS giorni fa. / EN: Removes from the cache documents downloaded more than SOURCE_CACHE_DAYS days ago. */
  private sweepSourceCache (): void {
    const dir = path.join(this.paths.home, 'sources')
    if (!fs.existsSync(dir)) return
    const limit = Date.now() - SOURCE_CACHE_DAYS * 24 * 3600 * 1000
    for (const h of fs.readdirSync(dir)) {
      const p = path.join(dir, h)
      if (fs.statSync(p).mtimeMs < limit) fs.rmSync(p, { recursive: true, force: true })
    }
  }

  /** Stato dell'ingestione: LLM, budget, coda, inbox. / EN: Ingestion status: LLM, budget, queue, Inbox. */
  async ingestStatus (): Promise<IngestStatus> {
    return {
      llm: this.llm ? { adapter: this.llm.adapter.name, available: await this.llm.available(), budget: this.llm.budget } : null,
      jobs: this.privateStore.jobStats(),
      inbox: this.privateStore.listInbox().length,
      watched: this.config.watch.sessions
    }
  }

  /** Elabora subito un lavoro in coda (test e comando `micelio ingest run`). / EN: Processes a queued job right away (tests and the `micelio ingest run` command). */
  processQueue (): Promise<boolean> {
    return this.pipeline.tick()
  }

  // ═══════════════════════════════ Inbox e privato ═════════════════════════════
  // EN: Inbox and private

  inbox (): InboxItem[] {
    return this.pipeline.listInbox()
  }

  /** Approva un elemento dell'inbox (con eventuali modifiche) e lo pubblica nel team. / EN: Approves an Inbox item (with any edits) and publishes it to the team. */
  async approve (id: string, overrides: Partial<Pick<MemoryData, 'title' | 'body' | 'kind' | 'tags'>> = {}): Promise<{ id: string, duplicate: boolean, memory: MemoryData }> {
    this.requireTeam()
    try {
      return await this.pipeline.approve(id, overrides)
    } catch (err) {
      throw err instanceof InboxNotFoundError ? new UserError(err.message, err.en) : err
    }
  }

  /**
   * Toglie un elemento dall'Inbox per spostarlo in un altro team (vedi MicelioHost.moveInbox).
   *
   * EN: Removes an item from the Inbox to move it to another team (see MicelioHost.moveInbox).
   */
  takeInbox (id: string, toTeamName: string): InboxItem {
    try {
      return this.pipeline.takeInbox(id, toTeamName)
    } catch (err) {
      throw err instanceof InboxNotFoundError ? new UserError(err.message, err.en) : err
    }
  }

  /** Riceve un elemento spostato da un altro team; restituisce il suo id qui. / EN: Receives an item moved from another team; returns its id here. */
  receiveInbox (item: InboxItem): string {
    this.requireTeam()
    return this.pipeline.receiveInbox(item)
  }

  /** Rifiuta un elemento dell'inbox. / EN: Rejects an Inbox item. */
  reject (id: string): void {
    try {
      this.pipeline.reject(id)
    } catch (err) {
      throw err instanceof InboxNotFoundError ? new UserError(err.message, err.en) : err
    }
  }

  /** Registro di ciò che NON è andato al team (bloccato, privato, scartato, rifiutato, scaduto). / EN: Log of what did NOT go to the team (blocked, private, discarded, rejected, expired). */
  decisions (limit = 50): Decision[] {
    return this.privateStore.listDecisions(limit)
  }

  // ═══════════════════════════════════ Stato ═══════════════════════════════════
  // EN: Status

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
      ...(this.opts.bootstrap?.length ? { relay: team.relay } : {}),
      members: members.length,
      memories: this.index.count() - this.personalIds.size
    }
  }

  /** Scarica ciò che è disponibile dai peer e riallinea indice ed export. / EN: Downloads what's available from peers and brings the index and export back in line. */
  async sync (): Promise<void> {
    await this.requireTeam().update()
    await this.materialize()
  }

  // ═════════════════════════════════ Interni ═══════════════════════════════════
  // EN: Internals

  private newTeamNode (): TeamNode {
    return new TeamNode({ storeDir: this.paths.store, bootstrap: this.opts.bootstrap, log: this.log, offline: this.localOnly })
  }

  /** true se il team è in modalità solo locale (B4): nessuna rete. / EN: true if the team is in local-only mode (B4): no network. */
  get localOnly (): boolean {
    return networkMode(this.config.network) === 'local'
  }

  /**
   * Sceglie la rete PRIMA di creare il team (es. «Solo per me» nel primo avvio). Dopo la
   * creazione si usa setNetwork, che riconnette il nodo.
   *
   * EN: Chooses the network BEFORE creating the team (e.g. "Just for me" on first start). After
   * creation, use setNetwork, which reconnects the node.
   */
  prepareNetwork (mode: NetworkMode): void {
    if (this.team) throw new UserError('Il team esiste già: cambia la rete dalle Impostazioni', 'The team already exists: change the network from Settings')
    this.config = updateConfig(this.paths, (c) => { c.network.mode = mode })
  }

  /** Collega il TeamNode al nodo: ogni aggiornamento della vista programma una reindicizzazione. / EN: Attaches the TeamNode to the node: every view update schedules a reindex. */
  private attach (team: TeamNode): void {
    this.team = team
    team.on('update', () => this.scheduleMaterialize())
    team.on('peers', () => this.changed('status'))
    // Canale di scambio documenti su ogni connessione, comprese quelle già aperte.
    // EN: Document exchange channel on every connection, including those already open.
    team.on('connection', (conn: any) => this.files.attach(conn))
    for (const conn of team.connections) this.files.attach(conn)
  }

  /** Emette un evento `change` per ciascun argomento (vedi ChangeTopic). / EN: Emits a `change` event for each topic (see ChangeTopic). */
  private changed (...topics: ChangeTopic[]): void {
    for (const t of topics) this.emit('change', t)
  }

  /**
   * Accorpa gli aggiornamenti: durante una sincronizzazione Autobase emette molti 'update' di
   * fila, ma basta reindicizzare una volta alla fine della raffica.
   *
   * EN: Batches updates: during a sync Autobase emits many 'update' events in a
   * row, but reindexing once at the end of the burst is enough.
   */
  private scheduleMaterialize (): void {
    // Ripristino in corso: si materializza una volta sola alla fine (vedi restoreBackup)
    // EN: Restore in progress: materialize just once at the end (see restoreBackup)
    if (this.bulkWriting) { this.bulkPending = true; return }
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.materialize().catch((err) => this.log(`errore di indicizzazione: ${err.message}`))
    }, this.opts.materializeDelayMs ?? 250)
  }

  /**
   * Ricostruisce indice ed export dalla vista. Le chiamate sono serializzate sulla catena
   * `materializing`, così due ricostruzioni non si sovrappongono mai.
   *
   * EN: Rebuilds the index and export from the view. Calls are serialized on the
   * `materializing` chain, so two rebuilds never overlap.
   */
  /**
   * Costellazione, galassie e grado dei nodi (serve all'attivazione), ricalcolati in sottofondo
   * dopo un aggiornamento, raggruppando le scritture ravvicinate: con migliaia di ricordi costano
   * e non devono rallentare la scrittura. Un grado vecchio di qualche secondo non cambia la ricerca.
   *
   * EN: Constellation, galaxies and node degrees (needed for activation), recomputed in the background
   * after an update, grouping close writes: with thousands of memories they're costly
   * and must not slow down writing. A degree a few seconds old doesn't change search.
   */
  private scheduleGraph (delayMs = DEGREES_DELAY_MS): void {
    if (this.degreesTimer) return
    this.degreesTimer = setTimeout(() => {
      this.degreesTimer = null
      if (!this.team) return
      // In un timer un'eccezione non gestita fermerebbe tutto il daemon: qui si registra e basta
      // EN: In a timer an unhandled exception would stop the whole daemon: here we just log it
      try {
        const t0 = Date.now()
        this.computeGraph()
        if (Date.now() - t0 > SLOW_MATERIALIZE_MS) this.log(`costellazione e galassie ricalcolate in ${Date.now() - t0} ms (${this.graphCache?.nodes.length} ricordi)`)
        this.changed('memories')
      } catch (err) {
        this.log(`costellazione non calcolata: ${(err as Error).message}`)
      }
    }, delayMs)
    this.degreesTimer.unref()
  }

  /** @param force ricalcola anche se la versione della vista non è cambiata (ricordi personali, riconnessione) / EN: recompute even if the view version didn't change (personal memories, reconnection) */
  private materialize (force = false): Promise<void> {
    this.materializing = this.materializing.catch(() => {}).then(async () => {
      const team = this.team
      if (!team) return
      // Una scrittura produce due richieste di aggiornamento (la sync esplicita e l'evento "vista
      // cambiata" di Autobase): la seconda non trova nulla di nuovo e si salta
      // EN: A write produces two update requests (the explicit sync and Autobase's "view
      //     changed" event): the second finds nothing new and is skipped
      if (!force && team.viewVersion === this.materializedVersion) return
      this.materializedVersion = team.viewVersion
      // Tempi per fase: finiscono nel log solo se l'aggiornamento è lento (vedi in fondo)
      // EN: Per-phase timings: they go to the log only if the update is slow (see below)
      const lap = phaseTimer()
      const [all, members, votes, pins, usage, links, roots, useful, coUse, acks] = await Promise.all([team.memories(), team.members(), team.votes(), team.pins(), team.usage(), team.links(), team.roots(), team.useful(), team.coUse(), team.redactAcks()])
      this.usefulCounts = useful
      this.coUsePairs = coUse
      lap('vista')
      this.rootsById = roots
      this.teamNameCache = (await team.team())?.name ?? this.teamNameCache
      // Solo i ricordi ATTIVI entrano in ricerca, costellazione ed export; gli altri sono storico.
      // Ricordi ripristinati da un backup (B7): contano con la data d'ORIGINE, così un ricordo
      // vecchio non torna "nuovo" (attivazione, ordinamenti, riepiloghi)
      // EN: Only ACTIVE memories go into search, constellation and export; the others are history.
      //     Memories restored from a backup (B7) count with their ORIGINAL date, so an old memory
      //     doesn't become "new" again (activation, sorting, digests)
      for (let i = 0; i < all.length; i++) { const o = all[i].source?.origin?.ts; if (o) all[i] = { ...all[i], ts: o } }
      const memories = all.filter((m) => (m.status ?? 'active') === 'active')
      // B12: fatica per l'attivazione (anche dove il chiamante conosce solo tipo e data)
      // EN: B12: effort for activation (also where the caller only knows kind and date)
      this.effortById = new Map(memories.filter((m) => m.source?.effort).map((m) => [m.id, m.source!.effort!.score]))
      this.inactive = all.filter((m) => (m.status ?? 'active') !== 'active')
      this.dreamLinks = links
      // Nell'indice anche i ricordi personali (B4), così ricerca e agenti li trovano insieme a quelli
      // del team; restano fuori da export, costellazione, dreaming e metriche (vedi teamMemories).
      // EN: Personal memories (B4) go into the index too, so search and agents find them together with the
      //     team's; they stay out of export, constellation, dreaming and metrics (see teamMemories).
      const teamIds = new Set(memories.map((m) => m.id))
      const personal = this.personalRecords(team.localKey ?? '').filter((p) => !teamIds.has(p.id))
      this.personalIds = new Set(personal.map((p) => p.id))
      this.index.rebuild([...memories, ...personal], members, { votes, pins, usage })
      lap('indice')
      writeExport(this.paths.export, memories, members)
      lap('export')
      // B12: indice ed export sono già senza i redatti; si ripulisce il resto e si conferma
      // EN: B12: index and export are already free of redacted ones; clean the rest and confirm
      this.confirmRedactions(this.inactive, acks)
      // Costellazione, galassie e collegamenti per ricordo: in sottofondo, fuori dalla scrittura.
      // Intanto graph() restituisce la versione precedente (vecchia di pochi secondi): la UI riceve
      // "memories" quando quella nuova è pronta e la ricarica.
      // EN: Constellation, galaxies and per-memory links: in the background, outside the write.
      //     Meanwhile graph() returns the previous version (a few seconds old): the UI receives
      //     "memories" when the new one is ready and reloads it.
      this.graphStale = true
      this.scheduleGraph()
      const slow = lap.report(SLOW_MATERIALIZE_MS)
      if (slow) this.log(`aggiornamento della vista lento (${memories.length} ricordi): ${slow}`)
      this.scheduleEmbedding()
      this.changed('memories', 'members', 'status')
      // B4: i file per gli agenti seguono le Radici (si riscrivono solo se cambiano davvero)
      // EN: B4: agent files follow the Roots (rewritten only if they really change)
      if (this.config.agentFiles.length) this.refreshAgentFiles().catch((err) => this.log(`file per gli agenti: ${err.message}`))
    })
    return this.materializing
  }

  /** true se la cartella di lavoro va a questo team (vedi MicelioNodeOptions.owns). / EN: true if the working folder goes to this team (see MicelioNodeOptions.owns). */
  private ownsFolder (dir: string): boolean {
    return this.opts.owns ? this.opts.owns(dir) : true
  }

  /**
   * Lega il feed di questo nodo all'identità personale (B3), se non è già fatto: pubblica
   * `member.identity` con la firma. Serve anche ai team creati prima di B3, che al primo avvio
   * ricevono il legame. Errori solo nel log: il team funziona anche senza.
   *
   * EN: Binds this node's feed to the personal identity (B3), if not done already: publishes
   * `member.identity` with the signature. It also serves teams created before B3, which get
   * the binding at first start. Errors only in the log: the team works without it too.
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
   *
   * EN: Admin actions are rejected here already, as well as in apply. Reason: apply checks
   * permissions in the linearized order, and an action issued by a member CONCURRENTLY with their
   * promotion could be ordered after the promotion and therefore accepted (DESIGN §9).
   * Before deciding we sync, to have the most up-to-date role possible.
   */
  private async requireAdmin (): Promise<void> {
    await this.sync()
    if ((await this.status()).role !== 'admin') throw new UserError('Operazione riservata agli admin del team', 'Only team admins can do this')
  }

  /**
   * Creare e togliere Radici: a tutti, salvo «Radici solo per gli admin» (vedi ROOTS_ADMIN_ONLY
   * in apply.ts). Il controllo vero è in apply; qui si dà subito un errore chiaro.
   *
   * EN: Creating and removing Roots: open to all, unless "Roots for admins only" (see
   * ROOTS_ADMIN_ONLY in apply.ts). The real check is in apply; here we give a clear error right away.
   */
  private async canManageRoots (): Promise<boolean> {
    if ((await this.requireTeam().config(ROOTS_ADMIN_ONLY)) !== true) return true
    return (await this.status()).role === 'admin'
  }

  private async requireRootsRight (): Promise<void> {
    if (!(await this.canManageRoots())) throw new UserError('In questo team solo gli admin creano e tolgono le Radici: chiedi a un admin', 'In this team only admins create and remove Roots: ask an admin')
  }

  private assertNotConfigured (): void {
    if (this.team || loadState(this.paths)) throw new UserError('Questo nodo appartiene già a un team', 'This node already belongs to a team')
  }

  /**
   * Trova un membro attivo per nome esatto o per chiave (anche abbreviata, almeno 6 caratteri).
   *
   * EN: Finds an active member by exact name or by key (short keys too, at least 6 characters).
   * @throws UserError se nessuno o più di uno corrisponde
   *         EN: if none or more than one matches
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

/** Crea l'embedder indicato in configurazione; null se "none". Il modello è condiviso da tutti i nodi della macchina. / EN: Creates the embedder set in the configuration; null if "none". The model is shared by all nodes on the machine. */
export function createEmbedder (config: Config): Embedder | null {
  switch (config.embeddings.adapter) {
    case 'local': return new LocalEmbedder(config.embeddings.model, path.join(os.homedir(), '.cache', 'micelio-models'))
    case 'hash': return new HashEmbedder()
    default: return null
  }
}

/** Crea l'adapter LLM indicato in configurazione; null se "none". / EN: Creates the LLM adapter set in the configuration; null if "none". */
export function createAdapter (config: Config): LlmAdapter | null {
  switch (config.llm.adapter) {
    case 'claude': return new ClaudeCliAdapter(config.llm.command)
    case 'fake': return new FakeAdapter()
    default: return null
  }
}

/** Dimensione di un file in byte (0 se non esiste). / EN: Size of a file in bytes (0 if it doesn't exist). */
function fileSize (file: string): number {
  try { return fs.statSync(file).size } catch { return 0 }
}

/** Dimensione totale di una cartella, ricorsiva (0 se non esiste). / EN: Total size of a folder, recursive (0 if it doesn't exist). */
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
 *
 * EN: Roots are long, general texts: for "Relevant Roots" the semantic threshold is lower
 * than for normal searches (multiplied by this factor).
 */
const ROOT_SEMANTIC_FACTOR = 0.85

/** Percorso di file confrontabile: barre "/", senza "./" iniziale, minuscolo. / EN: Comparable file path: "/" slashes, no leading "./", lowercase. */
function normFile (f: string): string {
  return f.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}
