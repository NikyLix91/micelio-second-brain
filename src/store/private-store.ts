/**
 * @file Archivio PRIVATO del nodo (DESIGN §5.3), file private.db.
 *
 * EN: PRIVATE store of the node (DESIGN §5.3), file private.db.
 *
 * È un normale database SQLite locale, NON un Hypercore: per costruzione non può finire in rete.
 * Contiene:
 * - jobs:             coda persistente dei lavori di ingestione (sopravvive ai riavvii);
 * - inbox:            ricordi dubbi in attesa di una decisione dell'utente (D9);
 * - decisions:        registro di ciò che NON è andato al team e perché (bloccato, privato…);
 * - llm_usage:        chiamate LLM per giorno, per il budget (D8);
 * - session_progress: fin dove è già stata elaborata ogni sessione di Claude Code.
 *
 * EN: It is a plain local SQLite database, NOT a Hypercore: by design it cannot end up on the network. It
 * contains:
 * - jobs:             persistent queue of ingestion jobs (survives restarts);
 * - inbox:            doubtful memories waiting for a user decision (D9);
 * - decisions:        log of what did NOT go to the team and why (blocked, private…);
 * - llm_usage:        LLM calls per day, for the budget (D8);
 * - session_progress: how far each Claude Code session has already been processed.
 *
 * Nota privacy: il registro delle decisioni conserva un'anteprima di 120 caratteri. Resta sulla
 * macchina dell'utente, come le trascrizioni di Claude Code da cui proviene.
 *
 * EN: Privacy note: the decision log keeps a 120-character preview. It stays on the user's machine, like the
 * Claude Code transcripts it comes from.
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
-- Fase 5: uso locale dei ricordi (contatori cumulativi) e quanto è già stato pubblicato al team.
CREATE TABLE IF NOT EXISTS usage_local (id TEXT PRIMARY KEY, count INTEGER NOT NULL, last INTEGER NOT NULL, reported INTEGER NOT NULL DEFAULT 0);
-- Registro di sicurezza (Fase 9): cosa il filtro ha tolto, da dove, di che tipo. MAI il valore.
CREATE TABLE IF NOT EXISTS security_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, source_type TEXT NOT NULL, source_ref TEXT, label TEXT NOT NULL, kinds TEXT NOT NULL, omitted TEXT NOT NULL);
-- Radici suggerite dal distillatore (Fase 8): restano qui finché l'utente non le promuove o le ignora.
CREATE TABLE IF NOT EXISTS root_suggestions (id TEXT PRIMARY KEY, category TEXT NOT NULL, title TEXT NOT NULL, created INTEGER NOT NULL);
-- B4: ricordi PERSONALI. Restano su questo PC, compaiono nelle ricerche accanto a quelli del team.
CREATE TABLE IF NOT EXISTS personal (id TEXT PRIMARY KEY, memory TEXT NOT NULL, created INTEGER NOT NULL);
-- B4: ricerche esplicite senza risultato (lacune di conoscenza). Testo già redatto dal filtro.
CREATE TABLE IF NOT EXISTS search_misses (key TEXT PRIMARY KEY, query TEXT NOT NULL, count INTEGER NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open');
-- B4: quanto i file citati da un ricordo sono cambiati dopo la sua scrittura (repository di questo PC).
CREATE TABLE IF NOT EXISTS code_staleness (id TEXT PRIMARY KEY, commits INTEGER NOT NULL, missing INTEGER NOT NULL, checked INTEGER NOT NULL);
-- B11: efficacia. Ogni richiesta di un agente a Micelio (tool MCP o contesto automatico) e cosa
-- ha ricevuto: id completi dei ricordi in JSON, tempo di risposta. Solo su questo PC.
CREATE TABLE IF NOT EXISTS consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, channel TEXT NOT NULL, query TEXT, project TEXT, session TEXT, ids TEXT NOT NULL, ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS consultations_ts ON consultations(ts);
-- B11: esito di un ricordo fornito in una sessione: 'likely' (euristica), 'used' | 'ignored' |
-- 'wrong' (LLM, che prevale), 'none' (euristica: nessuna traccia d'uso). voted = pollice dato.
CREATE TABLE IF NOT EXISTS outcomes (session TEXT NOT NULL, memory TEXT NOT NULL, verdict TEXT NOT NULL, judge TEXT NOT NULL, evidence TEXT, project TEXT, ts INTEGER NOT NULL, voted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (session, memory));
CREATE INDEX IF NOT EXISTS outcomes_ts ON outcomes(ts);
-- B11: volte in cui un ricordo è stato UTILE (confermato dall'LLM), contatori cumulativi pubblicati al team.
CREATE TABLE IF NOT EXISTS useful_local (id TEXT PRIMARY KEY, count INTEGER NOT NULL, last INTEGER NOT NULL, reported INTEGER NOT NULL DEFAULT 0);
-- B12: sinapsi d'uso. Coppie di ricordi serviti nella stessa sessione (a < b): contatori cumulativi
-- pubblicati al team (couse.report). couse_sessions ricorda le coppie già contate per sessione,
-- così una sessione elaborata a pezzi conta ogni coppia una volta sola.
CREATE TABLE IF NOT EXISTS couse_local (a TEXT NOT NULL, b TEXT NOT NULL, count INTEGER NOT NULL, last INTEGER NOT NULL, reported INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (a, b));
CREATE TABLE IF NOT EXISTS couse_sessions (session TEXT NOT NULL, a TEXT NOT NULL, b TEXT NOT NULL, PRIMARY KEY (session, a, b));
-- B10: chat sulla memoria. Conversazioni e messaggi restano su questo PC (decisione dell'utente).
-- data (JSON): per le risposte, ricordi citati, mappa, "non lo so"; per le domande nulla.
CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, data TEXT, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS chat_messages_chat ON chat_messages(chat, id);
`

/** Dopo quanto un elemento non deciso esce dall'inbox (D9). / EN: How long an undecided item stays in the Inbox (D9). */
export const INBOX_TTL_MS = 14 * 24 * 60 * 60 * 1000

