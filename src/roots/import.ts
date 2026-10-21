/**
 * @file Import di sapere già scritto come Radici (B4): ADR, CLAUDE.md / AGENTS.md, vault Markdown.
 *
 * EN: Import of already written knowledge as Roots (B4): ADRs, CLAUDE.md / AGENTS.md, Markdown vaults.
 *
 * Molti team hanno già il loro sapere fondante in file: decisioni architetturali (ADR, una per
 * file), istruzioni per gli agenti (CLAUDE.md, a sezioni), note di un vault (Obsidian). Invece di
 * riscriverlo, lo si importa: ogni file (o ogni sezione `##` di CLAUDE.md / AGENTS.md) diventa un
 * ricordo e subito una Radice.
 *
 * EN: Many teams already keep their foundational knowledge in files: architecture decisions (ADRs, one
 * per file), instructions for agents (CLAUDE.md, in sections), notes in a vault (Obsidian). Instead of
 * rewriting it, you import it: each file (or each `##` section of CLAUDE.md / AGENTS.md) becomes a
 * memory and immediately a Root.
 *
 * Niente LLM: il testo resta quello scritto dal team (passa comunque dal filtro dei segreti, e i
 * contenuti bloccati non entrano). Il blocco che Micelio stesso scrive nei file degli agenti si
 * salta, per non reimportare le Radici da cui è nato.
 *
 * EN: No LLM: the text stays as the team wrote it (it still goes through the secrets filter, and
 * blocked content does not get in). The block Micelio itself writes into the agent files is
 * skipped, so the Roots it came from are not imported again.
 *
 * Intestazione YAML (frontmatter, tipica di Obsidian): `title` e `tags` diventano titolo e tag del
 * ricordo, e l'intestazione esce dal testo (prima finiva in testa al corpo: «title: …»).
 * Ogni elemento ha una CHIAVE stabile (percorso relativo, più la sezione per CLAUDE.md): reimportare
 * la stessa cartella AGGIORNA i ricordi dei file cambiati invece di duplicarli (vedi importRoots).
 *
 * EN: YAML header (frontmatter, typical of Obsidian): `title` and `tags` become the memory's title and
 * tags, and the header is removed from the text (before, it ended up at the top of the body: «title: …»).
 * Each item has a stable KEY (relative path, plus the section for CLAUDE.md): re-importing
 * the same folder UPDATES the memories of changed files instead of duplicating them (see importRoots).
 */
import fs from 'node:fs'
import path from 'node:path'
import { withoutMicelioBlock } from './agent-files'

/** Un elemento da importare. / EN: An item to import. */
export interface ImportItem {
  title: string
  body: string
  /** Nome del file (senza percorso): finisce in `source.name`. / EN: File name (no path): goes into `source.name`. */
  file: string
  kind: 'decision' | 'fact'
  /** Tag dall'intestazione YAML (minuscoli, senza #). / EN: Tags from the YAML header (lowercase, no #). */
  tags: string[]
  /** Chiave stabile: percorso relativo alla cartella importata (+ «#sezione»). Finisce in `source.ref`. / EN: Stable key: path relative to the imported folder (+ «#section»). Goes into `source.ref`. */
  key: string
}

/** Intestazione YAML in testa a un file Markdown: `title`, `tags` e il testo che segue. / EN: YAML header at the top of a Markdown file: `title`, `tags` and the text that follows. */
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
    // EN: list form:  tags:\n  - a\n  - b
    const block = yaml.match(/^tags:[ \t]*\n((?:[ \t]*-[ \t]*.+\n?)+)/m)?.[1]
    if (block) tags = block.split('\n').map((l) => unquote(l.replace(/^[ \t]*-[ \t]*/, ''))).filter(Boolean)
  }
  const norm = tags.map((t) => t.replace(/^#/, '').toLowerCase().replace(/\s+/g, '-')).filter((t) => t.length > 0 && t.length <= 50)
  return { ...(title ? { title: unquote(title) } : {}), tags: [...new Set(norm)].slice(0, 20), body: text.slice(m[0].length) }
}

/** Limiti: file per import, profondità delle cartelle, dimensione di un file. / EN: Limits: files per import, folder depth, file size. */
const MAX_FILES = 300
const MAX_DEPTH = 4
const MAX_BYTES = 200_000
/** Limite del corpo di un ricordo (vedi MemoryInput). / EN: Limit of a memory body (see MemoryInput). */
const MAX_BODY = 20_000

/** File di istruzioni per agenti: si importano a sezioni. / EN: Agent instruction files: imported by section. */
const SECTIONED = /^(claude|agents)\.md$/i

/** File Markdown di una cartella (ricorsivo, senza cartelle nascoste e node_modules). / EN: Markdown files of a folder (recursive, skipping hidden folders and node_modules). */
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
 *
 * EN: Title and body of a file: title from the YAML header, otherwise from the first `# titolo`,
 * otherwise from the file name. The `# titolo` is removed from the body anyway (it would be a duplicate).
 */
function wholeFile (file: string, text: string, adr: boolean, key: string): ImportItem | null {
  const fm = parseFrontmatter(text)
  const h1 = fm.body.match(/^#\s+(.+)$/m)
  const title = (fm.title ?? h1?.[1] ?? path.basename(file).replace(/\.(md|markdown)$/i, '').replace(/[-_]+/g, ' ')).trim()
  const body = (h1 ? fm.body.replace(h1[0], '') : fm.body).trim()
  if (title.length < 3 || !body) return null
  return { title: title.slice(0, 200), body: body.slice(0, MAX_BODY), file: path.basename(file), kind: adr ? 'decision' : 'fact', tags: fm.tags, key }
}

/** Le sezioni `## …` di un file di istruzioni (CLAUDE.md, AGENTS.md). / EN: The `## …` sections of an instruction file (CLAUDE.md, AGENTS.md). */
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
 *
 * EN: Items to import from a file or a folder.
 * A file or folder with "adr" in its path produces decisions (`decision`), everything else facts.
 * @throws Error se il percorso non esiste
 *         EN: Error if the path does not exist
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
    // EN: Stable key: path relative to the imported folder (to the file itself for a single file)
    const key = (path.relative(fs.statSync(target).isDirectory() ? target : path.dirname(target), f).replace(/\\/g, '/') || path.basename(f)).slice(0, 180)
    if (SECTIONED.test(path.basename(f))) items.push(...sections(f, text, key))
    else {
      const it = wholeFile(f, withoutMicelioBlock(text), adr, key)
      if (it) items.push(it)
    }
  }
  return items
}
