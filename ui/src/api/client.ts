/**
 * @file Client tipizzato dell'API locale del daemon (stesse rotte usate dalla CLI).
 *
 * I tipi dei dati sono importati direttamente dal codice del daemon (`import type`): vengono
 * cancellati in compilazione, quindi la UI non include codice del daemon, ma se una forma cambia
 * da una parte TypeScript lo segnala anche dall'altra.
 *
 * Ogni funzione corrisponde a una rotta di src/daemon/api.controller.ts.
 */
import type { MemoryData } from '../../../src/core/events'
import type { InviteRecord, MemberRecord, NodeStatus, RecallHit } from '../../../src/core/model'
import type { ExplicitOutcome } from '../../../src/ingest/pipeline'
import type { Graph, GraphLink, GraphNode } from '../../../src/graph/constellation'
import type { IngestStatus, NodeSettings } from '../../../src/node/micelio-node'
import type { Decision, InboxItem } from '../../../src/store/private-store'
import { getToken } from './auth'

export type { Graph, GraphLink, GraphNode }
export type { Decision, ExplicitOutcome, InboxItem, IngestStatus, InviteRecord, MemberRecord, MemoryData, NodeSettings, NodeStatus, RecallHit }

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
  if (!res.ok) throw new ApiError(data?.error ?? `Errore HTTP ${res.status}`, res.status)
  return data as T
}

const enc = encodeURIComponent

/** Tutte le operazioni disponibili, raggruppate come le schermate. */
export const api = {
  // Nodo e team
  status: () => call<NodeStatus>('GET', '/api/status'),
  init: (team: string, name: string) => call<NodeStatus>('POST', '/api/team/init', { team, name }),
  join: (code: string, name: string) => call<NodeStatus>('POST', '/api/team/join', { code, name }),
  teamConfig: () => call<{ language: string, blockKeywords: string[] }>('GET', '/api/team/config'),
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
  documents: () => call<{ folders: { path: string, shareable: boolean }[], stats: Record<string, number> }>('GET', '/api/documents'),
  documentsAdd: (path: string, shareable: boolean) => call<{ path: string, shareable: boolean }[]>('POST', '/api/documents/folders', { path, shareable }),
  documentsRemove: (path: string) => call<unknown>('DELETE', '/api/documents/folders', { path }),
  fetchSource: (id: string) => call<{ path: string, name: string, size: number, local: boolean }>('POST', `/api/memories/${enc(id)}/source`),
  watchAdd: (path: string) => call<string[]>('POST', '/api/watch', { path }),
  watchRemove: (path: string) => call<string[]>('DELETE', '/api/watch', { path }),
  setupClaudeCode: (hook: boolean) => call<{ mcpUrl: string, hookFile: string | null }>('POST', '/api/setup/claude-code', { hook })
}