/** Da dove arriva un contenuto: tipo di sorgente, riferimento opaco (es. id sessione), cartella. / EN: Where a piece of content comes from: source type, opaque reference (e.g. session id), folder. */
export interface SourceRef { type: string, ref?: string, cwd?: string }

/** Un lavoro in coda. `payload` dipende da `kind` (oggi solo "session"). / EN: A queued job. `payload` depends on `kind` (today only "session"). */
export interface Job { id: number, kind: string, payload: any, status: string, attempts: number, error: string | null, created: number }
/** Un ricordo in attesa di decisione. `memory` è già redatto dal filtro. / EN: A memory waiting for a decision. `memory` is already redacted by the filter. */
/** Un documento di una cartella sorvegliata e il suo stato di elaborazione. / EN: A document of a watched folder and its processing state. */
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

/** Una richiesta di un agente a Micelio (B11): canale, domanda, ricordi restituiti, tempo. / EN: An agent request to Micelio (B11): channel, question, returned memories, time. */
export interface Consultation {
  id: number
  ts: number
  /** recall | architecture | get | fetch_source | session-start | prompt / EN: recall | architecture | get | fetch_source | session-start | prompt */
  channel: string
  query: string | null
  project: string | null
  session: string | null
  /** Id completi dei ricordi restituiti. / EN: Full ids of the returned memories. */
  ids: string[]
  /** Tempo di risposta del daemon, in millisecondi. / EN: Daemon response time, in milliseconds. */
  ms: number
}

/** Esito di un ricordo fornito: vedi la tabella `outcomes`. / EN: Outcome of a provided memory: see the `outcomes` table. */
export type OutcomeVerdict = 'likely' | 'none' | 'used' | 'ignored' | 'wrong'
export interface Outcome { session: string, memory: string, verdict: OutcomeVerdict, judge: 'heuristic' | 'llm', evidence: string | null, project: string | null, ts: number, voted: boolean }

/** Una conversazione della chat (B10). / EN: A chat conversation (B10). */
export interface ChatSummary { id: number, title: string, created: number, updated: number, questions: number }
/** Un messaggio della chat: domanda dell'utente o risposta (con i dati della risposta). / EN: A chat message: user question or answer (with the answer data). */
export interface ChatMessage { id: number, chat: number, role: 'user' | 'assistant', text: string, data: any, ts: number }

/** Voce del registro di sicurezza (vedi addSecurityLog). / EN: Security log entry (see addSecurityLog). */
export interface SecurityLogEntry {
  id: number
  ts: number
  source: SourceRef
  /** Descrizione del contenuto (es. prima domanda della sessione, nome del documento). / EN: Description of the content (e.g. first question of the session, document name). */
  label: string
  /** Redazioni per tipo, es. { "secret:jwt": 2 }. / EN: Redactions by type, e.g. { "secret:jwt": 2 }. */
  kinds: Record<string, number>
  /** File sensibili il cui contenuto è stato tolto per intero. / EN: Sensitive files whose content was removed entirely. */
  omitted: string[]
}

export interface InboxItem { id: string, created: number, expires: number, source: SourceRef, reason: string, memory: MemoryData }
/** Esiti registrati localmente: cosa NON è andato al team e perché. / EN: Outcomes logged locally: what did NOT go to the team and why. */
export type DecisionOutcome = 'blocked' | 'private' | 'discarded' | 'rejected' | 'expired'
/** Una riga del registro delle decisioni private. / EN: A row of the private decision log. */
export interface Decision { id: number, created: number, source: SourceRef, outcome: DecisionOutcome, reason: string, preview: string }

