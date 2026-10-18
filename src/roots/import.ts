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
 *
 * Intestazione YAML (frontmatter, tipica di Obsidian): `title` e `tags` diventano titolo e tag del
 * ricordo, e l'intestazione esce dal testo (prima finiva in testa al corpo: «title: …»).
 * Ogni elemento ha una CHIAVE stabile (percorso relativo, più la sezione per CLAUDE.md): reimportare
 * la stessa cartella AGGIORNA i ricordi dei file cambiati invece di duplicarli (vedi importRoots).
 */
import fs from 'node:fs'
import path from 'node:path'
import { withoutMicelioBlock } from './agent-files'

/** Un elemento da importare. */
export interface ImportItem {
  title: string
  body: string
  /** Nome del file (senza percorso): finisce in `source.name`. */
  file: string
  kind: 'decision' | 'fact'
  /** Tag dall'intestazione YAML (minuscoli, senza #). */
  tags: string[]
  /** Chiave stabile: percorso relativo alla cartella importata (+ «#sezione»). Finisce in `source.ref`. */
  key: string
}

/** Intestazione YAML in testa a un file Markdown: `title`, `tags` e il testo che segue. */
export function parseFrontmatter (text: string): { title?: string, tags: string[], body: string } {
  const m = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/)
  if (!m) return { tags: [], body: text }
  const yaml = m[1]
  const unquote = (v: string) => v.trim().replace(/^["']|["']$/g, '').trim()
  const title = yaml.match(/^title:[ \t]*(.+)$/m)?.[1]
  let tags: string[] = []
  const inline = yaml.match(/^tags:[ \t]*(.+)$/m)?.[1]
  if (inline) {
    tags = inline.replace(/^\[|\]$/g, '').split(',').map(unquote)
  } else {
    // forma a elenco:  tags:\n  - a\n  - b
    const block = yaml.match(/^tags:[ \t]*\n((?:[ \t]*-[ \t]*.+\n?)+)/m)?.[1]
    if (block) tags = block.split('\n').map((l) => unquote(l.replace(/^[ \t]*-[ \t]*/, ''))).filter(Boolean)
  }
  const norm = tags.map((t) => t.replace(/^#/, '').toLowerCase().replace(/\s+/g, '-')).filter((t) => t.length > 0 && t.length <= 50)
  return { ...(title ? { title: unquote(title) } : {}), tags: [...new Set(norm)].slice(0, 20), body: text.slice(m[0].length) }
}

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

/**
 * Titolo e corpo di un file: titolo dall'intestazione YAML, altrimenti dal primo `# titolo`,
 * altrimenti dal nome del file. Il `# titolo` esce comunque dal corpo (sarebbe un doppione).
 */
function wholeFile (file: string, text: string, adr: boolean, key: string): ImportItem | null {
  const fm = parseFrontmatter(text)
  const h1 = fm.body.match(/^#\s+(.+)$/m)
  const title = (fm.title ?? h1?.[1] ?? path.basename(file).replace(/\.(md|markdown)$/i, '').replace(/[-_]+/g, ' ')).trim()
  const body = (h1 ? fm.body.replace(h1[0], '') : fm.body).trim()
  if (title.length < 3 || !body) return null
  return { title: title.slice(0, 200), body: body.slice(0, MAX_BODY), file: path.basename(file), kind: adr ? 'decision' : 'fact', tags: fm.tags, key }
}

/** Le sezioni `## …` di un file di istruzioni (CLAUDE.md, AGENTS.md). */
function sections (file: string, text: string, key: string): ImportItem[] {
  const out: ImportItem[] = []
  const fm = parseFrontmatter(withoutMicelioBlock(text))
  const parts = fm.body.split(/^##\s+/m).slice(1)
  for (const part of parts) {
    const [head, ...rest] = part.split('\n')
    const body = rest.join('\n').trim()
    if (head.trim().length >= 3 && body) out.push({ title: head.trim().slice(0, 200), body: body.slice(0, MAX_BODY), file: path.basename(file), kind: 'fact', tags: fm.tags, key: `${key}#${head.trim()}`.slice(0, 200) })
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
    // Chiave stabile: percorso relativo alla cartella importata (al file stesso se è un file solo)
    const key = (path.relative(fs.statSync(target).isDirectory() ? target : path.dirname(target), f).replace(/\\/g, '/') || path.basename(f)).slice(0, 180)
    if (SECTIONED.test(path.basename(f))) items.push(...sections(f, text, key))
    else {
      const it = wholeFile(f, withoutMicelioBlock(text), adr, key)
      if (it) items.push(it)
    }
  }
  return items
}
