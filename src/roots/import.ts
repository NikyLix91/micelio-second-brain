/**
 * @file Import di sapere già scritto come Radici (B4): ADR, CLAUDE.md / AGENTS.md, vault Markdown.
 *
 * Molti team hanno già il loro sapere fondante in file: decisioni architetturali (ADR, una per
 * file), istruzioni per gli agenti (CLAUDE.md, a sezioni), note di un vault (Obsidian). Invece di
 * riscriverlo, lo si importa: ogni file (o ogni sezione `##` di CLAUDE.md / AGENTS.md) diventa un
 * ricordo e subito una Radice.
 *
 * Niente LLM: il testo resta quello scritto dal team (passa comunque dal filtro dei segreti, e i
 * contenuti bloccati non entrano). Il blocco che Micelio stesso scrive nei file degli agenti si
 * salta, per non reimportare le Radici da cui è nato.
 */
import fs from 'node:fs'
import path from 'node:path'
import { withoutMicelioBlock } from './agent-files'

/** Un elemento da importare. */
export interface ImportItem { title: string, body: string, file: string, kind: 'decision' | 'fact' }

/** Limiti: file per import, profondità delle cartelle, dimensione di un file. */
const MAX_FILES = 300
const MAX_DEPTH = 4
const MAX_BYTES = 200_000
/** Limite del corpo di un ricordo (vedi MemoryInput). */
const MAX_BODY = 20_000

/** File di istruzioni per agenti: si importano a sezioni. */
const SECTIONED = /^(claude|agents)\.md$/i

/** File Markdown di una cartella (ricorsivo, senza cartelle nascoste e node_modules). */
function markdownFiles (dir: string, depth = 0, out: string[] = []): string[] {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) markdownFiles(p, depth + 1, out)
    else if (/\.(md|markdown)$/i.test(e.name) && out.length < MAX_FILES) out.push(p)
  }
  return out
}

/** Titolo e corpo di un file: il primo `# titolo`, altrimenti il nome del file. */
function wholeFile (file: string, text: string, adr: boolean): ImportItem | null {
  const h1 = text.match(/^#\s+(.+)$/m)
  const title = (h1?.[1] ?? path.basename(file).replace(/\.(md|markdown)$/i, '').replace(/[-_]+/g, ' ')).trim()
  const body = (h1 ? text.replace(h1[0], '') : text).trim()
  if (title.length < 3 || !body) return null
  return { title: title.slice(0, 200), body: body.slice(0, MAX_BODY), file: path.basename(file), kind: adr ? 'decision' : 'fact' }
}

/** Le sezioni `## …` di un file di istruzioni (CLAUDE.md, AGENTS.md). */
function sections (file: string, text: string): ImportItem[] {
  const out: ImportItem[] = []
  const parts = withoutMicelioBlock(text).split(/^##\s+/m).slice(1)
  for (const part of parts) {
    const [head, ...rest] = part.split('\n')
    const body = rest.join('\n').trim()
    if (head.trim().length >= 3 && body) out.push({ title: head.trim().slice(0, 200), body: body.slice(0, MAX_BODY), file: path.basename(file), kind: 'fact' })
  }
  return out
}

/**
 * Elementi da importare da un file o da una cartella.
 * Un file o una cartella con "adr" nel percorso produce decisioni (`decision`), il resto fatti.
 * @throws Error se il percorso non esiste
 */
export function readImport (target: string): ImportItem[] {
  if (!fs.existsSync(target)) throw new Error(`Percorso inesistente: ${target}`)
  const files = fs.statSync(target).isDirectory() ? markdownFiles(target) : [target]
  const items: ImportItem[] = []
  for (const f of files) {
    if (fs.statSync(f).size > MAX_BYTES) continue
    const text = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    const adr = /(^|[\\/])(adr|adrs|decisions?)([\\/]|$)/i.test(path.relative(path.dirname(target), f)) || /^\d{3,4}-/.test(path.basename(f))
    if (SECTIONED.test(path.basename(f))) items.push(...sections(f, text))
    else {
      const it = wholeFile(f, withoutMicelioBlock(text), adr)
      if (it) items.push(it)
    }
  }
  return items
}