/** Giorno UTC "AAAA-MM-GG", chiave del budget giornaliero. / EN: UTC day "YYYY-MM-DD", key of the daily budget. */
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)

export class PrivateStore {
  private db: DatabaseSync

  constructor (file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    // WAL + synchronous=NORMAL: senza, ogni scrittura aspettava il disco (~10 ms su Windows) e la
    // registrazione delle consultazioni degli agenti (B11) rallentava ogni risposta. Resta coerente
    // anche se il processo cade; con un'interruzione di corrente si perdono al massimo le ultime
    // scritture (l'indice si ricostruisce comunque dal log del team).
    // EN: WAL + synchronous=NORMAL: without them every write waited for the disk (~10 ms on Windows) and
    //     logging agent queries (B11) slowed down every reply. It stays consistent even if the process crashes;
    //     on a power failure we lose at most the last writes (the index is rebuilt from the team log anyway).
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
    this.db.exec(SCHEMA)
  }

  close (): void { this.db.close() }

  // ---------- Coda lavori ----------
  // EN: Job queue

  /** Accoda un lavoro; restituisce il suo id. / EN: Queues a job; returns its id. */
  enqueue (kind: string, payload: unknown): number {
    const now = Date.now()
    const r = this.db.prepare('INSERT INTO jobs (kind, payload, created, updated) VALUES (?, ?, ?, ?)').run(kind, JSON.stringify(payload), now, now)
    return Number(r.lastInsertRowid)
  }

  /** Il lavoro più vecchio pronto per essere eseguito (pending e con next_attempt passato). / EN: The oldest job ready to run (pending, with next_attempt in the past). */
  nextJob (now = Date.now()): Job | null {
    const r = this.db.prepare("SELECT * FROM jobs WHERE status = 'pending' AND next_attempt <= ? ORDER BY id LIMIT 1").get(now) as any
    return r ? { ...r, payload: JSON.parse(r.payload) } : null
  }

  /** Id delle sessioni con un lavoro ancora in coda (per non accodarle due volte). / EN: Ids of sessions with a job still queued (so we don't queue them twice). */
  pendingSessionIds (): Set<string> {
    const rows = this.db.prepare("SELECT payload FROM jobs WHERE kind = 'session' AND status = 'pending'").all() as any[]
    return new Set(rows.map((r) => JSON.parse(r.payload).sessionId as string))
  }

  /** Segna un lavoro come completato. / EN: Marks a job as completed. */
  finishJob (id: number): void {
    this.db.prepare("UPDATE jobs SET status = 'done', error = NULL, updated = ? WHERE id = ?").run(Date.now(), id)
  }

  /** Rimette il lavoro in coda per più tardi; se `countAttempt`, dopo 3 tentativi lo marca fallito. / EN: Puts the job back in the queue for later; if `countAttempt`, it is marked failed after 3 attempts. */
  retryJob (id: number, error: string, delayMs: number, countAttempt = true): void {
    const now = Date.now()
    this.db.prepare(`UPDATE jobs SET attempts = attempts + ?, error = ?, next_attempt = ?, updated = ?,
      status = CASE WHEN attempts + ? >= 3 THEN 'failed' ELSE 'pending' END WHERE id = ?`)
      .run(countAttempt ? 1 : 0, error, now + delayMs, now, countAttempt ? 1 : 0, id)
  }

  /** Conteggio dei lavori per stato, es. { pending: 2, done: 10 }. / EN: Job count by status, e.g. { pending: 2, done: 10 }. */
  jobStats (): Record<string, number> {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all() as any[]
    return Object.fromEntries(rows.map((r) => [r.status, r.n]))
  }

