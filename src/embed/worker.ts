/**
 * @file Worker thread che calcola gli embedding con transformers.js (vedi embedder.ts).
 *
 * Isolato in un thread perché il modello occupa ~600 MB e il calcolo è pesante: così il thread
 * principale del daemon resta libero. Riceve { id, texts, kind } e risponde { id, vectors } o
 * { id, error }.
 */
import { parentPort, workerData } from 'node:worker_threads'

const { model, cacheDir } = workerData as { model: string, cacheDir: string }

/** Pipeline di feature extraction, creata al primo messaggio (il caricamento richiede secondi). */
let extractor: Promise<any> | null = null

async function getExtractor (): Promise<any> {
  // transformers.js è un modulo ESM: lo carichiamo con import() dinamico anche da CommonJS.
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
    const input = m.texts.map((t) => `${m.kind}: ${t}`)
    const out = await ex(input, { pooling: 'mean', normalize: true })
    parentPort!.postMessage({ id: m.id, vectors: out.tolist() })
  } catch (err) {
    parentPort!.postMessage({ id: m.id, error: (err as Error).message })
  }
})
