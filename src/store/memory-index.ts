/**
 * @file Indice di ricerca locale sui ricordi del team (DESIGN §4.3, §8.1).
 *
 * EN: Local search index over the team's memories (DESIGN §4.3, §8.1).
 *
 * L'indice è DERIVATO dalla vista replicata: non viene mai sincronizzato, si può cancellare in
 * qualunque momento (file view.db) e viene ricostruito da `MicelioNode.materialize()`.
 *
 * EN: The index is DERIVED from the replicated view: it is never synchronized, it can be deleted
 * at any time (file view.db) and it is rebuilt by `MicelioNode.materialize()`.
 *
 * Tecnologia: `node:sqlite` (integrato in Node ≥ 22.13) con FTS5, il motore full-text di SQLite.
 * Nessuna dipendenza nativa da compilare, quindi funziona uguale su Windows, macOS e Linux.
 *
 * EN: Technology: `node:sqlite` (built into Node ≥ 22.13) with FTS5, SQLite's full-text engine.
 * No native dependency to compile, so it works the same on Windows, macOS and Linux.
 *
 * Struttura:
 * - `memories`      tabella normale con i dati dei ricordi;
 * - `memories_fts`  indice FTS5 "external content" che punta a `memories` tramite rowid
 *                   (non duplica il testo, indicizza solo titolo, corpo e tag);
 * - `members`       nomi dei membri, per mostrare "chi ha scritto" nei risultati.
 *
 * EN: Structure:
 * - `memories`      regular table with the memory data;
 * - `memories_fts`  "external content" FTS5 index pointing to `memories` via rowid
 *                   (it doesn't duplicate the text, it only indexes title, body and tags);
 * - `members`       member names, to show "who wrote it" in the results.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { MemberRecord, MemoryRecord, RecallHit } from '../core/model'

/** Segnali di priorità letti dalla vista (Fase 5). / EN: Priority signals read from the view (Phase 5). */
export interface Signals {
  votes: Map<string, number>
  pins: Set<string>
  usage: Map<string, { count: number, last: number }>
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL,          -- tag separati da spazio, come vengono indicizzati
  author TEXT NOT NULL,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT '{}'  -- JSON: origine del ricordo (tipo, hash, nome file…)
);
-- unicode61 + remove_diacritics 2: "perché" e "perche" coincidono, maiuscole ignorate.
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  title, body, tags,
  content='memories', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS members (key TEXT PRIMARY KEY, name TEXT NOT NULL);
