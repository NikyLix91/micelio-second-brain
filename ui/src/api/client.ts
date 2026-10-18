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
import type { IngestStatus, NetworkSettings, NodeSettings, RootReviewResult, RootView, SecurityFinding, SecurityRules, SecurityTestResult, StorageReport } from '../../../src/node/micelio-node'
import type { NetworkCheck } from '../../../src/net/diagnose'
import type { Decision, InboxItem, SecurityLogEntry } from '../../../src/store/private-store'
import { getToken } from './auth'

export type { DistillQuality, Graph, GraphLink, GraphNode }
export type { NetworkCheck, NetworkSettings, RootReviewResult, RootView, SecurityFinding, SecurityLogEntry, SecurityRules, SecurityTestResult, StorageReport }
export type { CodeRefs, Decision, ExplicitOutcome, InboxItem, IngestStatus, InviteRecord, MemberRecord, MemoryData, NodeSettings, NodeStatus, RecallHit }

/** Errore dell'API con il messaggio leggibile restituito dal daemon. */
export class ApiError extends Error {
  constructor (message: string, readonly status: number) { super(message) }
}

/**
 * Chiamata generica all'API con il token.
 * @throws ApiError con il messaggio `{ error }` del daemon (es. "Operazione riservata agli admin")
 */
export async function call<T> (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      authorization: `Bearer ${getToken() ?? ''}`,
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
      throw new ApiError('Questa funzione richiede un daemon aggiornato: il daemon in esecuzione è una versione precedente dell\'app. Riavvialo (micelio stop && micelio start; per il team demo: Ctrl+C e npm run demo).', 404)
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
  init: (team: string, name: string) => call<NodeStatus>('POST', '/api/team/init', { team, name }),
  join: (code: string, name: string) => call<NodeStatus>('POST', '/api/team/join', { code, name }),
  teamConfig: () => call<{ language: string, blockKeywords: string[], maxMemories: number }>('GET', '/api/team/config'),
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
  setupClaudeCode: (hook: boolean) => call<{ mcpUrl: string, hookFile: string | null }>('POST', '/api/setup/claude-code', { hook }),

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
  setNetwork: (mode: 'public' | 'private', bootstrap?: string[]) => call<NetworkSettings>('PUT', '/api/network', { mode, bootstrap }),
  checkNetwork: (mode?: 'public' | 'private', bootstrap?: string[]) => call<NetworkCheck>('POST', '/api/network/check', { mode, bootstrap }),
  storage: () => call<StorageReport>('GET', '/api/storage')
}
