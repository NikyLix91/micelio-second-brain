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
 *
 * EN: Watching of document folders (Phase 4, DESIGN §6.1–6.2).
 *
 * EN: For each configured folder (`watch.documents` in config.json) it watches new and modified
 * files with `chokidar`. For each one it computes the content hash and, if it changed since the
 * last processing (`documents` table of the private store), queues it in the pipeline.
 *
 * EN: INCREMENTAL processing: an unchanged document is never processed again, not even after a
 * restart (at startup chokidar reports all existing files, but the hash is the same).
 * A deleted file is marked "removed": the memories already distilled stay in the team (they are
 * acquired knowledge), but the original can no longer be downloaded.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { type FSWatcher, watch } from 'chokidar'
import type { IngestPipeline } from './pipeline'
import type { PrivateStore } from '../store/private-store'
import { isSupported, MAX_DOCUMENT_BYTES } from './extract'

/** Hash SHA-256 del contenuto di un file, letto a blocchi (anche file grandi senza caricarli in memoria). / EN: SHA-256 hash of a file's content, read in chunks (even large files, without loading them into memory). */
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
 *
 * EN: Comparable form of a path: "/" separators and lowercase. chokidar passes paths with
 * "/" even on Windows, while the configuration uses "\": without normalizing, comparisons
 * failed and no document was detected (bug found with the demo team).
 */
const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()

/** La cartella sorvegliata che contiene `file`, se c'è. / EN: The watched folder that contains `file`, if any. */
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
   *
   * EN: (Re)starts watching the given folders. Called at startup and every time the
   * user adds or removes a folder.
   */
  async start (folders: WatchedFolder[]): Promise<void> {
    await this.stop()
    if (folders.length === 0) return
    this.watcher = watch(folders.map((f) => f.path), {
      // Ignora cartelle nascoste e di sistema (es. .git, node_modules) e i file non supportati.
      // La regola sulle cartelle nascoste vale solo SOTTO la cartella sorvegliata: la cartella
      // stessa può trovarsi dentro una cartella nascosta (bug trovato con il team demo in .demo/).
      // EN: Ignores hidden and system folders (e.g. .git, node_modules) and unsupported files.
      //     The hidden-folder rule applies only BELOW the watched folder: the folder itself
      //     may sit inside a hidden folder (bug found with the demo team in .demo/).
      ignored: (p, stats) => {
        const root = folderOf(p, folders)
        const rel = root ? norm(p).slice(norm(root.path).replace(/\/$/, '').length) : norm(p)
        return /\/(\.[^/]+|node_modules)(\/|$)/.test(rel) || (!!stats?.isFile() && !isSupported(p))
      },
      // Attende che il file smetta di cambiare prima di segnalarlo (salvataggi a più riprese).
      // EN: Waits for the file to stop changing before reporting it (saves done in several steps).
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

  /** Valuta un file aggiunto o modificato: se il contenuto è nuovo, lo accoda. / EN: Evaluates an added or modified file: if the content is new, queues it. */
  private async consider (file: string, folders: WatchedFolder[]): Promise<void> {
    if (!isSupported(file)) return
    const folder = folderOf(file, folders)
    if (!folder) return
    // Chiave del documento: percorso nel formato del sistema operativo, come nella configurazione.
    // EN: Document key: path in the OS format, as in the configuration.
    file = path.resolve(file)
    const size = fs.statSync(file).size
    if (size > MAX_DOCUMENT_BYTES) return this.log(`documento ignorato (oltre ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB): ${file}`)
    const hash = await hashFile(file)
    const prev = this.store.getDocument(file)
    if (prev && prev.hash === hash && prev.status !== 'removed') return // invariato: niente da fare / EN: unchanged: nothing to do
    this.pipeline.enqueueDocument({ path: file, folder: folder.path, hash, size })
    this.log(`documento accodato: ${file}`)
  }

  /** Il file è stato cancellato: l'originale non è più scaricabile. / EN: The file was deleted: the original can no longer be downloaded. */
  private removed (file: string): void {
    const prev = this.store.getDocument(path.resolve(file))
    if (prev) this.store.saveDocument({ ...prev, status: 'removed' })
  }
}
