/**
 * @file Embedding: vettori che rappresentano il SIGNIFICATO di un testo (DESIGN §8.1, spike C).
 *
 * EN: Embeddings: vectors that represent the MEANING of a text (DESIGN §8.1, spike C).
 *
 * Due implementazioni dietro la stessa interfaccia:
 * - `LocalEmbedder`: modello multilingue `Xenova/multilingual-e5-small` con transformers.js,
 *   eseguito IN LOCALE (nessuna API) in un worker thread. Il modello (~130 MB) si scarica al
 *   primo uso in ~/.micelio/models. Occupa ~600 MB di RAM: viene caricato solo quando serve e
 *   scaricato dopo 10 minuti di inattività (lezione dello spike C);
 * - `HashEmbedder`: deterministico e istantaneo (bag of words con hashing), per test ed e2e.
 *   Coglie solo le parole in comune, non il significato: NON usarlo in produzione.
 *
 * EN: Two implementations behind the same interface:
 * - `LocalEmbedder`: multilingual model `Xenova/multilingual-e5-small` with transformers.js,
 *   run LOCALLY (no API) in a worker thread. The model (~130 MB) is downloaded on
 *   first use into ~/.micelio/models. It takes ~600 MB of RAM: it is loaded only when needed and
 *   unloaded after 10 minutes of inactivity (lesson from spike C);
 * - `HashEmbedder`: deterministic and instant (bag of words with hashing), for tests and e2e.
 *   It only catches shared words, not meaning: do NOT use it in production.
 *
 * Tutti i nodi di un team devono usare lo stesso modello, altrimenti i vettori non sono
 * confrontabili: il nome del modello è salvato accanto a ogni vettore e i vettori di un modello
 * diverso vengono ricalcolati.
 *
 * EN: All nodes of a team must use the same model, otherwise vectors are not
 * comparable: the model name is saved next to each vector and vectors from a different
 * model are recomputed.
 */
import path from 'node:path'
import { Worker } from 'node:worker_threads'

export interface Embedder {
  /** Nome del modello: i vettori di modelli diversi non sono confrontabili. / EN: Model name: vectors from different models are not comparable. */
  readonly model: string
  /**
   * Vettori normalizzati (lunghezza 1). `kind` serve ai modelli e5, che distinguono il testo
   * da cercare ("query") da quello in cui cercare ("passage").
   *
   * EN: Normalized vectors (length 1). `kind` is for e5 models, which tell the text
   * to search for ("query") apart from the text to search in ("passage").
   */
  embed (texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]>
  close (): Promise<void>
}

/** Embedder finto: bag of words con hashing in 256 dimensioni. Solo per test. / EN: Fake embedder: bag of words hashed into 256 dimensions. Tests only. */
export class HashEmbedder implements Embedder {
  readonly model = 'hash-256'

  async embed (texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(256)
      for (const w of t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u).filter((x) => x.length > 2)) {
        let h = 0
        for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) >>> 0
        v[h % 256] += 1
      }
      const n = Math.hypot(...v) || 1
      return v.map((x) => x / n)
    })
  }

  async close (): Promise<void> {}
}

/** Dopo quanto tempo senza richieste il worker (e il modello in RAM) viene chiuso. / EN: How long without requests before the worker (and the model in RAM) is closed. */
const IDLE_MS = 10 * 60 * 1000

/**
 * Embedder locale con transformers.js in un worker thread: il calcolo (pesante) non blocca il
 * daemon, che continua a rispondere ad API, MCP e rete.
 *
 * EN: Local embedder with transformers.js in a worker thread: the (heavy) computation does not
 * block the daemon, which keeps answering the API, MCP and the network.
 */
export class LocalEmbedder implements Embedder {
  private worker: Worker | null = null
  private seq = 0
  private readonly pending = new Map<number, { resolve: (v: Float32Array[]) => void, reject: (e: Error) => void }>()
  private idleTimer: NodeJS.Timeout | null = null

  /**
   * @param model    modello Hugging Face (formato ONNX per transformers.js)
   *        EN: Hugging Face model (ONNX format for transformers.js)
   * @param cacheDir dove scaricare il modello (~/.micelio/models)
   *        EN: where to download the model (~/.micelio/models)
   */
  constructor (readonly model: string, private readonly cacheDir: string) {}

  embed (texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]> {
    const w = this.ensureWorker()
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      // Con richieste aperte il worker deve tenere vivo il processo (altrimenti Node potrebbe
      // terminare prima della risposta); senza richieste torna "staccato" (vedi sotto).
      // EN: With open requests the worker must keep the process alive (otherwise Node could
      //     exit before the answer); with no requests it goes back to "detached" (see below).
      w.ref()
      w.postMessage({ id, texts, kind })
    })
  }

  private ensureWorker (): Worker {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => { void this.close() }, IDLE_MS)
    this.idleTimer.unref()
    if (this.worker) return this.worker
    this.worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: { model: this.model, cacheDir: this.cacheDir } })
    this.worker.on('message', (m: { id: number, vectors?: number[][], error?: string }) => {
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      if (this.pending.size === 0) this.worker?.unref()
      if (m.error) p.reject(new Error(m.error))
      else p.resolve(m.vectors!.map((v) => Float32Array.from(v)))
    })
    this.worker.on('error', (err) => {
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      this.worker = null
    })
    this.worker.unref() // inattivo, il worker non deve tenere vivo il processo da solo / EN: when idle, the worker must not keep the process alive on its own
    return this.worker
  }

  async close (): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    const w = this.worker
    this.worker = null
    if (w) await w.terminate()
  }
}
