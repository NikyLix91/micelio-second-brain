/**
 * @file Archivio PRIVATO del nodo (DESIGN §5.3), file private.db.
 *
 * È un normale database SQLite locale, NON un Hypercore: per costruzione non può finire in rete.
 * Contiene:
 * - jobs:             coda persistente dei lavori di ingestione (sopravvive ai riavvii);
 * - inbox:            ricordi dubbi in attesa di una decisione dell'utente (D9);
 * - decisions:        registro di ciò che NON è andato al team e perché (bloccato, privato…);
 * - llm_usage:        chiamate LLM per giorno, per il budget (D8);
 * - session_progress: fin dove è già stata elaborata ogni sessione di Claude Code.
 *
 * Nota privacy: il registro delle decisioni conserva un'anteprima di 120 caratteri. Resta sulla
 * macchina dell'utente, come le trascrizioni di Claude Code da cui proviene.
 */
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
-- Documenti delle cartelle sorvegliate (Fase 4): stato di elaborazione per percorso.
CREATE TABLE IF NOT EXISTS documents (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  folder TEXT NOT NULL,
  status TEXT NOT NULL,          -- queued | done | blocked | failed | removed
  chunks_done INTEGER NOT NULL DEFAULT 0,
  memories INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_hash ON documents(hash);
`

/** Dopo quanto un elemento non deciso esce dall'inbox (D9). */
export const INBOX_TTL_MS = 14 * 24 * 60 * 60 * 1000

/** Da dove arriva un contenuto: tipo di sorgente, riferimento opaco (es. id sessione), cartella. */
export interface SourceRef { type: string, ref?: string, cwd?: string }

/** Un lavoro in coda. `payload` dipende da `kind` (oggi solo "session"). */
export interface Job { id: number, kind: string, payload: any, status: string, attempts: number, error: string | null, created: number }
/** Un ricordo in attesa di decisione. `memory` è già redatto dal filtro. */
/** Un documento di una cartella sorvegliata e il suo stato di elaborazione. */
export interface DocumentRecord {
  path: string
  hash: string
  size: number
  folder: string
  status: 'queued' | 'done' | 'blocked' | 'failed' | 'removed'
  chunksDone: number
  memories: number
  updated: number
}

export interface InboxItem { id: string, created: number, expires: number, source: SourceRef, reason: string, memory: MemoryData }
/** Esiti registrati localmente: cosa NON è andato al team e perché. */
export type DecisionOutcome = 'blocked' | 'private' | 'discarded' | 'rejected' | 'expired'
/** Una riga del registro delle decisioni private. */
export interface Decision { id: number, created: number, source: SourceRef, outcome: DecisionOutcome, reason: string, preview: string }

/** Giorno UTC "AAAA-MM-GG", chiave del budget giornaliero. */
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

  /** Accoda un lavoro; restituisce il suo id. */
  enqueue (kind: string, payload: unknown): number {
    const now = Date.now()
    const r = this.db.prepare('INSERT INTO jobs (kind, payload, created, updated) VALUES (?, ?, ?, ?)').run(kind, JSON.stringify(payload), now, now)
    return Number(r.lastInsertRowid)
  }

  /** Il lavoro più vecchio pronto per essere eseguito (pending e con next_attempt passato). */
  nextJob (now = Date.now()): Job | null {
    const r = this.db.prepare("SELECT * FROM jobs WHERE status = 'pending' AND next_attempt <= ? ORDER BY id LIMIT 1").get(now) as any
    return r ? { ...r, payload: JSON.parse(r.payload) } : null
  }

  /** Segna un lavoro come completato. */
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

  /** Conteggio dei lavori per stato, es. { pending: 2, done: 10 }. */
  jobStats (): Record<string, number> {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all() as any[]
    return Object.fromEntries(rows.map((r) => [r.status, r.n]))
  }

  /** Gli ultimi lavori, dal più recente (diagnostica e futura UI). */
  recentJobs (limit = 20): Job[] {
    return (this.db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit) as any[]).map((r) => ({ ...r, payload: JSON.parse(r.payload) }))
  }

  // ---------- Inbox ----------

  /** Mette un ricordo in inbox con il motivo; scade dopo INBOX_TTL_MS. */
  addInbox (memory: MemoryData, source: SourceRef, reason: string, now = Date.now()): InboxItem {
    const item: InboxItem = { id: randomBytes(4).toString('hex'), created: now, expires: now + INBOX_TTL_MS, source, reason, memory }
    this.db.prepare('INSERT INTO inbox (id, created, expires, source, reason, memory) VALUES (?, ?, ?, ?, ?, ?)')
      .run(item.id, item.created, item.expires, JSON.stringify(source), reason, JSON.stringify(memory))
    return item
  }

  /** Elementi in inbox, dal più vecchio. */
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

  /** Registra un contenuto che non è andato al team. L'anteprima è compattata a 120 caratteri. */
  logDecision (source: SourceRef, outcome: DecisionOutcome, reason: string, preview: string): void {
    this.db.prepare('INSERT INTO decisions (created, source, outcome, reason, preview) VALUES (?, ?, ?, ?, ?)')
      .run(Date.now(), JSON.stringify(source), outcome, reason, preview.replace(/\s+/g, ' ').slice(0, 120))
  }

  /** Ultime decisioni, dalla più recente. */
  listDecisions (limit = 50): Decision[] {
    return (this.db.prepare('SELECT * FROM decisions ORDER BY id DESC LIMIT ?').all(limit) as any[])
      .map((r) => ({ ...r, source: JSON.parse(r.source) }))
  }

  // ---------- Budget LLM ----------

  /** Chiamate LLM già fatte oggi. */
  callsToday (now = Date.now()): number {
    const r = this.db.prepare('SELECT calls FROM llm_usage WHERE day = ?').get(today(now)) as any
    return r?.calls ?? 0
  }

  /** Conta una chiamata LLM (upsert sulla riga del giorno). */
  countCall (now = Date.now()): void {
    this.db.prepare('INSERT INTO llm_usage (day, calls) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET calls = calls + 1').run(today(now))
  }

  // ---------- Documenti ----------

  /** Stato di un documento per percorso, o null se mai visto. */
  getDocument (file: string): DocumentRecord | null {
    const r = this.db.prepare('SELECT * FROM documents WHERE path = ?').get(file) as any
    return r ? rowToDocument(r) : null
  }

  /** Documenti con un certo contenuto (hash), ancora presenti sul disco. */
  documentsByHash (hash: string): DocumentRecord[] {
    return (this.db.prepare("SELECT * FROM documents WHERE hash = ? AND status != 'removed'").all(hash) as any[]).map(rowToDocument)
  }

  /** Crea o aggiorna lo stato di un documento. */
  saveDocument (d: Omit<DocumentRecord, 'updated'>): void {
    this.db.prepare(`INSERT INTO documents (path, hash, size, folder, status, chunks_done, memories, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, size = excluded.size, folder = excluded.folder, status = excluded.status,
      chunks_done = excluded.chunks_done, memories = excluded.memories, updated = excluded.updated`)
      .run(d.path, d.hash, d.size, d.folder, d.status, d.chunksDone, d.memories, Date.now())
  }

  /** Conteggio dei documenti per stato (per la UI). */
  documentStats (): Record<string, number> {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM documents GROUP BY status').all() as any[]
    return Object.fromEntries(rows.map((r) => [r.status, r.n]))
  }

  // ---------- Avanzamento sessioni ----------

  /** Righe della trascrizione già elaborate per una sessione (0 se mai vista). */
  sessionLines (sessionId: string): number {
    const r = this.db.prepare('SELECT lines FROM session_progress WHERE session_id = ?').get(sessionId) as any
    return r?.lines ?? 0
  }

  /** Aggiorna fin dove è stata elaborata una sessione. */
  setSessionLines (sessionId: string, lines: number): void {
    this.db.prepare(`INSERT INTO session_progress (session_id, lines, updated) VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET lines = excluded.lines, updated = excluded.updated`).run(sessionId, lines, Date.now())
  }
}

function rowToDocument (r: any): DocumentRecord {
  return { path: r.path, hash: r.hash, size: r.size, folder: r.folder, status: r.status, chunksDone: r.chunks_done, memories: r.memories, updated: r.updated }
}

function rowToInbox (r: any): InboxItem {
  return { id: r.id, created: r.created, expires: r.expires, source: JSON.parse(r.source), reason: r.reason, memory: JSON.parse(r.memory) }
}
