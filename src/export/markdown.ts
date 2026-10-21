/**
 * @file Export Markdown in sola lettura del sapere del team (DESIGN §12).
 *
 * EN: Read-only Markdown export of the team knowledge (DESIGN §12).
 *
 * Scopo: poter sfogliare i ricordi a mano (con un editor o con Obsidian) e fare debug.
 * La cartella viene RIGENERATA dalla vista a ogni aggiornamento: le modifiche manuali ai file
 * vanno perse. Per cambiare un ricordo si passa sempre da Micelio.
 *
 * EN: Purpose: browsing the memories by hand (with an editor or with Obsidian) and debugging.
 * The folder is REGENERATED from the view on every update: manual changes to the files are
 * lost. To change a memory always go through Micelio.
 *
 * Struttura: <export>/team/<kind>/<slug-del-titolo>-<8 caratteri dell'id>.md
 * Il pezzo di id nel nome evita collisioni tra ricordi con lo stesso titolo.
 *
 * EN: Layout: <export>/team/<kind>/<title-slug>-<8 characters of the id>.md
 * The id fragment in the name avoids collisions between memories with the same title.
 */
import fs from 'node:fs'
import path from 'node:path'
import { formatCodeRefs } from '../core/code-refs'
import type { MemberRecord, MemoryRecord } from '../core/model'

const README = `# Micelio — export in sola lettura

Questa cartella è generata automaticamente dal nodo Micelio a partire dal sapere del team.
**Non modificare i file:** vengono sovrascritti a ogni aggiornamento.
`

/**
 * Converte un titolo in un nome di file sicuro su tutti i sistemi operativi:
 * senza accenti, minuscolo, solo [a-z0-9-], massimo 60 caratteri.
 *
 * EN: Turns a title into a file name that is safe on every operating system:
 * no accents, lowercase, only [a-z0-9-], at most 60 characters.
 */
export function slugify (s: string): string {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // separa e rimuove gli accenti / EN: splits off and removes accents
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'ricordo'
}

/**
 * Rende un ricordo come Markdown con frontmatter YAML (leggibile da Obsidian e simili).
 * I valori testuali passano da JSON.stringify per essere YAML validi anche con ":" o virgolette.
 *
 * EN: Renders a memory as Markdown with YAML frontmatter (readable by Obsidian and the like).
 * Text values go through JSON.stringify so they are valid YAML even with ":" or quotes.
 */
export function renderMemory (m: MemoryRecord, authorName: string | null): string {
  const fm = [
    '---',
    `id: ${m.id}`,
    `kind: ${m.kind}`,
    `tags: [${m.tags.map((t) => JSON.stringify(t)).join(', ')}]`,
    `author: ${JSON.stringify(authorName ?? m.author.slice(0, 12))}`,
    `created: ${new Date(m.ts).toISOString()}`,
    `source: ${m.source.type}`,
    // Progetto anche nel frontmatter, per filtrare l'export per progetto (es. in Obsidian)
    // EN: Project in the frontmatter too, to filter the export by project (e.g. in Obsidian)
    ...(m.source.code?.project ? [`project: ${JSON.stringify(m.source.code.project)}`] : []),
    '---'
  ].join('\n')
  // Riferimenti al codice in chiaro sotto il titolo: dove approfondire
  // EN: Plain code references under the title: where to dig deeper
  const refs = formatCodeRefs(m.source.code).map((l) => `> ${l}  `).join('\n')
  return `${fm}\n\n# ${m.title}\n\n${refs ? refs + '\n\n' : ''}${m.body}\n`
}

/**
 * Riscrive l'export: un file per ricordo e rimozione di quelli non più presenti.
 *
 * EN: Rewrites the export: one file per memory and removal of those no longer present.
 *
 * Scrive un file solo se il contenuto è cambiato, così gli strumenti che osservano la cartella
 * (Obsidian, sincronizzatori) non vedono modifiche inutili a ogni aggiornamento.
 *
 * EN: It writes a file only if its content changed, so tools watching the folder (Obsidian,
 * sync tools) don't see pointless changes on every update.
 */
/**
 * Cosa contiene ogni file dell'export, per cartella: si rilegge dal disco solo la PRIMA volta.
 * Prima ogni aggiornamento rileggeva tutti i file per vedere se erano cambiati: con 1 300 ricordi
 * mezzo secondo a ogni scrittura. Ora si scrivono e si cancellano solo i file davvero cambiati.
 *
 * EN: What each export file contains, per folder: it is read from disk only the FIRST time.
 * Before, every update re-read all the files to see whether they had changed: with 1,300
 * memories half a second per write. Now only the files that really changed are written or deleted.
 */
const written = new Map<string, Map<string, string>>()

/** Contenuto attuale dei file dell'export (dal disco, una volta per cartella e per processo). / EN: Current content of the export files (from disk, once per folder and per process). */
function knownFiles (teamDir: string): Map<string, string> {
  let known = written.get(teamDir)
  if (known) return known
  known = new Map()
  if (fs.existsSync(teamDir)) {
    for (const kind of fs.readdirSync(teamDir)) {
      const kindDir = path.join(teamDir, kind)
      if (!fs.statSync(kindDir).isDirectory()) continue
      for (const f of fs.readdirSync(kindDir)) known.set(path.join(kindDir, f), fs.readFileSync(path.join(kindDir, f), 'utf8'))
    }
  }
  written.set(teamDir, known)
  return known
}

export function writeExport (dir: string, memories: MemoryRecord[], members: MemberRecord[]): void {
  const teamDir = path.join(dir, 'team')
  const known = knownFiles(teamDir)
  if (!known.size) {
    fs.mkdirSync(teamDir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'README.md'), README)
  }

  const names = new Map(members.map((u) => [u.key, u.name]))
  const wanted = new Set<string>()
  // Cartelle già create in questo giro: una per tipo, non una chiamata al disco per ogni ricordo
  // EN: Folders already created in this pass: one per kind, not one disk call per memory
  const dirs = new Set<string>()
  for (const m of memories) {
    const file = path.join(teamDir, m.kind, `${slugify(m.title)}-${m.id.slice(0, 8)}.md`)
    wanted.add(file)
    const content = renderMemory(m, names.get(m.author) ?? null)
    if (known.get(file) === content) continue
    if (!dirs.has(path.dirname(file))) { fs.mkdirSync(path.dirname(file), { recursive: true }); dirs.add(path.dirname(file)) }
    fs.writeFileSync(file, content)
    known.set(file, content)
  }

  // Pulizia: elimina i file che non corrispondono più a un ricordo (archiviato, sostituito,
  // redatto, o titolo cambiato).
  // EN: Cleanup: deletes the files that no longer match a memory (archived, superseded,
  //     redacted, or title changed).
  for (const file of [...known.keys()]) {
    if (wanted.has(file)) continue
    fs.rmSync(file, { force: true })
    known.delete(file)
  }
}
