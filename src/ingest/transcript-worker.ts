/**
 * @file Lettura delle trascrizioni in un worker thread.
 *
 * EN: Reading transcripts in a worker thread.
 *
 * Le trascrizioni di Claude Code arrivano a centinaia di MB (sessioni lunghe settimane): leggerle,
 * spezzarle in righe e analizzarle richiede secondi. Nel thread principale questo bloccava il
 * daemon: niente risposte all'app, agli hook, all'MCP. Bug reale del 2026-10-21: avvio a 55 s,
 * oltre i 30 s che l'app aspetta, e l'app diceva «daemon non attivo».
 * Qui la stessa `extractTranscript` gira in un worker: il daemon resta reattivo e il lavoro
 * pesante va in background.
 *
 * EN: Claude Code transcripts reach hundreds of MB (sessions lasting weeks): reading them,
 * splitting them into lines and parsing them takes seconds. On the main thread this blocked the
 * daemon: no replies to the app, the hooks, the MCP. Real bug of 2026-10-21: startup at 55 s,
 * past the 30 s the app waits, and the app said "daemon not running".
 * Here the same `extractTranscript` runs in a worker: the daemon stays responsive and the heavy
 * work goes to the background.
 *
 * Un worker per lettura, senza pool: le letture sono rare (scansione ogni 15 minuti, distillazioni
 * in fila una alla volta) e avviare un worker costa decine di millisecondi, niente rispetto alla
 * lettura. Il file compilato fa da worker di sé stesso (`isMainThread`). Sotto vitest i sorgenti
 * sono .ts e un worker non li sa caricare: si legge nel thread corrente, come prima.
 *
 * EN: One worker per read, no pool: reads are rare (a scan every 15 minutes, distillations queued
 * one at a time) and starting a worker costs tens of milliseconds, nothing compared to the read.
 * The compiled file is its own worker (`isMainThread`). Under vitest the sources are .ts and a
 * worker can't load them: we read on the current thread, as before.
 */
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'
import { extractTranscript, type TranscriptExtract } from './transcript'

/** Parametri di una lettura (gli stessi di extractTranscript). / EN: Parameters of a read (the same as extractTranscript). */
interface ReadArgs { file: string, fromLine: number, sensitiveFiles: string[], measureOnly: boolean }

/**
 * Come `extractTranscript`, ma in un worker thread: non blocca il daemon.
 *
 * EN: Like `extractTranscript`, but in a worker thread: it doesn't block the daemon.
 */
export function readTranscript (file: string, fromLine = 0, sensitiveFiles: string[] = [], measureOnly = false): Promise<TranscriptExtract> {
  const args: ReadArgs = { file, fromLine, sensitiveFiles, measureOnly }
  // Sorgente .ts (test): niente worker / EN: .ts source (tests): no worker
  if (__filename.endsWith('.ts')) return Promise.resolve(extractTranscript(file, fromLine, sensitiveFiles, measureOnly))
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: args })
    worker.once('message', (m: { ok: TranscriptExtract } | { error: string }) => {
      if ('ok' in m) resolve(m.ok)
      else reject(new Error(m.error))
    })
    worker.once('error', reject)
    worker.once('exit', (code) => { if (code !== 0) reject(new Error(`lettura della trascrizione interrotta (codice ${code})`)) })
  })
}

// Dentro il worker: una lettura e poi si esce
// EN: Inside the worker: one read and then exit
if (!isMainThread && parentPort && (workerData as ReadArgs | undefined)?.file) {
  const a = workerData as ReadArgs
  try {
    parentPort.postMessage({ ok: extractTranscript(a.file, a.fromLine, a.sensitiveFiles, a.measureOnly) })
  } catch (err) {
    parentPort.postMessage({ error: (err as Error).message })
  }
}