-- Fase 5: vettori di significato (embedding), calcolati in locale. NON vengono cancellati a ogni
-- ricostruzione (calcolarli costa): si eliminano solo quelli di ricordi non più presenti.
CREATE TABLE IF NOT EXISTS vectors (id TEXT PRIMARY KEY, model TEXT NOT NULL, vec BLOB NOT NULL);
-- Fase 5: segnali di priorità del team, copiati dalla vista a ogni ricostruzione.
CREATE TABLE IF NOT EXISTS signals (id TEXT PRIMARY KEY, uses INTEGER NOT NULL, last_used INTEGER, votes INTEGER NOT NULL, pinned INTEGER NOT NULL);
-- Vicini per significato di ogni ricordo (src/rank/semantic-neighbors.ts): salvati man mano, così
-- all'avvio si rileggono invece di ricalcolarli (con 5 000 ricordi il calcolo completo costa secondi).
CREATE TABLE IF NOT EXISTS neighbors (id TEXT PRIMARY KEY, model TEXT NOT NULL, list TEXT NOT NULL);
`

/**
 * Pesi BM25 per colonna, nell'ordine (title, body, tags). Una parola nel titolo vale 3 volte
 * una nel corpo; nei tag 2 volte. Il titolo è scritto apposta per descrivere il ricordo.
 *
 * EN: BM25 weights per column, in order (title, body, tags). A word in the title is worth 3 times
 * one in the body; in the tags, 2 times. The title is written specifically to describe the memory.
 */
const BM25_WEIGHTS = '3.0, 1.0, 2.0'

export class MemoryIndex {
  private db: DatabaseSync
  /**
   * Firma dei segnali di ogni ricordo nell'indice ("usi|ultimo uso|voti|pin"), per riscrivere solo
   * quelli cambiati. null = non ancora letta dal database (prima chiamata di rebuild).
   *
   * EN: Signal signature of each memory in the index ("uses|last use|votes|pin"), to rewrite only
   * the changed ones. null = not yet read from the database (first rebuild call).
   */
  private signalSig: Map<string, string> | null = null
  /**
   * Vettori in memoria per modello: si leggono dal database una volta sola e poi si aggiornano con
   * setVectors e con le rimozioni. Prima ogni ricerca per significato rileggeva tutti i vettori.
   *
   * EN: In-memory vectors per model: read from the database only once, then updated by
   * setVectors and by removals. Before, every semantic search re-read all the vectors.
   */
  private vecCache: { model: string, map: Map<string, Float32Array> } | null = null

  /**
   * @param file percorso del database, oppure ':memory:' (test)
   *             EN: database path, or ':memory:' (tests)
   */
  constructor (file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    // WAL + synchronous=NORMAL: senza, ogni scrittura aspettava il disco (~10 ms su Windows) e la
    // registrazione delle consultazioni degli agenti (B11) rallentava ogni risposta. Resta coerente
    // anche se il processo cade; con un'interruzione di corrente si perdono al massimo le ultime
    // scritture (l'indice si ricostruisce comunque dal log del team).
    // EN: WAL + synchronous=NORMAL: without them every write waited for the disk (~10 ms on Windows)
    //     and logging agent queries (B11) slowed down every response. It stays consistent even if
    //     the process crashes; on a power loss at most the last writes are lost (the index is
    //     rebuilt from the team log anyway).
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
    // L'indice è derivato: se lo schema è cambiato (es. colonna aggiunta in una versione nuova)
    // lo si butta e ricrea, verrà ripopolato dalla vista alla prossima materializzazione.
    // EN: The index is derived: if the schema changed (e.g. a column added in a new version)
    //     it's dropped and recreated, and refilled from the view at the next materialization.
    const cols = (this.db.prepare("SELECT name FROM pragma_table_info('memories')").all() as any[]).map((c) => c.name)
    if (cols.length > 0 && !cols.includes('source')) this.db.exec('DROP TABLE IF EXISTS memories_fts; DROP TABLE IF EXISTS memories;')
    this.db.exec(SCHEMA)
  }

  /**
   * Porta l'indice allo stato attuale della vista, in modo INCREMENTALE.
   *
   * EN: Brings the index up to the current state of the view, INCREMENTALLY.
   *
   * L'id di un ricordo è l'hash del suo contenuto (memoryId): uno stesso id non cambia mai. Basta
   * quindi inserire i ricordi nuovi e togliere quelli usciti (archiviati, sostituiti, redatti),
   * più i segnali cambiati. Prima si cancellava e reinseriva tutto, indice testuale compreso: con
   * 4 000 ricordi circa 300 ms a ogni scrittura; ora il costo dipende da quanto è cambiato.
   * Tutto in una transazione: o l'aggiornamento riesce intero o non cambia nulla.
   *
   * EN: A memory id is the hash of its content (memoryId): a given id never changes. So it's
   * enough to insert the new memories and remove the ones that left (archived, superseded,
   * redacted), plus the changed signals. Before, everything was deleted and reinserted, text
   * index included: with 4,000 memories about 300 ms per write; now the cost depends on how much
   * changed. All in one transaction: either the update succeeds entirely or nothing changes.
   */
  rebuild (memories: MemoryRecord[], members: MemberRecord[], signals?: Signals): void {
    this.db.exec('BEGIN')
    try {
      const present = new Set((this.db.prepare('SELECT id FROM memories').all() as any[]).map((r) => r.id as string))
      const wanted = new Set(memories.map((m) => m.id))

      // Ricordi usciti: prima dall'indice testuale (external content: serve il testo vecchio), poi dai dati
      // EN: Memories that left: first from the text index (external content: it needs the old text), then from the data
      const removed = [...present].filter((id) => !wanted.has(id))
      if (removed.length) {
        const old = this.db.prepare('SELECT rowid, title, body, tags FROM memories WHERE id = ?')
        const delF = this.db.prepare("INSERT INTO memories_fts (memories_fts, rowid, title, body, tags) VALUES ('delete', ?, ?, ?, ?)")
        const delM = this.db.prepare('DELETE FROM memories WHERE id = ?')
        const delS = this.db.prepare('DELETE FROM signals WHERE id = ?')
        const delV = this.db.prepare('DELETE FROM vectors WHERE id = ?')
        for (const id of removed) {
          const r = old.get(id) as any
          if (r) delF.run(r.rowid, r.title, r.body, r.tags)
          delM.run(id); delS.run(id); delV.run(id)
          this.db.prepare('DELETE FROM neighbors WHERE id = ?').run(id)
          this.signalSig?.delete(id)
          this.vecCache?.map.delete(id)
        }
      }

      // Ricordi nuovi
      // EN: New memories
      const insM = this.db.prepare('INSERT INTO memories (id, kind, title, body, tags, author, ts, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      const insF = this.db.prepare('INSERT INTO memories_fts (rowid, title, body, tags) VALUES (?, ?, ?, ?)')
      for (const m of memories) {
        if (present.has(m.id)) continue
        const tags = m.tags.join(' ')
        const { lastInsertRowid } = insM.run(m.id, m.kind, m.title, m.body, tags, m.author, m.ts, JSON.stringify(m.source ?? {}))
        // Stesso rowid nella tabella dati e nell'indice: è così che FTS5 ritrova il record.
        // EN: Same rowid in the data table and in the index: that's how FTS5 finds the record.
        insF.run(lastInsertRowid, m.title, m.body, tags)
      }

      // Membri: pochi, si riscrivono sempre
      // EN: Members: few of them, always rewritten
      this.db.exec('DELETE FROM members')
      const insU = this.db.prepare('INSERT INTO members (key, name) VALUES (?, ?)')
      for (const u of members) insU.run(u.key, u.name)

      // Segnali di priorità (Fase 5): solo quelli cambiati
      // EN: Priority signals (Phase 5): only the changed ones
      if (!this.signalSig) {
        this.signalSig = new Map((this.db.prepare('SELECT id, uses, last_used, votes, pinned FROM signals').all() as any[])
          .map((r) => [r.id as string, `${r.uses}|${r.last_used ?? ''}|${r.votes}|${r.pinned}`]))
      }
      const upS = this.db.prepare('INSERT OR REPLACE INTO signals (id, uses, last_used, votes, pinned) VALUES (?, ?, ?, ?, ?)')
      for (const m of memories) {
        const u = signals?.usage.get(m.id)
        const row = [u?.count ?? 0, u?.last ?? null, signals?.votes.get(m.id) ?? 0, signals?.pins.has(m.id) ? 1 : 0] as const
        const sig = `${row[0]}|${row[1] ?? ''}|${row[2]}|${row[3]}`
        if (this.signalSig.get(m.id) === sig) continue
        upS.run(m.id, ...row)
        this.signalSig.set(m.id, sig)
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      // Firma dei segnali non più affidabile: alla prossima chiamata si rilegge dal database
      // EN: Signal signature no longer reliable: the next call re-reads it from the database
      this.signalSig = null
      throw err
    }
  }

  /**
   * Ricerca full-text ordinata per rilevanza.
   *
   * EN: Full-text search sorted by relevance.
   *
   * @param query testo libero (viene sanificato da `toFtsQuery`)
   *              EN: free text (sanitized by `toFtsQuery`)
   * @param limit numero massimo di risultati
   *              EN: maximum number of results
   */
  search (query: string, limit = 5): RecallHit[] {
    const match = toFtsQuery(query)
    if (!match) return []
    const rows = this.db.prepare(`
      SELECT m.id, m.kind, m.title, m.body, m.tags, m.author, m.ts, m.source, u.name AS authorName,
             bm25(memories_fts, ${BM25_WEIGHTS}) AS rank
      FROM memories_fts
      JOIN memories m ON m.rowid = memories_fts.rowid
      LEFT JOIN members u ON u.key = m.author
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?`).all(match, limit) as any[]
    return rows.map((r) => ({
      ...rowToHit(r),
      // bm25() restituisce valori NEGATIVI (più basso = più rilevante): lo invertiamo
      // così che per chi usa l'API "più alto = meglio".
      // EN: bm25() returns NEGATIVE values (lower = more relevant): we invert it
      //     so that for API users "higher = better".
      score: -r.rank
    }))
  }

  /**
   * Un ricordo per id. Accetta anche un prefisso (gli id abbreviati mostrati in CLI e MCP).
   * Con un prefisso ambiguo restituisce il primo che trova: i prefissi mostrati sono di 12
   * caratteri esadecimali, quindi le collisioni sono praticamente impossibili.
   *
   * EN: A memory by id. Also accepts a prefix (the short ids shown in the CLI and MCP).
   * With an ambiguous prefix it returns the first match: the prefixes shown are 12 hex
   * characters, so collisions are practically impossible.
   */
  get (id: string): RecallHit | null {
    const r = this.db.prepare(`
      SELECT m.*, u.name AS authorName FROM memories m LEFT JOIN members u ON u.key = m.author
      WHERE m.id = ? OR m.id LIKE ? LIMIT 1`).get(id, `${id}%`) as any
    return r ? { ...rowToHit(r), score: 0 } : null
  }

  // ═══════════════════════════════ Fase 5: vettori ═══════════════════════════════
  // EN: ═══ Phase 5: vectors ═══

  /** Ricordi senza vettore per il modello indicato (o con un vettore di un altro modello). / EN: Memories without a vector for the given model (or with a vector from another model). */
  missingVectors (model: string, limit = 32): { id: string, text: string }[] {
    return (this.db.prepare(`SELECT m.id, m.title, m.body FROM memories m LEFT JOIN vectors v ON v.id = m.id
      WHERE v.id IS NULL OR v.model != ? LIMIT ?`).all(model, limit) as any[]).map((r) => ({ id: r.id, text: `${r.title}\n${r.body}` }))
  }

  /** Salva i vettori calcolati (Float32 come BLOB). / EN: Saves the computed vectors (Float32 as BLOB). */
  setVectors (model: string, items: { id: string, vec: Float32Array }[]): void {
    const ins = this.db.prepare('INSERT INTO vectors (id, model, vec) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET model = excluded.model, vec = excluded.vec')
    // Una transazione per gruppo: senza, ogni riga era un commit su disco (con 5 000 ricordi da
    // indicizzare, es. dopo il ripristino di un backup, 33 secondi solo qui)
    // EN: One transaction per batch: without it, every row was a disk commit (with 5,000 memories
    //     to index, e.g. after restoring a backup, 33 seconds just here)
    this.db.exec('BEGIN')
    try {
      for (const { id, vec } of items) ins.run(id, model, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength))
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    // Cache dei vettori: aggiornata, o scartata se era di un altro modello
    // EN: Vector cache: updated, or discarded if it belonged to another model
    if (this.vecCache?.model === model) for (const { id, vec } of items) this.vecCache.map.set(id, vec)
    else this.vecCache = null
  }

  /** Tutti i vettori di un modello (per la ricerca semantica e i collegamenti). / EN: All vectors of a model (for semantic search and links). */
  /**
   * Vettori di tutti i ricordi per un modello. Restituisce una COPIA della mappa (chi la riceve
   * può togliere voci, es. i personali), ma i vettori sono condivisi: non vanno modificati.
   *
   * EN: Vectors of all memories for a model. Returns a COPY of the map (the caller may remove
   * entries, e.g. personal ones), but the vectors are shared: don't modify them.
   */
  vectors (model: string): Map<string, Float32Array> {
    if (this.vecCache?.model !== model) {
      const map = new Map<string, Float32Array>()
      for (const r of this.db.prepare('SELECT id, vec FROM vectors WHERE model = ?').all(model) as any[]) {
        const b = r.vec as Uint8Array
        map.set(r.id, new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))
      }
      this.vecCache = { model, map }
    }
    return new Map(this.vecCache.map)
  }

  /** Vicini per significato salvati, per un modello: id → [{ id, score }]. / EN: Saved semantic neighbors for a model: id → [{ id, score }]. */
  neighbors (model: string): Map<string, { id: string, score: number }[]> {
    const out = new Map<string, { id: string, score: number }[]>()
    for (const r of this.db.prepare('SELECT id, list FROM neighbors WHERE model = ?').all(model) as any[]) out.set(r.id, JSON.parse(r.list))
    return out
  }

  /** Salva le liste di vicini cambiate (e, con `replaceAll`, cancella prima tutte le altre). / EN: Saves the changed neighbor lists (and, with `replaceAll`, deletes all the others first). */
  saveNeighbors (model: string, entries: [string, { id: string, score: number }[]][], replaceAll = false): void {
    this.db.exec('BEGIN')
    try {
      if (replaceAll) this.db.exec('DELETE FROM neighbors')
      const up = this.db.prepare('INSERT OR REPLACE INTO neighbors (id, model, list) VALUES (?, ?, ?)')
      for (const [id, list] of entries) up.run(id, model, JSON.stringify(list))
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  // ═══════════════════════════════ Fase 5: segnali ═══════════════════════════════
  // EN: ═══ Phase 5: signals ═══

  /** Segnali di priorità per ricordo. / EN: Priority signals per memory. */
  signals (): Map<string, { uses: number, lastUsed: number | null, votes: number, pinned: boolean }> {
    const out = new Map<string, { uses: number, lastUsed: number | null, votes: number, pinned: boolean }>()
    for (const r of this.db.prepare('SELECT * FROM signals').all() as any[]) out.set(r.id, { uses: r.uses, lastUsed: r.last_used, votes: r.votes, pinned: !!r.pinned })
    return out
  }

  /** Solo gli id della ricerca per parole chiave, dal più pertinente (per la ricerca ibrida). / EN: Only the ids of the keyword search, most relevant first (for hybrid search). */
  keywordIds (query: string, limit = 50): string[] {
    const match = toFtsQuery(query)
    if (!match) return []
    return (this.db.prepare(`SELECT m.id FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
      WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts, ${BM25_WEIGHTS}) LIMIT ?`).all(match, limit) as any[]).map((r) => r.id)
  }

  /** Ricordi per id, nell'ordine richiesto. / EN: Memories by id, in the requested order. */
  getMany (ids: string[]): RecallHit[] {
    const stmt = this.db.prepare('SELECT m.*, u.name AS authorName FROM memories m LEFT JOIN members u ON u.key = m.author WHERE m.id = ?')
    return ids.map((id) => stmt.get(id) as any).filter(Boolean).map((r) => ({ ...rowToHit(r), score: 0 }))
  }

  /** Tutti i ricordi (per la costellazione). Con migliaia di ricordi resta una query rapida. / EN: All memories (for the constellation). Even with thousands of memories it stays a fast query. */
  all (): RecallHit[] {
    const rows = this.db.prepare('SELECT m.*, u.name AS authorName FROM memories m LEFT JOIN members u ON u.key = m.author').all() as any[]
    return rows.map((r) => ({ ...rowToHit(r), score: 0 }))
  }

  /** I ricordi più recenti (per la UI, quando non c'è una ricerca in corso). / EN: The most recent memories (for the UI, when no search is running). */
  recent (limit = 20): RecallHit[] {
    const rows = this.db.prepare(`
      SELECT m.*, u.name AS authorName FROM memories m LEFT JOIN members u ON u.key = m.author
      ORDER BY m.ts DESC LIMIT ?`).all(limit) as any[]
    return rows.map((r) => ({ ...rowToHit(r), score: 0 }))
  }

  /** Numero di ricordi indicizzati. / EN: Number of indexed memories. */
  count (): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM memories').get() as any).n
  }

  close (): void {
    this.db.close()
  }
}

/** Converte una riga SQL nel formato restituito dall'API (score escluso). / EN: Converts an SQL row into the format returned by the API (score excluded). */
function rowToHit (r: any): Omit<RecallHit, 'score'> {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    tags: r.tags ? String(r.tags).split(' ') : [],
    author: r.author,
    authorName: r.authorName ?? null,
    ts: r.ts,
    source: r.source ? JSON.parse(r.source) : undefined
  }
}

/**
 * Trasforma testo libero in una query FTS5 sicura.
 *
 * EN: Turns free text into a safe FTS5 query.
 *
 * Ogni parola (lettere/numeri, almeno 2 caratteri) diventa un prefisso tra virgolette
 * (`"parola"*`) e le parole sono unite in OR. Effetti:
 * - la sintassi FTS (AND, NOT, NEAR, :, -, parentesi) scritta dall'utente o da un agente AI
 *   non può rompere la query né cambiarne il significato;
 * - "esponenz" trova "esponenziale" (prefisso);
 * - con OR il ranking BM25 premia i ricordi che contengono PIÙ parole della query.
 * Massimo 32 parole, per evitare query enormi.
 *
 * EN: Each word (letters/digits, at least 2 characters) becomes a quoted prefix
 * (`"parola"*`) and the words are joined with OR. Effects:
 * - FTS syntax (AND, NOT, NEAR, :, -, parentheses) typed by the user or by an AI agent
 *   can't break the query or change its meaning;
 * - "esponenz" finds "esponenziale" (prefix);
 * - with OR, BM25 ranking rewards memories that contain MORE of the query words.
 * At most 32 words, to avoid huge queries.
 */
export function toFtsQuery (text: string): string {
  const words = text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((w) => w.length >= 2)
    .slice(0, 32)
  return [...new Set(words)].map((w) => `"${w}"*`).join(' OR ')
}
