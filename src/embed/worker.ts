/**
 * @file Worker thread che calcola gli embedding con transformers.js (vedi embedder.ts).
 *
 * Isolato in un thread perché il modello occupa ~600 MB e il calcolo è pesante: così il thread
 * principale del daemon resta libero. Riceve { id, texts, kind } e risponde { id, vectors } o
 * { id, error }.
 *
 * EN: Worker thread that computes embeddings with transformers.js (see embedder.ts).
 *
 * EN: Isolated in a thread because the model takes ~600 MB and the computation is heavy: this keeps
 * the daemon's main thread free. It receives { id, texts, kind } and replies { id, vectors } or
 * { id, error }.
 */
import { parentPort, workerData } from 'node:worker_threads'

const { model, cacheDir } = workerData as { model: string, cacheDir: string }

/** Pipeline di feature extraction, creata al primo messaggio (il caricamento richiede secondi). / EN: Feature extraction pipeline, created on the first message (loading takes seconds). */
let extractor: Promise<any> | null = null

async function getExtractor (): Promise<any> {
  // transformers.js è un modulo ESM: lo carichiamo con import() dinamico anche da CommonJS.
  // EN: transformers.js is an ESM module: we load it with a dynamic import(), even from CommonJS.
  // eslint-disable-next-line no-new-func
  const { pipeline, env } = await (new Function('m', 'return import(m)'))('@huggingface/transformers')
  env.cacheDir = cacheDir
  return pipeline('feature-extraction', model, { dtype: 'q8' })
}

parentPort!.on('message', async (m: { id: number, texts: string[], kind: 'query' | 'passage' }) => {
  try {
    extractor ??= getExtractor()
    const ex = await extractor
    // I modelli e5 richiedono il prefisso "query: " o "passage: " (spike C).
    // EN: e5 models require the "query: " or "passage: " prefix (spike C).
    const input = m.texts.map((t) => `${m.kind}: ${t}`)
    const out = await ex(input, { pooling: 'mean', normalize: true })
    parentPort!.postMessage({ id: m.id, vectors: out.tolist() })
  } catch (err) {
    parentPort!.postMessage({ id: m.id, error: (err as Error).message })
  }
})
