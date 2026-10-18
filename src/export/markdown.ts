/**
 * @file Export Markdown in sola lettura del sapere del team (DESIGN §12).
 *
 * Scopo: poter sfogliare i ricordi a mano (con un editor o con Obsidian) e fare debug.
 * La cartella viene RIGENERATA dalla vista a ogni aggiornamento: le modifiche manuali ai file
 * vanno perse. Per cambiare un ricordo si passa sempre da Micelio.
 *
 * Struttura: <export>/team/<kind>/<slug-del-titolo>-<8 caratteri dell'id>.md
 * Il pezzo di id nel nome evita collisioni tra ricordi con lo stesso titolo.
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
 */
export function slugify (s: string): string {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // separa e rimuove gli accenti
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'ricordo'
}

/**
 * Rende un ricordo come Markdown con frontmatter YAML (leggibile da Obsidian e simili).
 * I valori testuali passano da JSON.stringify per essere YAML validi anche con ":" o virgolette.
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
    ...(m.source.code?.project ? [`project: ${JSON.stringify(m.source.code.project)}`] : []),
    '---'
  ].join('\n')
  // Riferimenti al codice in chiaro sotto il titolo: dove approfondire
  const refs = formatCodeRefs(m.source.code).map((l) => `> ${l}  `).join('\n')
  return `${fm}\n\n# ${m.title}\n\n${refs ? refs + '\n\n' : ''}${m.body}\n`
}

/**
 * Riscrive l'export: un file per ricordo e rimozione di quelli non più presenti.
 *
 * Scrive un file solo se il contenuto è cambiato, così gli strumenti che osservano la cartella
 * (Obsidian, sincronizzatori) non vedono modifiche inutili a ogni aggiornamento.
 */
/**
 * Cosa contiene ogni file dell'export, per cartella: si rilegge dal disco solo la PRIMA volta.
 * Prima ogni aggiornamento rileggeva tutti i file per vedere se erano cambiati: con 1 300 ricordi
 * mezzo secondo a ogni scrittura. Ora si scrivono e si cancellano solo i file davvero cambiati.
 */
const written = new Map<string, Map<string, string>>()

/** Contenuto attuale dei file dell'export (dal disco, una volta per cartella e per processo). */
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
  for (const m of memories) {
    const file = path.join(teamDir, m.kind, `${slugify(m.title)}-${m.id.slice(0, 8)}.md`)
    wanted.add(file)
    const content = renderMemory(m, names.get(m.author) ?? null)
    if (known.get(file) === content) continue
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    known.set(file, content)
  }

  // Pulizia: elimina i file che non corrispondono più a un ricordo (archiviato, sostituito,
  // redatto, o titolo cambiato).
  for (const file of [...known.keys()]) {
    if (wanted.has(file)) continue
    fs.rmSync(file, { force: true })
    known.delete(file)
  }
}
