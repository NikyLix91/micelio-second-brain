/**
 * @file Client tipizzato dell'API locale del daemon (stesse rotte usate dalla CLI).
 *
 * I tipi dei dati sono importati direttamente dal codice del daemon (`import type`): vengono
 * cancellati in compilazione, quindi la UI non include codice del daemon, ma se una forma cambia
 * da una parte TypeScript lo segnala anche dall'altra.
 *
 * Ogni funzione corrisponde a una rotta di src/daemon/api.controller.ts.
 */
import type { CodeRefs, MemoryData } from '../../../src/core/events'
import type { InviteRecord, MemberRecord, NodeStatus, RecallHit } from '../../../src/core/model'
import type { ExplicitOutcome } from '../../../src/ingest/pipeline'
import type { DistillQuality } from '../../../src/ingest/quality'
import type { Graph, GraphLink, GraphNode } from '../../../src/graph/constellation'
import type { GapView, IngestStatus, NetworkSettings, NodeSettings, RootReviewResult, RootView, SecurityFinding, SecurityRules, SecurityTestResult, StorageReport } from '../../../src/node/micelio-node'
import type { Digest } from '../../../src/insight/digest'
import type { NetworkCheck } from '../../../src/net/diagnose'
import type { Decision, InboxItem, SecurityLogEntry } from '../../../src/store/private-store'
import type { TeamSummary } from '../../../src/node/micelio-host'
import { getToken } from './auth'
import { TEAM_HEADER, teamHeaders } from './team'
import { currentLang } from '../i18n'

export type { DistillQuality, Graph, GraphLink, GraphNode }
export type { NetworkCheck, NetworkSettings, RootReviewResult, RootView, SecurityFinding, SecurityLogEntry, SecurityRules, SecurityTestResult, StorageReport }
export type { Digest, GapView }

/** Rete di un team: DHT pubblica, privata, o nessuna rete (solo locale, B4). */
export type NetworkMode = NetworkSettings['mode']
/** Formato dei file per gli agenti (B4). */
export type AgentFileFormat = 'claude' | 'agents' | 'cursor'
/** Una tua ricerca senza risposta (B4). */
export interface MyGap { key: string, query: string, count: number, first: number, last: number, answer: { id: string, title: string } | null }
export type { CodeRefs, Decision, ExplicitOutcome, InboxItem, IngestStatus, InviteRecord, MemberRecord, MemoryData, NodeSettings, NodeStatus, RecallHit, TeamSummary }

/** Elenco dei team del PC e identità personale (GET /api/teams, B3). */
export interface TeamsInfo { teams: TeamSummary[], identity: { name: string, publicKey: string } | null }

/** Errore dell'API con il messaggio leggibile restituito dal daemon. */
export class ApiError extends Error {
  constructor (message: string, readonly status: number) { super(message) }
}

/**
 * Chiamata generica all'API con il token, sul team scelto nel selettore (B3, vedi api/team.ts).
 * @param team team diverso da quello scelto (es. i membri degli altri team nella pagina Team)
 * @throws ApiError con il messaggio `{ error }` del daemon (es. "Operazione riservata agli admin")
 */
export async function call<T> (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, team?: string): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      authorization: `Bearer ${getToken() ?? ''}`,
      // Lingua dei messaggi d'errore del daemon (vedi src/daemon/error.filter.ts)
      'x-micelio-lang': currentLang(),
      ...(team ? { [TEAM_HEADER]: team } : teamHeaders()),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({})) as any
  if (!res.ok) {
    const msg: string = data?.error ?? `Errore HTTP ${res.status}`
    // Rotta sconosciuta al daemon: l'interfaccia è più nuova del daemon in esecuzione (ricompilato
    // ma non riavviato). Al posto del "Cannot GET /api/…" di Express, diciamo cosa fare.
    if (res.status === 404 && /^Cannot (GET|POST|PUT|DELETE) \/api\//.test(msg)) {
      throw new ApiError(currentLang() === 'it'
        ? 'Questa funzione richiede un daemon aggiornato: il daemon in esecuzione è una versione precedente dell\'app. Riavvialo (micelio stop && micelio start; per il team demo: Ctrl+C e npm run demo).'
        : 'This feature needs an updated daemon: the running daemon is an older version of the app. Restart it (micelio stop && micelio start; for the demo team: Ctrl+C and npm run demo).', 404)
    }
    throw new ApiError(msg, res.status)
  }
  return data as T
}

const enc = encodeURIComponent

