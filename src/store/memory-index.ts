/**
 * @file Indice di ricerca locale sui ricordi del team (DESIGN §4.3, §8.1).
 *
 * L'indice è DERIVATO dalla vista replicata: non viene mai sincronizzato, si può cancellare in
 * qualunque momento (file view.db) e viene ricostruito da `MicelioNode.materialize()`.
 *
 * Tecnologia: `node:sqlite` (integrato in Node ≥ 22.13) con FTS5, il motore full-text di SQLite.
 * Nessuna dipendenza nativa da compilare, quindi funziona uguale su Windows, macOS e Linux.
 *
 * Struttura:
 * - `memories`      tabella normale con i dati dei ricordi;
 * - `memories_fts`  indice FTS5 "external content" che punta a `memories` tramite rowid
 *                   (non duplica il testo, indicizza solo titolo, corpo e tag);
 * - `members`       nomi dei membri, per mostrare "chi ha scritto" nei risultati.
 */
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
  tags TEXT NOT NULL,          -- tag separati da spazio, come vengono indicizzati
  author TEXT NOT NULL,
  ts INTEGER NOT NULL
);
-- unicode61 + remove_diacritics 2: "perché" e "perche" coincidono, maiuscole ignorate.
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  title, body, tags,
  content='memories', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS members (key TEXT PRIMARY KEY, name TEXT NOT NULL);
`

/**
 * Pesi BM25 per colonna, nell'ordine (title, body, tags). Una parola nel titolo vale 3 volte
 * una nel corpo; nei tag 2 volte. Il titolo è scritto apposta per descrivere il ricordo.
 */
const BM25_WEIGHTS = '3.0, 1.0, 2.0'

export class MemoryIndex {
  private db: DatabaseSync

  /** @param file percorso del database, oppure ':memory:' (test) */
  constructor (file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(SCHEMA)
  }

  /**
   * Sostituisce l'intero contenuto dell'indice con lo stato attuale della vista.
   *
   * Ricostruzione completa in una transazione: semplice e sempre corretta, anche quando Autobase
   * riordina la storia. Con qualche migliaio di ricordi costa decine di millisecondi; un
   * aggiornamento incrementale è previsto in Fase 5.
   */
  rebuild (memories: MemoryRecord[], members: MemberRecord[]): void {
    this.db.exec('BEGIN')
    try {
      // 'delete-all' è il comando FTS5 per svuotare un indice external-content.
      this.db.exec("DELETE FROM memories; DELETE FROM members; INSERT INTO memories_fts(memories_fts) VALUES('delete-all');")
      const insM = this.db.prepare('INSERT INTO memories (id, kind, title, body, tags, author, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
      const insF = this.db.prepare('INSERT INTO memories_fts (rowid, title, body, tags) VALUES (?, ?, ?, ?)')
      for (const m of memories) {
        const tags = m.tags.join(' ')
        const { lastInsertRowid } = insM.run(m.id, m.kind, m.title, m.body, tags, m.author, m.ts)
        // Stesso rowid nella tabella dati e nell'indice: è così che FTS5 ritrova il record.
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

  /**
   * Ricerca full-text ordinata per rilevanza.
   * @param query testo libero (viene sanificato da `toFtsQuery`)
   * @param limit numero massimo di risultati
   */
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
      ...rowToHit(r),
      // bm25() restituisce valori NEGATIVI (più basso = più rilevante): lo invertiamo
      // così che per chi usa l'API "più alto = meglio".
      score: -r.rank
    }))
  }

  /**
   * Un ricordo per id. Accetta anche un prefisso (gli id abbreviati mostrati in CLI e MCP).
   * Con un prefisso ambiguo restituisce il primo che trova: i prefissi mostrati sono di 12
   * caratteri esadecimali, quindi le collisioni sono praticamente impossibili.
   */
  get (id: string): RecallHit | null {
    const r = this.db.prepare(`
      SELECT m.*, u.name AS authorName FROM memories m LEFT JOIN members u ON u.key = m.author
      WHERE m.id = ? OR m.id LIKE ? LIMIT 1`).get(id, `${id}%`) as any
    return r ? { ...rowToHit(r), score: 0 } : null
  }

  /** Numero di ricordi indicizzati. */
  count (): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM memories').get() as any).n
  }

  close (): void {
    this.db.close()
  }
}

/** Converte una riga SQL nel formato restituito dall'API (score escluso). */
function rowToHit (r: any): Omit<RecallHit, 'score'> {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    tags: r.tags ? String(r.tags).split(' ') : [],
    author: r.author,
    authorName: r.authorName ?? null,
    ts: r.ts
  }
}

/**
 * Trasforma testo libero in una query FTS5 sicura.
 *
 * Ogni parola (lettere/numeri, almeno 2 caratteri) diventa un prefisso tra virgolette
 * (`"parola"*`) e le parole sono unite in OR. Effetti:
 * - la sintassi FTS (AND, NOT, NEAR, :, -, parentesi) scritta dall'utente o da un agente AI
 *   non può rompere la query né cambiarne il significato;
 * - "esponenz" trova "esponenziale" (prefisso);
 * - con OR il ranking BM25 premia i ricordi che contengono PIÙ parole della query.
 * Massimo 32 parole, per evitare query enormi.
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