  /** Gli ultimi lavori, dal più recente (diagnostica e futura UI). / EN: The latest jobs, newest first (diagnostics and future UI). */
  recentJobs (limit = 20): Job[] {
    return (this.db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit) as any[]).map((r) => ({ ...r, payload: JSON.parse(r.payload) }))
  }

  // ---------- Inbox ----------
  // EN: Inbox

  /** Mette un ricordo in inbox con il motivo; scade dopo INBOX_TTL_MS. / EN: Puts a memory in the Inbox with the reason; it expires after INBOX_TTL_MS. */
  addInbox (memory: MemoryData, source: SourceRef, reason: string, now = Date.now()): InboxItem {
    const item: InboxItem = { id: randomBytes(4).toString('hex'), created: now, expires: now + INBOX_TTL_MS, source, reason, memory }
    this.db.prepare('INSERT INTO inbox (id, created, expires, source, reason, memory) VALUES (?, ?, ?, ?, ?, ?)')
      .run(item.id, item.created, item.expires, JSON.stringify(source), reason, JSON.stringify(memory))
    return item
  }

  /** Elementi in inbox, dal più vecchio. / EN: Inbox items, oldest first. */
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

  /** Rimuove gli elementi scaduti e li registra come decisioni "expired". / EN: Removes expired items and logs them as "expired" decisions. */
  sweepInbox (now = Date.now()): number {
    const expired = (this.db.prepare('SELECT * FROM inbox WHERE expires <= ?').all(now) as any[]).map(rowToInbox)
    for (const i of expired) {
      this.logDecision(i.source, 'expired', 'scaduto senza decisione', i.memory.title)
      this.removeInbox(i.id)
    }
    return expired.length
  }

  // ---------- Decisioni private ----------
  // EN: Private decisions

  /** Registra un contenuto che non è andato al team. L'anteprima è compattata a 120 caratteri. / EN: Logs content that did not go to the team. The preview is compacted to 120 characters. */
  logDecision (source: SourceRef, outcome: DecisionOutcome, reason: string, preview: string): void {
    this.db.prepare('INSERT INTO decisions (created, source, outcome, reason, preview) VALUES (?, ?, ?, ?, ?)')
      .run(Date.now(), JSON.stringify(source), outcome, reason, preview.replace(/\s+/g, ' ').slice(0, 120))
  }

  /** Ultime decisioni, dalla più recente. / EN: Latest decisions, newest first. */
  listDecisions (limit = 50): Decision[] {
    return (this.db.prepare('SELECT * FROM decisions ORDER BY id DESC LIMIT ?').all(limit) as any[])
      .map((r) => ({ ...r, source: JSON.parse(r.source) }))
  }

  // ---------- Budget LLM ----------
  // EN: LLM budget

  /** Chiamate LLM già fatte oggi. / EN: LLM calls already made today. */
  callsToday (now = Date.now()): number {
    const r = this.db.prepare('SELECT calls FROM llm_usage WHERE day = ?').get(today(now)) as any
    return r?.calls ?? 0
  }

  /** Conta una chiamata LLM (upsert sulla riga del giorno). / EN: Counts one LLM call (upsert on the day's row). */
  countCall (now = Date.now()): void {
    this.db.prepare('INSERT INTO llm_usage (day, calls) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET calls = calls + 1').run(today(now))
  }

  // ---------- Documenti ----------
  // EN: Documents

  /** Stato di un documento per percorso, o null se mai visto. / EN: State of a document by path, or null if never seen. */
  getDocument (file: string): DocumentRecord | null {
    const r = this.db.prepare('SELECT * FROM documents WHERE path = ?').get(file) as any
    return r ? rowToDocument(r) : null
  }

  // ── Registro di sicurezza (Fase 9) ─────────────────────────────────────────────
  // EN: Security log (Phase 9)

  /**
   * Registra cosa il filtro ha tolto da un contenuto. Si salvano solo TIPI e conteggi (es.
   * { "secret:github-token": 1 }) e i NOMI dei file sensibili omessi: mai i valori.
   *
   * EN: Logs what the filter removed from a piece of content. Only TYPES and counts are saved (e.g. {
   * "secret:github-token": 1 }) plus the NAMES of the omitted sensitive files: never the values.
   */
  addSecurityLog (e: { source: SourceRef, label: string, kinds: Record<string, number>, omitted: string[] }, now = Date.now()): void {
    this.db.prepare('INSERT INTO security_log (ts, source_type, source_ref, label, kinds, omitted) VALUES (?, ?, ?, ?, ?, ?)')
      .run(now, e.source.type, e.source.ref ?? null, e.label.slice(0, 200), JSON.stringify(e.kinds), JSON.stringify(e.omitted))
  }

  /** Voci del registro di sicurezza, dalla più recente. / EN: Security log entries, newest first. */
  securityLog (limit = 200): SecurityLogEntry[] {
    return (this.db.prepare('SELECT * FROM security_log ORDER BY id DESC LIMIT ?').all(limit) as any[]).map((r) => ({
      id: r.id, ts: r.ts, source: { type: r.source_type, ref: r.source_ref ?? undefined }, label: r.label, kinds: JSON.parse(r.kinds), omitted: JSON.parse(r.omitted)
    }))
  }

  // ── Ricordi personali (B4) ─────────────────────────────────────────────────────
  // EN: Personal memories (B4)

  /** Salva un ricordo personale (già redatto). Lo stesso contenuto due volte resta uno. / EN: Saves a personal memory (already redacted). The same content saved twice stays one. */
  addPersonal (id: string, memory: MemoryData, now = Date.now()): boolean {
    return this.db.prepare('INSERT OR IGNORE INTO personal (id, memory, created) VALUES (?, ?, ?)').run(id, JSON.stringify(memory), now).changes > 0
  }

  /** Tutti i ricordi personali, dal più recente. / EN: All personal memories, newest first. */
  personal (): { id: string, memory: MemoryData, created: number }[] {
    return (this.db.prepare('SELECT id, memory, created FROM personal ORDER BY created DESC').all() as any[])
      .map((r) => ({ id: r.id, memory: JSON.parse(r.memory) as MemoryData, created: r.created }))
  }

  removePersonal (id: string): void {
    this.db.prepare('DELETE FROM personal WHERE id = ?').run(id)
  }

  // ── Lacune di conoscenza (B4) ──────────────────────────────────────────────────
  // EN: Knowledge gaps (B4)

  /**
   * Registra una ricerca senza risultato. Ricerche uguali a meno di maiuscole, punteggiatura e
   * ordine delle parole (`key`) si sommano. Una lacuna ignorata resta ignorata.
   *
   * EN: Logs a search with no result. Searches that are equal apart from case, punctuation and word order
   * (`key`) are summed. A dismissed knowledge gap stays dismissed.
   */
  addSearchMiss (key: string, query: string, now = Date.now()): void {
    this.db.prepare(`INSERT INTO search_misses (key, query, count, first, last) VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(key) DO UPDATE SET count = count + 1, last = excluded.last, query = excluded.query`).run(key, query, now, now)
  }

  /** Lacune per stato, dalle più frequenti. / EN: Knowledge gaps by status, most frequent first. */
  searchMisses (status: 'open' | 'dismissed' | 'reported' = 'open', limit = 100): { key: string, query: string, count: number, first: number, last: number, status: string }[] {
    return this.db.prepare('SELECT key, query, count, first, last, status FROM search_misses WHERE status = ? ORDER BY count DESC, last DESC LIMIT ?').all(status, limit) as any[]
  }

  setSearchMissStatus (key: string, status: 'open' | 'dismissed' | 'reported'): void {
    this.db.prepare('UPDATE search_misses SET status = ? WHERE key = ?').run(status, key)
  }

  // ── Ricordi che invecchiano con il codice (B4) ─────────────────────────────────
  // EN: Memories that age with the code (B4)

  setStaleness (id: string, commits: number, missing: number, now = Date.now()): void {
    this.db.prepare('INSERT OR REPLACE INTO code_staleness (id, commits, missing, checked) VALUES (?, ?, ?, ?)').run(id, commits, missing, now)
  }

  /** Ricordo → commit successivi sui file citati e file scomparsi. / EN: Memory → later commits on the cited files and missing files. */
  staleness (): Map<string, { commits: number, missing: number, checked: number }> {
    const out = new Map<string, { commits: number, missing: number, checked: number }>()
    for (const r of this.db.prepare('SELECT id, commits, missing, checked FROM code_staleness').all() as any[]) out.set(r.id, { commits: r.commits, missing: r.missing, checked: r.checked })
    return out
  }

  // ── Radici suggerite (Fase 8) ──────────────────────────────────────────────────
  // EN: Suggested Roots (Phase 8)

  /** Registra un suggerimento (lo stesso ricordo suggerito due volte resta uno). / EN: Records a suggestion (the same memory suggested twice stays one). */
  addRootSuggestion (id: string, category: string, title: string, now = Date.now()): void {
    this.db.prepare('INSERT OR IGNORE INTO root_suggestions (id, category, title, created) VALUES (?, ?, ?, ?)').run(id, category, title, now)
  }

  /** Suggerimenti in attesa, dal più recente. / EN: Pending suggestions, newest first. */
  rootSuggestions (): { id: string, category: string, title: string, created: number }[] {
    return this.db.prepare('SELECT id, category, title, created FROM root_suggestions ORDER BY created DESC').all() as any[]
  }

  /** Toglie un suggerimento (promosso o ignorato). / EN: Removes a suggestion (promoted or ignored). */
  removeRootSuggestion (id: string): void {
    this.db.prepare('DELETE FROM root_suggestions WHERE id = ?').run(id)
  }

  /** Tutti i documenti noti (anche rimossi): usati dalla revisione delle Radici. / EN: All known documents (removed ones too): used by the Roots review. */
  allDocuments (): DocumentRecord[] {
    return (this.db.prepare('SELECT * FROM documents').all() as any[]).map(rowToDocument)
  }

  /** Documenti con un certo contenuto (hash), ancora presenti sul disco. / EN: Documents with a given content (hash) that are still on disk. */
  documentsByHash (hash: string): DocumentRecord[] {
    return (this.db.prepare("SELECT * FROM documents WHERE hash = ? AND status != 'removed'").all(hash) as any[]).map(rowToDocument)
  }

  /** Crea o aggiorna lo stato di un documento. / EN: Creates or updates the state of a document. */
  saveDocument (d: Omit<DocumentRecord, 'updated'>): void {
    this.db.prepare(`INSERT INTO documents (path, hash, size, folder, status, chunks_done, memories, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, size = excluded.size, folder = excluded.folder, status = excluded.status,
      chunks_done = excluded.chunks_done, memories = excluded.memories, updated = excluded.updated`)
      .run(d.path, d.hash, d.size, d.folder, d.status, d.chunksDone, d.memories, Date.now())
  }

  /** Conteggio dei documenti per stato (per la UI). / EN: Document count by status (for the UI). */
  documentStats (): Record<string, number> {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM documents GROUP BY status').all() as any[]
    return Object.fromEntries(rows.map((r) => [r.status, r.n]))
  }

  // ---------- Uso locale (Fase 5) ----------
  // EN: Local usage (Phase 5)

  /** Conta un uso dei ricordi indicati (es. restituiti da una ricerca). / EN: Counts one use of the given memories (e.g. returned by a search). */
  countUsage (ids: string[], now = Date.now()): void {
    const up = this.db.prepare('INSERT INTO usage_local (id, count, last) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = count + 1, last = excluded.last')
    for (const id of ids) up.run(id, now)
  }

  /** Contatori cumulativi non ancora pubblicati (count > reported). / EN: Cumulative counters not yet published (count > reported). */
  unreportedUsage (): Record<string, { count: number, last: number }> {
    const rows = this.db.prepare('SELECT id, count, last FROM usage_local WHERE count > reported').all() as any[]
    return Object.fromEntries(rows.map((r) => [r.id, { count: r.count, last: r.last }]))
  }

  /** Segna come pubblicati i contatori inviati. / EN: Marks the sent counters as published. */
  markUsageReported (counts: Record<string, { count: number }>): void {
    const up = this.db.prepare('UPDATE usage_local SET reported = ? WHERE id = ?')
    for (const [id, c] of Object.entries(counts)) up.run(c.count, id)
  }

  // ---------- Efficacia (B11) ----------
  // EN: Effectiveness (B11)

  /** Registra una richiesta di un agente a Micelio. @returns id della consultazione / EN: Records an agent request to Micelio. @returns the query id */
  addConsultation (c: { channel: string, query?: string | null, project?: string | null, session?: string | null, ids: string[], ms: number }, now = Date.now()): Consultation {
    const r = this.db.prepare('INSERT INTO consultations (ts, channel, query, project, session, ids, ms) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(now, c.channel, c.query ?? null, c.project ?? null, c.session ?? null, JSON.stringify(c.ids), Math.round(c.ms))
    return { id: Number(r.lastInsertRowid), ts: now, channel: c.channel, query: c.query ?? null, project: c.project ?? null, session: c.session ?? null, ids: c.ids, ms: Math.round(c.ms) }
  }

  /** Consultazioni dal più recente, a partire da `since`. / EN: Queries newest first, starting from `since`. */
  consultations (since = 0, limit = 5000): Consultation[] {
    return (this.db.prepare('SELECT * FROM consultations WHERE ts >= ? ORDER BY ts DESC LIMIT ?').all(since, limit) as any[])
      .map((r) => ({ id: r.id, ts: r.ts, channel: r.channel, query: r.query, project: r.project, session: r.session, ids: JSON.parse(r.ids), ms: r.ms }))
  }

  /**
   * Esito di un ricordo fornito in una sessione. Il giudizio dell'LLM prevale sull'euristica: un
   * esito euristico non sovrascrive mai quello dell'LLM.
   *
   * EN: Outcome of a memory provided in a session. The LLM verdict wins over the heuristic: a heuristic
   * outcome never overwrites the LLM one.
   * @returns true se l'esito è nuovo o cambiato
   *          EN: true if the outcome is new or changed
   */
  setOutcome (o: { session: string, memory: string, verdict: OutcomeVerdict, judge: 'heuristic' | 'llm', evidence?: string | null, project?: string | null }, now = Date.now()): boolean {
    const prev = this.db.prepare('SELECT verdict, judge FROM outcomes WHERE session = ? AND memory = ?').get(o.session, o.memory) as any
    if (prev && prev.judge === 'llm' && o.judge === 'heuristic') return false
    if (prev && prev.verdict === o.verdict && prev.judge === o.judge) return false
    this.db.prepare(`INSERT INTO outcomes (session, memory, verdict, judge, evidence, project, ts) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session, memory) DO UPDATE SET verdict = excluded.verdict, judge = excluded.judge, evidence = excluded.evidence, project = COALESCE(excluded.project, project), ts = excluded.ts`)
      .run(o.session, o.memory, o.verdict, o.judge, o.evidence ?? null, o.project ?? null, now)
    return true
  }

  /** Esiti dal più recente, a partire da `since`. / EN: Outcomes newest first, starting from `since`. */
  outcomes (since = 0, limit = 5000): Outcome[] {
    return (this.db.prepare('SELECT * FROM outcomes WHERE ts >= ? ORDER BY ts DESC LIMIT ?').all(since, limit) as any[])
      .map((r) => ({ session: r.session, memory: r.memory, verdict: r.verdict, judge: r.judge, evidence: r.evidence, project: r.project, ts: r.ts, voted: !!r.voted }))
  }

  /**
   * Solo ricordo ed esito, dal più VECCHIO: è ciò che serve all'abituazione (B12,
   * src/rank/habituation.ts). Leggero anche con decine di migliaia di righe (due colonne, indice su ts).
   *
   * EN: Only memory and verdict, OLDEST first: it's what habituation needs (B12,
   * src/rank/habituation.ts). Light even with tens of thousands of rows (two columns, index on ts).
   */
  outcomeVerdicts (since = 0): { memory: string, verdict: OutcomeVerdict }[] {
    return this.db.prepare('SELECT memory, verdict FROM outcomes WHERE ts >= ? ORDER BY ts ASC').all(since) as any[]
  }

  /** Il pollice in su automatico per questo esito è stato dato (o deciso di non darlo). / EN: The automatic thumbs-up for this outcome was given (or we decided not to give it). */
  markOutcomeVoted (session: string, memory: string): void {
    this.db.prepare('UPDATE outcomes SET voted = 1 WHERE session = ? AND memory = ?').run(session, memory)
  }

  /** Un ricordo è stato utile (confermato): contatore cumulativo da pubblicare al team. / EN: A memory was useful (confirmed): cumulative counter to publish to the team. */
  countUseful (id: string, now = Date.now()): void {
    this.db.prepare('INSERT INTO useful_local (id, count, last) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = count + 1, last = excluded.last').run(id, now)
  }

  unreportedUseful (): Record<string, { count: number, last: number }> {
    const rows = this.db.prepare('SELECT id, count, last FROM useful_local WHERE count > reported').all() as any[]
    return Object.fromEntries(rows.map((r) => [r.id, { count: r.count, last: r.last }]))
  }

  markUsefulReported (counts: Record<string, { count: number }>): void {
    const up = this.db.prepare('UPDATE useful_local SET reported = ? WHERE id = ?')
    for (const [id, c] of Object.entries(counts)) up.run(c.count, id)
  }

  /**
   * Ricordi serviti in una sessione ("usato" o "probabilmente utile"), prima quelli confermati
   * dall'LLM e poi i più recenti: è l'ordine con cui si scelgono le coppie (B12).
   *
   * EN: Memories that helped in a session ("used" or "probably useful"), the ones confirmed by the
   * LLM first and then the most recent: it's the order used to pick the pairs (B12).
   */
  sessionUseful (session: string): string[] {
    return (this.db.prepare("SELECT memory FROM outcomes WHERE session = ? AND verdict IN ('used', 'likely') ORDER BY verdict = 'used' DESC, ts DESC").all(session) as any[]).map((r) => r.memory)
  }

  /**
   * Conta le coppie di una sessione (B12), ognuna una volta sola per sessione.
   *
   * EN: Counts a session's pairs (B12), each only once per session.
   * @param pairs coppie [a, b] con a < b
   *        EN: pairs [a, b] with a < b
   * @returns quante coppie erano nuove per la sessione
   *          EN: how many pairs were new for the session
   */
  countCoUse (session: string, pairs: [string, string][], now = Date.now()): number {
    const seen = this.db.prepare('INSERT OR IGNORE INTO couse_sessions (session, a, b) VALUES (?, ?, ?)')
    const up = this.db.prepare('INSERT INTO couse_local (a, b, count, last) VALUES (?, ?, 1, ?) ON CONFLICT(a, b) DO UPDATE SET count = count + 1, last = excluded.last')
    let added = 0
    // Una transazione: le coppie di una sessione si contano tutte o nessuna
    // EN: One transaction: a session's pairs are counted all or none
    this.db.exec('BEGIN')
    try {
      for (const [a, b] of pairs) {
        if (Number(seen.run(session, a, b).changes) === 0) continue
        up.run(a, b, now)
        added++
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return added
  }

  /** Coppie con contatori non ancora pubblicati, chiave "a:b". / EN: Pairs with counters not yet published, key "a:b". */
  unreportedCoUse (): Record<string, { count: number, last: number }> {
    const rows = this.db.prepare('SELECT a, b, count, last FROM couse_local WHERE count > reported').all() as any[]
    return Object.fromEntries(rows.map((r) => [`${r.a}:${r.b}`, { count: r.count, last: r.last }]))
  }

  markCoUseReported (counts: Record<string, { count: number }>): void {
    const up = this.db.prepare('UPDATE couse_local SET reported = ? WHERE a = ? AND b = ?')
    for (const [pair, c] of Object.entries(counts)) {
      const [a, b] = pair.split(':')
      up.run(c.count, a, b)
    }
  }

  /** Toglie consultazioni ed esiti più vecchi di `before` (conservazione: vedi EFFICACY_KEEP_MS). / EN: Removes queries and outcomes older than `before` (retention: see EFFICACY_KEEP_MS). */
  pruneEfficacy (before: number): void {
    this.db.prepare('DELETE FROM consultations WHERE ts < ?').run(before)
    this.db.prepare('DELETE FROM outcomes WHERE ts < ?').run(before)
  }

  // ---------- Chat sulla memoria (B10) ----------
  // EN: Chat over the memory (B10)

  /** Nuova conversazione; il titolo iniziale è la prima domanda. / EN: New conversation; the initial title is the first question. */
  createChat (title: string, now = Date.now()): number {
    return Number(this.db.prepare('INSERT INTO chats (title, created, updated) VALUES (?, ?, ?)').run(title.slice(0, 120), now, now).lastInsertRowid)
  }

  /** Conversazioni dalla più recente. / EN: Conversations, newest first. */
  chats (): ChatSummary[] {
    return (this.db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM chat_messages m WHERE m.chat = c.id AND m.role = 'user') AS questions
      FROM chats c ORDER BY updated DESC`).all() as any[]).map((r) => ({ id: r.id, title: r.title, created: r.created, updated: r.updated, questions: r.questions }))
  }

  /** Messaggi di una conversazione, in ordine. / EN: Messages of a conversation, in order. */
  chatMessages (chat: number): ChatMessage[] {
    return (this.db.prepare('SELECT * FROM chat_messages WHERE chat = ? ORDER BY id').all(chat) as any[])
      .map((r) => ({ id: r.id, chat: r.chat, role: r.role, text: r.text, data: r.data ? JSON.parse(r.data) : null, ts: r.ts }))
  }

  /**
   * Redazione (B12): le risposte della chat che citavano o mostravano il ricordo (nei riferimenti o
   * nella mappa mentale) perdono testo e dati; restano come segnaposto `{ redacted: true }`, che la
   * UI mostra nella lingua dell'utente. Le domande restano: sono testo dell'utente.
   *
   * EN: Redaction (B12): chat answers that cited or showed the memory (in the references or in the
   * mind map) lose their text and data; they stay as a `{ redacted: true }` placeholder, which the UI
   * shows in the user's language. Questions stay: they're the user's own text.
   * @returns risposte ripulite
   *          EN: answers cleaned
   */
  redactChats (memoryId: string): number {
    return Number(this.db.prepare(`UPDATE chat_messages SET text = '[contenuto rimosso]', data = '{"redacted":true}'
      WHERE role = 'assistant' AND data LIKE ? AND data NOT LIKE '{"redacted":true}'`).run(`%${memoryId}%`).changes)
  }

  chatMessage (id: number): ChatMessage | null {
    const r = this.db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as any
    return r ? { id: r.id, chat: r.chat, role: r.role, text: r.text, data: r.data ? JSON.parse(r.data) : null, ts: r.ts } : null
  }

  /** Aggiunge un messaggio e aggiorna la data della conversazione. @returns id del messaggio / EN: Adds a message and updates the conversation date. @returns the message id */
  addChatMessage (chat: number, role: 'user' | 'assistant', text: string, data: unknown = null, now = Date.now()): number {
    const id = Number(this.db.prepare('INSERT INTO chat_messages (chat, role, text, data, ts) VALUES (?, ?, ?, ?, ?)').run(chat, role, text, data === null ? null : JSON.stringify(data), now).lastInsertRowid)
    this.db.prepare('UPDATE chats SET updated = ? WHERE id = ?').run(now, chat)
    return id
  }

  /** Aggiorna i dati di un messaggio (es. ricordo salvato dalla risposta). / EN: Updates a message's data (e.g. memory saved from the answer). */
  setChatMessageData (id: number, data: unknown): void {
    this.db.prepare('UPDATE chat_messages SET data = ? WHERE id = ?').run(JSON.stringify(data), id)
  }

  renameChat (id: number, title: string): void {
    this.db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title.slice(0, 120), id)
  }

  deleteChat (id: number): void {
    this.db.prepare('DELETE FROM chat_messages WHERE chat = ?').run(id)
    this.db.prepare('DELETE FROM chats WHERE id = ?').run(id)
  }

  // ---------- Avanzamento sessioni ----------
  // EN: Session progress

  /** Righe della trascrizione già elaborate per una sessione (0 se mai vista). / EN: Transcript lines already processed for a session (0 if never seen). */
  sessionLines (sessionId: string): number {
    const r = this.db.prepare('SELECT lines FROM session_progress WHERE session_id = ?').get(sessionId) as any
    return r?.lines ?? 0
  }

  /** Aggiorna fin dove è stata elaborata una sessione. / EN: Updates how far a session has been processed. */
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
