/**
 * File per gli agenti dalle Radici e import di sapere già scritto (B4):
 * - il blocco di Micelio si inserisce fra i marcatori senza toccare il resto del file, non contiene
 *   date (si riscrive solo se cambia), le Radici sono raggruppate e compatte;
 * - l'import legge ADR (una decisione per file), CLAUDE.md a sezioni (saltando il blocco di
 *   Micelio) e note Markdown.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RecallHit } from '../../src/core/model'
import { BLOCK_END, mergeAgentFile, renderRootsBlock, writeAgentFile } from '../../src/roots/agent-files'
import { parseFrontmatter, readImport } from '../../src/roots/import'
import { tmpHome } from '../helpers'

const root = (n: number, category: string, extra: Partial<RecallHit> = {}): RecallHit =>
  ({ id: String(n).repeat(64).slice(0, 64), kind: 'decision', title: `Radice ${n}`, body: `Primo paragrafo ${n}.\n\nSecondo paragrafo.`, tags: [], author: 'a', authorName: 'ada', ts: 0, score: 0, root: { category, status: 'ok' }, ...extra }) as RecallHit

describe('file per gli agenti', () => {
  const block = renderRootsBlock({ team: 'Prodotto', project: 'ordini', roots: [root(2, 'policy'), root(1, 'architecture', { root: { category: 'architecture', status: 'review' } })] })

  it('Radici per categoria, compatte, con id; nessuna data', () => {
    expect(block.indexOf('### Architettura')).toBeLessThan(block.indexOf('### Policy'))
    expect(block).toContain(`- **Radice 1** (da rivedere) — Primo paragrafo 1. (id: ${'1'.repeat(12)})`)
    expect(block).not.toContain('Secondo paragrafo')
    expect(block).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(block.endsWith(BLOCK_END)).toBe(true)
  })

  it('CLAUDE.md: il blocco si aggiunge in fondo e poi si sostituisce, il resto resta', () => {
    const mine = '# Istruzioni del team\n\nUsa sempre pnpm.\n'
    const once = mergeAgentFile('claude', mine, block)
    expect(once.startsWith(mine.trim())).toBe(true)
    const updated = mergeAgentFile('claude', once + '\n## Nota scritta dopo\nAltro.\n', block.replace('Radice 1', 'Radice uno'))
    expect(updated).toContain('Radice uno')
    expect(updated).not.toContain('**Radice 1**')
    expect(updated).toContain('Usa sempre pnpm.')
    expect(updated).toContain('## Nota scritta dopo')
    expect(mergeAgentFile('cursor', null, block)).toMatch(/^---\ndescription: .+\nalwaysApply: true\n---\n/)
  })

  it('si riscrive solo se il contenuto cambia', () => {
    const dir = tmpHome('agent-files')
    expect(writeAgentFile(dir, 'agents', block).changed).toBe(true)
    expect(writeAgentFile(dir, 'agents', block).changed).toBe(false)
    expect(writeAgentFile(dir, 'cursor', block).file).toBe(path.join(dir, '.cursor', 'rules', 'micelio.mdc'))
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('import di sapere già scritto', () => {
  it('ADR come decisioni, CLAUDE.md a sezioni senza il blocco di Micelio, note come fatti', () => {
    const dir = tmpHome('import')
    fs.mkdirSync(path.join(dir, 'docs', 'adr'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docs', 'adr', '0001-eventi-kafka.md'), '# Eventi su Kafka\n\nStato: accettata\n\nGli ordini pubblicano eventi su Kafka.')
    fs.writeFileSync(path.join(dir, 'docs', 'note-deploy.md'), 'Il deploy usa blu-verde.')
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `# Progetto\n\n## Test\nUsa vitest.\n\n## Stile\nNiente any.\n\n${renderRootsBlock({ team: 'T', project: 'p', roots: [root(9, 'policy')] })}\n`)
    fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'README.md'), '# Da ignorare\n\ntesto')

    const items = readImport(dir)
    const byTitle = new Map(items.map((i) => [i.title, i]))
    expect(byTitle.get('Eventi su Kafka')).toMatchObject({ kind: 'decision', file: '0001-eventi-kafka.md' })
    expect(byTitle.get('Eventi su Kafka')!.body.startsWith('Stato: accettata')).toBe(true)
    expect(byTitle.get('note deploy')).toMatchObject({ kind: 'fact', body: 'Il deploy usa blu-verde.' })
    expect(byTitle.get('Test')?.body).toBe('Usa vitest.')
    expect(byTitle.get('Stile')?.body).toBe('Niente any.')
    expect([...byTitle.keys()]).not.toContain('Sapere fondante del team (Micelio)')
    expect([...byTitle.keys()]).not.toContain('Da ignorare')
    expect(() => readImport(path.join(dir, 'non-esiste'))).toThrow(/inesistente/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

describe('vault Obsidian', () => {
  it('l\'intestazione YAML dà titolo e tag ed esce dal testo; nessun tag "import"', () => {
    expect(parseFrontmatter('---\ntitle: "Map of Content"\ntags: [Architettura, #docker, Team Dati]\n---\n# 🗺️ Map\n\ncorpo')).toEqual({ title: 'Map of Content', tags: ['architettura', 'docker', 'team-dati'], body: '# 🗺️ Map\n\ncorpo' })
    expect(parseFrontmatter('---\ntags:\n  - a\n  - b\n---\ntesto').tags).toEqual(['a', 'b'])
    expect(parseFrontmatter('nessuna intestazione')).toEqual({ tags: [], body: 'nessuna intestazione' })
    const dir = tmpHome('vault')
    fs.mkdirSync(path.join(dir, 'Tecnologie'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'Tecnologie', 'Docker.md'), '---\ntitle: Docker\ntags: [infra]\n---\n# Docker\n\nImmagini su Debian slim.')
    const [it] = readImport(dir)
    expect(it).toMatchObject({ title: 'Docker', body: 'Immagini su Debian slim.', tags: ['infra'], key: 'Tecnologie/Docker.md' })
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
})