/** Tutte le operazioni disponibili, raggruppate come le schermate. */
export const api = {
  // Nodo e team
  status: () => call<NodeStatus>('GET', '/api/status'),
  // Nome facoltativo dal secondo team in poi: il daemon usa quello dell'identità personale (B3)
  init: (team: string, name?: string, network?: 'public' | 'local') => call<NodeStatus & { teamId: string }>('POST', '/api/team/init', { team, name: name || undefined, network }),
  join: (code: string, name?: string) => call<NodeStatus & { teamId: string }>('POST', '/api/team/join', { code, name: name || undefined }),

  // Più team sullo stesso PC (B3)
  teams: () => call<TeamsInfo>('GET', '/api/teams'),
  setDefaultTeam: (id: string) => call<TeamSummary[]>('POST', `/api/teams/${enc(id)}/default`),
  leaveTeam: (id: string) => call<TeamSummary[]>('DELETE', `/api/teams/${enc(id)}`),
  /** Membri di un team qualsiasi del PC (per riconoscere la stessa persona in più team). */
  membersOf: (team: string) => call<MemberRecord[]>('GET', '/api/members', undefined, team),
  /** Collega Claude Code avviato in una cartella al team scelto (MCP in ambito "local"). */
  setupProject: (path: string) => call<{ dir: string, mcpUrl: string }>('POST', '/api/setup/project', { path }),
  teamConfig: () => call<{ language: string, blockKeywords: string[], maxMemories: number, updateOnWrite: boolean }>('GET', '/api/team/config'),
  distillQuality: () => call<DistillQuality>('GET', '/api/distill/quality'),
  setTeamConfig: (key: string, value: unknown) => call<{ ok: true }>('POST', '/api/team/config', { key, value }),
  members: () => call<MemberRecord[]>('GET', '/api/members'),
  removeMember: (key: string) => call<MemberRecord>('POST', `/api/members/${enc(key)}/remove`),
  promoteMember: (key: string) => call<MemberRecord>('POST', `/api/members/${enc(key)}/promote`),
  invite: () => call<{ code: string, expires: number, replicated: boolean }>('POST', '/api/invites'),
  invites: () => call<InviteRecord[]>('GET', '/api/invites'),

  // Ricordi
  graph: () => call<Graph>('GET', '/api/graph'),
  memory: (id: string) => call<RecallHit>('GET', `/api/memories/${enc(id)}`),
  recent: (limit = 30) => call<RecallHit[]>('GET', `/api/memories?limit=${limit}`),
  search: (q: string, limit = 20) => call<RecallHit[]>('GET', `/api/memories/search?q=${enc(q)}&limit=${limit}`),
  remember: (m: { title: string, body: string, kind?: string, tags?: string[] }) => call<ExplicitOutcome>('POST', '/api/memories', m),

  // Ricordi personali (B4): restano su questo PC
  rememberPersonal: (m: { title: string, body: string, kind?: string, tags?: string[] }) => call<{ id: string, duplicate: boolean }>('POST', '/api/memories', { ...m, personal: true }),
  personal: () => call<RecallHit[]>('GET', '/api/personal'),
  sharePersonal: (id: string) => call<ExplicitOutcome>('POST', `/api/personal/${enc(id)}/share`),
  deletePersonal: (id: string) => call<{ ok: true }>('DELETE', `/api/personal/${enc(id)}`),
  keepPersonal: (inboxId: string) => call<{ id: string, duplicate: boolean }>('POST', `/api/inbox/${enc(inboxId)}/keep`),

  // Ricordi con il codice cambiato (B4)
  staleMemories: () => call<RecallHit[]>('GET', '/api/memories/stale'),
  checkStale: () => call<{ checked: number, stale: number }>('POST', '/api/memories/stale/check'),

  // Lacune e riepilogo (B4)
  myGaps: () => call<MyGap[]>('GET', '/api/gaps/mine'),
  dismissGap: (key: string) => call<{ ok: true }>('DELETE', `/api/gaps/mine/${enc(key)}`),
  reportGap: (key: string, question?: string) => call<GapView[]>('POST', '/api/gaps/report', { key, question }),
  teamGaps: () => call<GapView[]>('GET', '/api/gaps'),
  closeGap: (id: string, memory?: string) => call<GapView[]>('POST', `/api/gaps/${enc(id)}/close`, { memory }),
  digest: (days = 7) => call<Digest>('GET', `/api/digest?days=${days}`),

  // File per gli agenti e import di Radici (B4)
  agentFiles: () => call<{ dir: string, format: AgentFileFormat, project: string, file: string, exists: boolean }[]>('GET', '/api/roots/agent-files'),
  exportAgentFile: (o: { dir: string, format: AgentFileFormat, project?: string, keep?: boolean }) => call<{ file: string, changed: boolean }>('POST', '/api/roots/agent-files', o),
  removeAgentFile: (dir: string, format: AgentFileFormat) => call<{ ok: true }>('DELETE', '/api/roots/agent-files', { dir, format }),
  importRoots: (path: string, category?: string) => call<{ imported: number, duplicates: number, blocked: string[] }>('POST', '/api/roots/import', { path, category }),

  // Inbox e privato
  inbox: () => call<InboxItem[]>('GET', '/api/inbox'),
  approve: (id: string, patch: { title?: string, body?: string } = {}) => call<{ id: string, memory: MemoryData }>('POST', `/api/inbox/${enc(id)}/approve`, patch),
  reject: (id: string) => call<{ ok: true }>('POST', `/api/inbox/${enc(id)}/reject`),
  decisions: (limit = 200) => call<Decision[]>('GET', `/api/decisions?limit=${limit}`),

  // Ingestione e impostazioni
  ingestStatus: () => call<IngestStatus>('GET', '/api/ingest/status'),
  ingestRun: () => call<{ processed: boolean }>('POST', '/api/ingest/run'),
  settings: () => call<NodeSettings>('GET', '/api/settings'),
  updateLlm: (patch: { classifyModel?: string, distillModel?: string, dailyBudget?: number }) => call<NodeSettings>('PUT', '/api/settings/llm', patch),
  documents: () => call<{ folders: { path: string, shareable: boolean, roots?: boolean }[], stats: Record<string, number> }>('GET', '/api/documents'),
  documentsAdd: (path: string, shareable: boolean, roots = false) => call<{ path: string, shareable: boolean, roots: boolean }[]>('POST', '/api/documents/folders', { path, shareable, roots }),
  documentsRemove: (path: string) => call<unknown>('DELETE', '/api/documents/folders', { path }),
  vote: (id: string, delta: -1 | 0 | 1) => call<RecallHit>('POST', `/api/memories/${enc(id)}/vote`, { delta }),
  pin: (id: string, pinned: boolean) => call<RecallHit>(pinned ? 'POST' : 'DELETE', `/api/memories/${enc(id)}/pin`),
  fetchSource: (id: string) => call<{ path: string, name: string, size: number, local: boolean }>('POST', `/api/memories/${enc(id)}/source`),
  watchAdd: (path: string) => call<string[]>('POST', '/api/watch', { path }),
  watchRemove: (path: string) => call<string[]>('DELETE', '/api/watch', { path }),
  setupClaudeCode: (hook: boolean, context = true) => call<{ mcpUrl: string, hookFile: string | null }>('POST', '/api/setup/claude-code', { hook, context }),
  updateContext: (patch: { sessionStart?: boolean, prompt?: boolean, maxChars?: number }) => call<NodeSettings>('PUT', '/api/settings/context', patch),

  // Sicurezza (Fase 9)
  securityRules: () => call<SecurityRules>('GET', '/api/security/rules'),
  setSecurityRules: (patch: Partial<SecurityRules['team']>) => call<SecurityRules>('PUT', '/api/security/rules', patch),
  securityTest: (text: string, file?: string) => call<SecurityTestResult>('POST', '/api/security/test', { text, file }),
  securityScan: () => call<SecurityFinding[]>('GET', '/api/security/scan'),
  securityClean: (id: string) => call<{ id: string }>('POST', `/api/security/clean/${enc(id)}`),
  securityLog: (limit = 100) => call<SecurityLogEntry[]>('GET', `/api/security/log?limit=${limit}`),

  // Radici (Fase 8)
  roots: (filter: { project?: string, category?: string, q?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString()
    return call<RootView[]>('GET', `/api/roots${qs ? '?' + qs : ''}`)
  },
  rootSet: (id: string, category: string) => call<RootView>('POST', `/api/roots/${enc(id)}`, { category }),
  rootUnset: (id: string) => call<{ ok: true }>('DELETE', `/api/roots/${enc(id)}`),
  rootConfirm: (id: string) => call<RootView>('POST', `/api/roots/${enc(id)}/confirm`),
  rootReview: (ids?: string[]) => call<RootReviewResult>('POST', '/api/roots/review', { ids }),
  rootSuggestions: () => call<{ id: string, category: string, title: string, created: number }[]>('GET', '/api/roots/suggestions'),
  dismissRootSuggestion: (id: string) => call<{ ok: true }>('DELETE', `/api/roots/suggestions/${enc(id)}`),

  // Rete P2P e spazio occupato
  network: () => call<NetworkSettings>('GET', '/api/network'),
  setNetwork: (mode: NetworkMode, bootstrap?: string[]) => call<NetworkSettings>('PUT', '/api/network', { mode, bootstrap }),
  checkNetwork: (mode?: NetworkMode, bootstrap?: string[]) => call<NetworkCheck>('POST', '/api/network/check', { mode, bootstrap }),
  storage: () => call<StorageReport>('GET', '/api/storage')
}
