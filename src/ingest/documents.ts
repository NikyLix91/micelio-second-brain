/**
 * @file Sorveglianza delle cartelle di documenti (Fase 4, DESIGN §6.1–6.2).
 *
 * Per ogni cartella configurata (`watch.documents` in config.json) osserva file nuovi e
 * modificati con `chokidar`. Per ognuno calcola l'hash del contenuto e, se è cambiato rispetto
 * all'ultima elaborazione (tabella `documents` dell'archivio privato), lo accoda alla pipeline.
 *
 * Elaborazione INCREMENTALE: un documento invariato non viene mai rielaborato, nemmeno dopo un
 * riavvio (all'avvio chokidar segnala tutti i file esistenti, ma l'hash è lo stesso).
 * Un file cancellato viene segnato "removed": i ricordi già distillati restano nel team (sono
 * conoscenza acquisita), ma l'originale non è più scaricabile.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { type FSWatcher, watch } from 'chokidar'
import type { IngestPipeline } from './pipeline'
import type { PrivateStore } from '../store/private-store'
import { isSupported, MAX_DOCUMENT_BYTES } from './extract'

/** Hash SHA-256 del contenuto di un file, letto a blocchi (anche file grandi senza caricarli in memoria). */
export function hashFile (file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

export interface WatchedFolder { path: string, shareable: boolean }

/**
 * Forma confrontabile di un percorso: separatori "/" e minuscole. chokidar passa i percorsi con
 * "/" anche su Windows, mentre la configurazione usa "\": senza normalizzare, i confronti
 * fallivano e nessun documento veniva rilevato (bug trovato con il team demo).
 */
const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()

/** La cartella sorvegliata che contiene `file`, se c'è. */
function folderOf (file: string, folders: WatchedFolder[]): WatchedFolder | undefined {
  const f = norm(file)
  return folders.find((w) => {
    const root = norm(w.path).replace(/\/$/, '')
    return f === root || f.startsWith(root + '/')
  })
}

export class DocumentWatcher {
  private watcher: FSWatcher | null = null

  constructor (
    private readonly pipeline: IngestPipeline,
    private readonly store: PrivateStore,
    private readonly log: (m: string) => void
  ) {}

  /**
   * (Ri)avvia la sorveglianza sulle cartelle indicate. Chiamata all'avvio e ogni volta che
   * l'utente aggiunge o rimuove una cartella.
   */
  async start (folders: WatchedFolder[]): Promise<void> {
    await this.stop()
    if (folders.length === 0) return
    this.watcher = watch(folders.map((f) => f.path), {
      // Ignora cartelle nascoste e di sistema (es. .git, node_modules) e i file non supportati.
      // La regola sulle cartelle nascoste vale solo SOTTO la cartella sorvegliata: la cartella
      // stessa può trovarsi dentro una cartella nascosta (bug trovato con il team demo in .demo/).
      ignored: (p, stats) => {
        const root = folderOf(p, folders)
        const rel = root ? norm(p).slice(norm(root.path).replace(/\/$/, '').length) : norm(p)
        return /\/(\.[^/]+|node_modules)(\/|$)/.test(rel) || (!!stats?.isFile() && !isSupported(p))
      },
      // Attende che il file smetta di cambiare prima di segnalarlo (salvataggi a più riprese).
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 300 },
      ignoreInitial: false
    })
    const onFile = (file: string) => { this.consider(file, folders).catch((e) => this.log(`documento ${file}: ${e.message}`)) }
    this.watcher.on('add', onFile).on('change', onFile).on('unlink', (file) => this.removed(file))
    this.watcher.on('error', (e) => this.log(`errore sorveglianza documenti: ${(e as Error).message}`))
    this.log(`sorveglianza documenti attiva su ${folders.length} cartelle`)
  }

  async stop (): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
  }

  /** Valuta un file aggiunto o modificato: se il contenuto è nuovo, lo accoda. */
  private async consider (file: string, folders: WatchedFolder[]): Promise<void> {
    if (!isSupported(file)) return
    const folder = folderOf(file, folders)
    if (!folder) return
    // Chiave del documento: percorso nel formato del sistema operativo, come nella configurazione.
    file = path.resolve(file)
    const size = fs.statSync(file).size
    if (size > MAX_DOCUMENT_BYTES) return this.log(`documento ignorato (oltre ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB): ${file}`)
    const hash = await hashFile(file)
    const prev = this.store.getDocument(file)
    if (prev && prev.hash === hash && prev.status !== 'removed') return // invariato: niente da fare
    this.pipeline.enqueueDocument({ path: file, folder: folder.path, hash, size })
    this.log(`documento accodato: ${file}`)
  }

  /** Il file è stato cancellato: l'originale non è più scaricabile. */
  private removed (file: string): void {
    const prev = this.store.getDocument(path.resolve(file))
    if (prev) this.store.saveDocument({ ...prev, status: 'removed' })
  }
}
