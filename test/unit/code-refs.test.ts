/**
 * Formato testuale dei riferimenti al codice (src/core/code-refs.ts), usato da MCP, CLI ed export.
 *
 * EN: Text format of code references (src/core/code-refs.ts), used by MCP, CLI and export.
 */
import { describe, expect, it } from 'vitest'
import { formatCodeRefs } from '../../src/core/code-refs'
import { renderMemory } from '../../src/export/markdown'

const code = {
  project: 'ordini',
  branch: 'main',
  repo: 'https://github.com/org/ordini',
  files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts'],
  symbols: ['class OrderService'],
  commits: ['1a2b3c4d5e6f7a8b9c0d']
}

describe('formatCodeRefs', () => {
  it('forma completa: tutte le voci, hash abbreviati', () => {
    expect(formatCodeRefs(code)).toEqual([
      'Progetto: ordini (branch main) · https://github.com/org/ordini',
      'File: `a.ts`, `b.ts`, `c.ts`, `d.ts`, `e.ts`, `f.ts`, `g.ts`',
      'Simboli: class OrderService',
      'Commit: 1a2b3c4d'
    ])
  })

  it('forma compatta: elenchi troncati con il conteggio del resto; nessun riferimento → nessuna riga', () => {
    expect(formatCodeRefs(code, false)[1]).toBe('File: `a.ts`, `b.ts`, `c.ts`, `d.ts`, `e.ts`, `f.ts` (+1)')
    expect(formatCodeRefs(undefined)).toEqual([])
  })

  it('export Markdown: progetto nel frontmatter e riferimenti sotto il titolo', () => {
    const md = renderMemory({ id: 'x'.repeat(64), kind: 'decision', title: 'T', body: 'B', tags: [], source: { type: 'claude-code', code }, author: 'a'.repeat(64), ts: 0 } as any, 'alice')
    expect(md).toContain('project: "ordini"')
    expect(md).toContain('> Commit: 1a2b3c4d')
  })
})
