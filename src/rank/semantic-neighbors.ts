/**
 * @file Vicini per significato di ogni ricordo, aggiornati in modo INCREMENTALE.
 *
 * La costellazione collega ogni ricordo ai suoi K più simili per significato (sopra la soglia del
 * modello). Prima si ricalcolavano da zero a ogni aggiornamento della vista: un confronto per
 * ogni COPPIA di ricordi, quindi un costo che cresce col quadrato. Con 1 300 ricordi una scrittura
 * costava già circa 2 secondi, e a 5 000 sarebbero state decine di secondi.
 *
 * Ora:
 * - il calcolo completo si fa una volta sola (all'avvio, o se cambia il modello di embedding);
 * - per ogni ricordo nuovo si confronta il suo vettore con tutti gli altri UNA volta: si fissano i
 *   suoi vicini e, con gli stessi punteggi, si aggiornano le liste degli altri se il nuovo è fra i
 *   loro K più simili. Costo lineare nel numero di ricordi.
 * Le liste che citano ricordi non più attivi (archiviati, sostituiti) si ripuliscono con un
 * calcolo completo quando superano una certa quota (vedi `staleShare`).
 */
import type { GraphLink } from '../graph/constellation'
import { cosine } from './hybrid'

interface Neighbor { id: string, score: number }

export class SemanticNeighbors {
  private lists = new Map<string, Neighbor[]>()
  /** Liste cambiate dall'ultimo salvataggio (vedi takeDirty). */
  private dirty = new Set<string>()
  /** Modello con cui sono state calcolate le liste ('' = mai). */
  model = ''
  /** true mentre è in corso un ricalcolo completo (rebuildAsync). */
  rebuilding = false

  /** @param k vicini tenuti per ricordo */
  constructor (private readonly k = 2) {}

  /** Calcolo completo: ogni ricordo contro tutti gli altri. Sincrono: per i test e i team piccoli. */
  rebuild (vectors: Map<string, Float32Array>, min: number, model: string): void {
    this.lists.clear()
    this.model = model
    const entries = [...vectors]
    for (const [id] of entries) this.lists.set(id, [])
    for (let i = 0; i < entries.length; i++) this.compareWithFollowing(entries, i, min)
    this.dirty = new Set(this.lists.keys())
  }

  /**
   * Calcolo completo A BLOCCHI: tra un blocco e l'altro restituisce il controllo, così il daemon
   * continua a rispondere (con 5 000 ricordi il calcolo dura secondi). Le liste nuove sostituiscono
   * le vecchie solo alla fine.
   */
  async rebuildAsync (vectors: Map<string, Float32Array>, min: number, model: string, rowsPerSlice = 200): Promise<void> {
    this.rebuilding = true
    try {
      const fresh = new SemanticNeighbors(this.k)
      const entries = [...vectors]
      // Una lista (anche vuota) per ogni ricordo: quelle salvate coprono così tutti i ricordi
      for (const [id] of entries) fresh.lists.set(id, [])
      for (let i = 0; i < entries.length; i++) {
        fresh.compareWithFollowing(entries, i, min)
        if (i % rowsPerSlice === rowsPerSlice - 1) await new Promise((r) => setImmediate(r))
      }
      this.lists = fresh.lists
      this.model = model
      this.dirty = new Set(this.lists.keys())
    } finally {
      this.rebuilding = false
    }
  }

  /** Confronta il ricordo i con quelli che lo seguono (ogni coppia una volta sola). */
  private compareWithFollowing (entries: [string, Float32Array][], i: number, min: number): void {
    for (let j = i + 1; j < entries.length; j++) {
      const s = cosine(entries[i][1], entries[j][1])
      if (s >= min) {
        this.offer(entries[i][0], entries[j][0], s)
        this.offer(entries[j][0], entries[i][0], s)
      }
    }
  }

  /** Riprende liste salvate (all'avvio): nessun calcolo. */
  load (model: string, lists: Map<string, Neighbor[]>): void {
    this.lists = lists
    this.model = model
    this.dirty.clear()
  }

  /** Numero di ricordi con una lista. */
  get size (): number { return this.lists.size }

  /** Le liste cambiate dall'ultima chiamata, da salvare su disco. */
  takeDirty (): [string, Neighbor[]][] {
    const out = [...this.dirty].flatMap((id) => (this.lists.has(id) ? [[id, this.lists.get(id)!] as [string, Neighbor[]]] : []))
    this.dirty.clear()
    return out
  }

  /**
   * Aggiunge ricordi nuovi (vettori appena calcolati): un confronto con ciascun altro ricordo.
   * @param ids ricordi nuovi, già presenti in `vectors`
   */
  add (ids: string[], vectors: Map<string, Float32Array>, min: number): void {
    for (const id of ids) {
      const v = vectors.get(id)
      if (!v) continue
      this.lists.set(id, [])
      this.dirty.add(id)
      for (const [other, w] of vectors) {
        if (other === id) continue
        const s = cosine(v, w)
        if (s < min) continue
        this.offer(id, other, s)
        this.offer(other, id, s)
      }
    }
  }

  /** Propone `to` come vicino di `from`: entra se fra i K più simili. */
  private offer (from: string, to: string, score: number): void {
    const list = this.lists.get(from) ?? []
    if (list.some((n) => n.id === to)) return
    if (list.length >= this.k && score <= list[list.length - 1].score) {
      if (!this.lists.has(from)) this.lists.set(from, list)
      return
    }
    list.push({ id: to, score })
    list.sort((a, b) => b.score - a.score)
    if (list.length > this.k) list.length = this.k
    this.lists.set(from, list)
    this.dirty.add(from)
  }

  /**
   * Collegamenti della costellazione, una volta per coppia, fra ricordi presenti.
   * Peso: quanto la similarità supera la soglia (come prima).
   */
  links (min: number, present: Set<string>): GraphLink[] {
    const out: GraphLink[] = []
    for (const [id, list] of this.lists) {
      if (!present.has(id)) continue
      for (const n of list) {
        if (!present.has(n.id) || (id > n.id && this.lists.get(n.id)?.some((x) => x.id === id))) continue
        out.push({ source: id, target: n.id, weight: Math.min(1, (n.score - min) / (1 - min) * 2), kind: 'semantic' })
      }
    }
    return out
  }

  /** Quota di liste che citano ricordi non più presenti: oltre il 10% conviene un calcolo completo. */
  staleShare (present: Set<string>): number {
    if (this.lists.size === 0) return 0
    let stale = 0
    for (const [id, list] of this.lists) if (!present.has(id) || list.some((n) => !present.has(n.id))) stale++
    return stale / this.lists.size
  }
}
