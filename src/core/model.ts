// Forma dei record nella vista materializzata (Hyperbee) e nelle risposte delle API.
import type { MemoryKind } from './events'

export type Role = 'admin' | 'member'

export interface MemoryRecord {
  id: string
  kind: MemoryKind
  title: string
  body: string
  tags: string[]
  source: { type: string, ref?: string }
  author: string // chiave del nodo autore
  ts: number
  status: 'active'
}

export interface MemberRecord {
  key: string
  name: string
  role: Role
  invitedBy: string | null
  removed: boolean
  joinedAt: number
}

export interface InviteRecord {
  id: string
  publicKey: string
  expires: number
  by: string
}

export interface TeamRecord {
  name: string
  founder: string
  createdAt: number
}

export interface RecallHit {
  id: string
  kind: MemoryKind
  title: string
  body: string
  tags: string[]
  author: string
  authorName: string | null
  ts: number
  score: number
}

export interface NodeStatus {
  configured: boolean
  nodeName: string | null
  nodeKey: string | null
  team: TeamRecord | null
  writable: boolean
  indexer: boolean
  role: Role | null
  peers: number
  members: number
  memories: number
}
