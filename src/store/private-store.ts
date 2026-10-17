// Archivio PRIVATO del nodo (DESIGN §5.3): non è un Hypercore, quindi non può finire in rete.
// Contiene la coda dei lavori di ingestione, l'inbox dei casi dubbi, il registro delle decisioni
// private e il contatore del budget LLM.
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { MemoryData } from '../core/events'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  memory TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created INTEGER NOT NULL,
  source TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT NOT NULL,
  preview TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS session_progress (session_id TEXT PRIMARY KEY, lines INTEGER NOT NULL, updated INTEGER NOT NULL);
`

export const INBOX_TTL_MS = 14 * 24 * 60 * 60 * 1000

export interface SourceRef { type: string, ref?: string, cwd?: string }

export interface Job { id: number, kind: string, payload: any, status: string, attempts: number, error: string | null, created: number }
export interface InboxItem { id: string, created: number, expires: number, source: SourceRef, reason: string, memory: MemoryData }
/** Esiti registrati localmente: cosa NON è andato al team e perché. */
export type DecisionOutcome = 'blocked' | 'private' | 'discarded' | 'rejected' | 'expired'
export interface Decision { id: number, created: number, source: SourceRef, outcome: DecisionOutcome, reason: string, preview: string }

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)

export class PrivateStore {
  private db: DatabaseSync

  constructor (file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(SCHEMA)
  }

  close (): void { this.db.close() }

  // ---------- Coda lavori ----------

  enqueue (kind: string, payload: unknown): number {
    const now = Date.now()
    const r = this.db.prepare('INSERT INTO jobs (kind, payload, created, updated) VALUES (?, ?, ?, ?)').run(kind, JSON.stringify(payload), now, now)
    return Number(r.lastInsertRowid)
  }

  nextJob (now = Date.now()): Job | null {
    const r = this.db.prepare("SELECT * FROM jobs WHERE status = 'pending' AND next_attempt <= ? ORDER BY id LIMIT 1").get(now) as any
    return r ? { ...r, payload: JSON.parse(r.payload) } : null
  }

  finishJob (id: number): void {
    this.db.prepare("UPDATE jobs SET status = 'done', error = NULL, updated = ? WHERE id = ?").run(Date.now(), id)
  }

  /** Rimette il lavoro in coda per più tardi; se `countAttempt`, dopo 3 tentativi lo marca fallito. */
  retryJob (id: number, error: string, delayMs: number, countAttempt = true): void {
    const now = Date.now()
    this.db.prepare(`UPDATE jobs SET attempts = attempts + ?, error = ?, next_attempt = ?, updated = ?,
      status = CASE WHEN attempts + ? >= 3 THEN 'failed' ELSE 'pending' END WHERE id = ?`)
      .run(countAttempt ? 1 : 0, error, now + delayMs, now, countAttempt ? 1 : 0, id)
  }

  jobStats (): Record<string, number> {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all() as any[]
    return Object.fromEntries(rows.map((r) => [r.status, r.n]))
  }

  recentJobs (limit = 20): Job[] {
    return (this.db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit) as any[]).map((r) => ({ ...r, payload: JSON.parse(r.payload) }))
  }

  // ---------- Inbox ----------

  addInbox (memory: MemoryData, source: SourceRef, reason: string, now = Date.now()): InboxItem {
    const item: InboxItem = { id: randomBytes(4).toString('hex'), created: now, expires: now + INBOX_TTL_MS, source, reason, memory }
    this.db.prepare('INSERT INTO inbox (id, created, expires, source, reason, memory) VALUES (?, ?, ?, ?, ?, ?)')
      .run(item.id, item.created, item.expires, JSON.stringify(source), reason, JSON.stringify(memory))
    return item
  }

  listInbox (): InboxItem[] {
    return (this.db.prepare('SELECT * FROM inbox ORDER BY created').all() as any[]).map(rowToInbox)
  }

  getInbox (id: string): InboxItem | null {
    const r = this.db.prepare('SELECT * FROM inbox WHERE id = ?').get(id) as any
    return r ? rowToInbox(r) : null
  }

  removeInbox (id: string): void {
    this.db.prepare('DELETE FROM inbox WHERE id = ?').run(id)
  }

  /** Rimuove gli elementi scaduti e li registra come decisioni "expired". */
  sweepInbox (now = Date.now()): number {
    const expired = (this.db.prepare('SELECT * FROM inbox WHERE expires <= ?').all(now) as any[]).map(rowToInbox)
    for (const i of expired) {
      this.logDecision(i.source, 'expired', 'scaduto senza decisione', i.memory.title)
      this.removeInbox(i.id)
    }
    return expired.length
  }

  // ---------- Decisioni private ----------

  logDecision (source: SourceRef, outcome: DecisionOutcome, reason: string, preview: string): void {
    this.db.prepare('INSERT INTO decisions (created, source, outcome, reason, preview) VALUES (?, ?, ?, ?, ?)')
      .run(Date.now(), JSON.stringify(source), outcome, reason, preview.replace(/\s+/g, ' ').slice(0, 120))
  }

  listDecisions (limit = 50): Decision[] {
    return (this.db.prepare('SELECT * FROM decisions ORDER BY id DESC LIMIT ?').all(limit) as any[])
      .map((r) => ({ ...r, source: JSON.parse(r.source) }))
  }

  // ---------- Budget LLM ----------

  callsToday (now = Date.now()): number {
    const r = this.db.prepare('SELECT calls FROM llm_usage WHERE day = ?').get(today(now)) as any
    return r?.calls ?? 0
  }

  countCall (now = Date.now()): void {
    this.db.prepare('INSERT INTO llm_usage (day, calls) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET calls = calls + 1').run(today(now))
  }

  // ---------- Avanzamento sessioni ----------

  sessionLines (sessionId: string): number {
    const r = this.db.prepare('SELECT lines FROM session_progress WHERE session_id = ?').get(sessionId) as any
    return r?.lines ?? 0
  }

  setSessionLines (sessionId: string, lines: number): void {
    this.db.prepare(`INSERT INTO session_progress (session_id, lines, updated) VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET lines = excluded.lines, updated = excluded.updated`).run(sessionId, lines, Date.now())
  }
}

function rowToInbox (r: any): InboxItem {
  return { id: r.id, created: r.created, expires: r.expires, source: JSON.parse(r.source), reason: r.reason, memory: JSON.parse(r.memory) }
}
