/**
 * @file Vicini per significato di ogni ricordo, aggiornati in modo INCREMENTALE.
 *
 * EN: Meaning-based neighbors of each memory, updated INCREMENTALLY.
 *
 * La costellazione collega ogni ricordo ai suoi K più simili per significato (sopra la soglia del
 * modello). Prima si ricalcolavano da zero a ogni aggiornamento della vista: un confronto per
 * ogni COPPIA di ricordi, quindi un costo che cresce col quadrato. Con 1 300 ricordi una scrittura
 * costava già circa 2 secondi, e a 5 000 sarebbero state decine di secondi.
 *
 * EN: The constellation links each memory to its K most similar by meaning (above the model's
 * threshold). They used to be recomputed from scratch on every view update: one comparison per
 * PAIR of memories, so a cost that grows quadratically. With 1,300 memories a write already cost
 * about 2 seconds, and at 5,000 it would have been tens of seconds.
 *
 * Ora:
 * - il calcolo completo si fa una volta sola (all'avvio, o se cambia il modello di embedding);
 * - per ogni ricordo nuovo si confronta il suo vettore con tutti gli altri UNA volta: si fissano i
 *   suoi vicini e, con gli stessi punteggi, si aggiornano le liste degli altri se il nuovo è fra i
 *   loro K più simili. Costo lineare nel numero di ricordi.
 * Le liste che citano ricordi non più attivi (archiviati, sostituiti) si ripuliscono con un
 * calcolo completo quando superano una certa quota (vedi `staleShare`).
 *
 * EN: Now:
 * - the full computation runs only once (at startup, or if the embedding model changes);
 * - for each new memory its vector is compared with all the others ONCE: its neighbors are set
 *   and, with the same scores, the other lists are updated if the new one is among their K most
 *   similar. Cost linear in the number of memories.
 * Lists that reference memories no longer active (archived, superseded) are cleaned up with a
 * full computation when they exceed a certain share (see `staleShare`).
 */
import type { GraphLink } from '../graph/constellation'
import { cosine } from './hybrid'

interface Neighbor { id: string, score: number }

export class SemanticNeighbors {
  private lists = new Map<string, Neighbor[]>()
  /** Liste cambiate dall'ultimo salvataggio (vedi takeDirty). / EN: Lists changed since the last save (see takeDirty). */
  private dirty = new Set<string>()
  /** Modello con cui sono state calcolate le liste ('' = mai). / EN: Model the lists were computed with ('' = never). */
  model = ''
  /** true mentre è in corso un ricalcolo completo (rebuildAsync). / EN: true while a full recomputation is running (rebuildAsync). */
  rebuilding = false

  /** @param k vicini tenuti per ricordo / EN: neighbors kept per memory */
  constructor (private readonly k = 2) {}

  /** Calcolo completo: ogni ricordo contro tutti gli altri. Sincrono: per i test e i team piccoli. / EN: Full computation: every memory against all the others. Synchronous: for tests and small teams. */
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
   *
   * EN: Full computation IN SLICES: between slices it yields control, so the daemon keeps
   * responding (with 5,000 memories the computation takes seconds). The new lists replace the
   * old ones only at the end.
   */
  async rebuildAsync (vectors: Map<string, Float32Array>, min: number, model: string, sliceMs = 10): Promise<void> {
    this.rebuilding = true
    try {
      const fresh = new SemanticNeighbors(this.k)
      const entries = [...vectors]
      // Una lista (anche vuota) per ogni ricordo: quelle salvate coprono così tutti i ricordi
      // EN: One list (even empty) per memory: this way the saved lists cover all memories
      for (const [id] of entries) fresh.lists.set(id, [])
      // Blocchi a TEMPO (~10 ms), non a numero di righe: con 5 000 ricordi 200 righe erano ~150 ms, e
      // ogni lettura della vista (che avanza a piccoli passi asincroni) aspettava un blocco intero a
      // ogni passo: il ripristino di un backup passava da pochi secondi a 44
      // EN: TIME-based slices (~10 ms), not row-based: with 5,000 memories 200 rows took ~150 ms, and
      //     every view read (which advances in small async steps) waited for a whole slice at each
      //     step: restoring a backup went from a few seconds to 44
      let sliceStart = Date.now()
      for (let i = 0; i < entries.length; i++) {
        fresh.compareWithFollowing(entries, i, min)
        if (Date.now() - sliceStart >= sliceMs) {
          await new Promise((r) => setImmediate(r))
          sliceStart = Date.now()
        }
      }
      this.lists = fresh.lists
      this.model = model
      this.dirty = new Set(this.lists.keys())
    } finally {
      this.rebuilding = false
    }
  }

  /** Confronta il ricordo i con quelli che lo seguono (ogni coppia una volta sola). / EN: Compares memory i with the ones after it (each pair only once). */
  private compareWithFollowing (entries: [string, Float32Array][], i: number, min: number): void {
    for (let j = i + 1; j < entries.length; j++) {
      const s = cosine(entries[i][1], entries[j][1])
      if (s >= min) {
        this.offer(entries[i][0], entries[j][0], s)
        this.offer(entries[j][0], entries[i][0], s)
      }
    }
  }

  /** Riprende liste salvate (all'avvio): nessun calcolo. / EN: Restores saved lists (at startup): no computation. */
  load (model: string, lists: Map<string, Neighbor[]>): void {
    this.lists = lists
    this.model = model
    this.dirty.clear()
  }

  /** Numero di ricordi con una lista. / EN: Number of memories with a list. */
  get size (): number { return this.lists.size }

  /** Le liste cambiate dall'ultima chiamata, da salvare su disco. / EN: The lists changed since the last call, to be saved to disk. */
  takeDirty (): [string, Neighbor[]][] {
    const out = [...this.dirty].flatMap((id) => (this.lists.has(id) ? [[id, this.lists.get(id)!] as [string, Neighbor[]]] : []))
    this.dirty.clear()
    return out
  }

  /**
   * Aggiunge ricordi nuovi (vettori appena calcolati): un confronto con ciascun altro ricordo.
   *
   * EN: Adds new memories (freshly computed vectors): one comparison with each other memory.
   *
   * @param ids ricordi nuovi, già presenti in `vectors`
   *            EN: new memories, already present in `vectors`
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

  /** Propone `to` come vicino di `from`: entra se fra i K più simili. / EN: Proposes `to` as a neighbor of `from`: it gets in if among the K most similar. */
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
   *
   * EN: Constellation links, once per pair, between present memories.
   * Weight: how much the similarity exceeds the threshold (as before).
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

  /** Quota di liste che citano ricordi non più presenti: oltre il 10% conviene un calcolo completo. / EN: Share of lists referencing memories no longer present: above 10% a full computation is worth it. */
  staleShare (present: Set<string>): number {
    if (this.lists.size === 0) return 0
    let stale = 0
    for (const [id, list] of this.lists) if (!present.has(id) || list.some((n) => !present.has(n.id))) stale++
    return stale / this.lists.size
  }
}
