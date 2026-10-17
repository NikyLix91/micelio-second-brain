// Indice di ricerca locale (DESIGN §4.3, §8.1). È DERIVATO dalla vista replicata: si può
// cancellare e ricostruire in qualunque momento, e non viene mai sincronizzato.
// Usa node:sqlite (integrato in Node ≥ 22.13): FTS5 senza dipendenze native, su ogni OS.
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { MemberRecord, MemoryRecord, RecallHit } from '../core/model'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL,
  author TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  title, body, tags,
  content='memories', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS members (key TEXT PRIMARY KEY, name TEXT NOT NULL);
`

// Pesi BM25 per colonna: il titolo conta più dei tag, che contano più del corpo.
const BM25_WEIGHTS = '3.0, 1.0, 2.0'

export class MemoryIndex {
  private db: DatabaseSync

  constructor (file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(SCHEMA)
  }

  /** Sostituisce l'intero contenuto dell'indice con lo stato della vista. */
  rebuild (memories: MemoryRecord[], members: MemberRecord[]): void {
    this.db.exec('BEGIN')
    try {
      this.db.exec("DELETE FROM memories; DELETE FROM members; INSERT INTO memories_fts(memories_fts) VALUES('delete-all');")
      const insM = this.db.prepare('INSERT INTO memories (id, kind, title, body, tags, author, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
      const insF = this.db.prepare('INSERT INTO memories_fts (rowid, title, body, tags) VALUES (?, ?, ?, ?)')
      for (const m of memories) {
        const tags = m.tags.join(' ')
        const { lastInsertRowid } = insM.run(m.id, m.kind, m.title, m.body, tags, m.author, m.ts)
        insF.run(lastInsertRowid, m.title, m.body, tags)
      }
      const insU = this.db.prepare('INSERT INTO members (key, name) VALUES (?, ?)')
      for (const u of members) insU.run(u.key, u.name)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  search (query: string, limit = 5): RecallHit[] {
    const match = toFtsQuery(query)
    if (!match) return []
    const rows = this.db.prepare(`
      SELECT m.id, m.kind, m.title, m.body, m.tags, m.author, m.ts, u.name AS authorName,
             bm25(memories_fts, ${BM25_WEIGHTS}) AS rank
      FROM memories_fts
      JOIN memories m ON m.rowid = memories_fts.rowid
      LEFT JOIN members u ON u.key = m.author
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?`).all(match, limit) as any[]
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      tags: r.tags ? String(r.tags).split(' ') : [],
      author: r.author,
      authorName: r.authorName ?? null,
      ts: r.ts,
      score: -r.rank // bm25 restituisce valori negativi: più basso = più rilevante
    }))
  }

  get (id: string): RecallHit | null {
    const r = this.db.prepare(`
      SELECT m.*, u.name AS authorName FROM memories m LEFT JOIN members u ON u.key = m.author
      WHERE m.id = ? OR m.id LIKE ? LIMIT 1`).get(id, `${id}%`) as any
    if (!r) return null
    return { id: r.id, kind: r.kind, title: r.title, body: r.body, tags: r.tags ? String(r.tags).split(' ') : [], author: r.author, authorName: r.authorName ?? null, ts: r.ts, score: 0 }
  }

  count (): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM memories').get() as any).n
  }

  close (): void {
    this.db.close()
  }
}

/**
 * Trasforma testo libero in una query FTS5 sicura: ogni parola diventa un prefisso tra
 * virgolette ("parola"*), unite in OR. Così la sintassi FTS (AND, NEAR, :, -) nell'input
 * dell'utente o dell'agente non può rompere la query, e il ranking BM25 premia chi ne contiene di più.
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
