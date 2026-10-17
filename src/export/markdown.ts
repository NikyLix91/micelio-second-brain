// Export Markdown in sola lettura (DESIGN §12): una cartella consultabile a mano (es. con
// Obsidian) e utile per il debug. Viene rigenerata dalla vista: le modifiche manuali si perdono.
import fs from 'node:fs'
import path from 'node:path'
import type { MemberRecord, MemoryRecord } from '../core/model'

const README = `# Micelio — export in sola lettura

Questa cartella è generata automaticamente dal nodo Micelio a partire dal sapere del team.
**Non modificare i file:** vengono sovrascritti a ogni aggiornamento.
`

export function slugify (s: string): string {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'ricordo'
}

export function renderMemory (m: MemoryRecord, authorName: string | null): string {
  const fm = [
    '---',
    `id: ${m.id}`,
    `kind: ${m.kind}`,
    `tags: [${m.tags.map((t) => JSON.stringify(t)).join(', ')}]`,
    `author: ${JSON.stringify(authorName ?? m.author.slice(0, 12))}`,
    `created: ${new Date(m.ts).toISOString()}`,
    `source: ${m.source.type}`,
    '---'
  ].join('\n')
  return `${fm}\n\n# ${m.title}\n\n${m.body}\n`
}

/** Riscrive l'export: un file per ricordo in team/<kind>/, rimuovendo quelli non più presenti. */
export function writeExport (dir: string, memories: MemoryRecord[], members: MemberRecord[]): void {
  const teamDir = path.join(dir, 'team')
  fs.mkdirSync(teamDir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'README.md'), README)

  const names = new Map(members.map((u) => [u.key, u.name]))
  const wanted = new Set<string>()
  for (const m of memories) {
    const file = path.join(teamDir, m.kind, `${slugify(m.title)}-${m.id.slice(0, 8)}.md`)
    wanted.add(file)
    const content = renderMemory(m, names.get(m.author) ?? null)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) fs.writeFileSync(file, content)
  }

  for (const kind of fs.readdirSync(teamDir)) {
    const kindDir = path.join(teamDir, kind)
    if (!fs.statSync(kindDir).isDirectory()) continue
    for (const f of fs.readdirSync(kindDir)) {
      const file = path.join(kindDir, f)
      if (!wanted.has(file)) fs.rmSync(file)
    }
  }
}
