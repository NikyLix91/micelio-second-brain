// Spike C — Embedding locali con transformers.js (nessuna API), modello multilingue piccolo.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline, env } from '@huggingface/transformers'

env.cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache')
const MODEL = process.argv[2] || 'Xenova/multilingual-e5-small'

let t0 = Date.now()
const embed = await pipeline('feature-extraction', MODEL, { dtype: 'q8' })
console.log(`modello ${MODEL} caricato in ${Date.now() - t0} ms`)

// e5 richiede i prefissi "passage: " / "query: "
const memories = [
  'Build Angular 17 in out of memory su Azure DevOps: impostare NODE_OPTIONS=--max-old-space-size=6144',
  'Drizzle è l\'ORM standard per i nuovi servizi Postgres al posto di Prisma',
  'Prisma: il motore binario dà problemi nelle immagini Docker Alpine',
  'SFTP: usare keepaliveInterval e retry con backoff quando il server chiude le connessioni inattive',
  'Le migrazioni del database si eseguono con il job di release, mai a mano in produzione',
  'Angular: i servizi singleton si dichiarano con providedIn: \'root\''
]
const queries = [
  'la pipeline CI fallisce per memoria esaurita durante la build del frontend',
  'which ORM should I use for a new Postgres microservice?', // query in inglese su ricordi in italiano
  'connessione sftp che cade dopo un po\'',
  'come creo un servizio condiviso in Angular'
]

t0 = Date.now()
const M = await embed(memories.map((m) => 'passage: ' + m), { pooling: 'mean', normalize: true })
console.log(`${memories.length} passaggi in ${Date.now() - t0} ms, dimensione ${M.dims[1]}`)
const mv = M.tolist()

for (const q of queries) {
  const [qv] = (await embed('query: ' + q, { pooling: 'mean', normalize: true })).tolist()
  const ranked = mv.map((v, i) => ({ i, s: v.reduce((a, x, k) => a + x * qv[k], 0) })).sort((a, b) => b.s - a.s)
  console.log(`\nQ: ${q}`)
  for (const { i, s } of ranked.slice(0, 2)) console.log(`   ${s.toFixed(3)}  ${memories[i]}`)
}

t0 = Date.now()
const N = 200
await embed(Array.from({ length: N }, (_, i) => `passage: ricordo di prova numero ${i} su build, ORM e pipeline`), { pooling: 'mean', normalize: true })
console.log(`\nthroughput: ${N} passaggi in ${Date.now() - t0} ms (${((Date.now() - t0) / N).toFixed(1)} ms/passaggio)`)
console.log(`memoria RSS: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MB`)
