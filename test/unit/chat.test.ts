// B10: chat sulla memoria. Vicini da aggiungere, temi della mappa mentale, materiale per l'LLM.
import { describe, expect, it } from 'vitest'
import { buildMindMap, chatInput, type ChatMemory, expandWithNeighbors, lineOf, type MapLink } from '../../src/insight/chat'

const mem = (id: string, tags: string[], extra: Partial<ChatMemory> = {}): ChatMemory =>
  ({ id, title: `Ricordo ${id}`, body: `Corpo del ricordo ${id}. Seconda frase.`, kind: 'howto', tags, score: 1, activation: 0.5, authorName: 'ada', ...extra })

const link = (a: string, b: string, weight = 0.5, kind: MapLink['kind'] = 'tags', rel?: string): MapLink => ({ source: a, target: b, weight, kind, ...(rel ? { rel } : {}) })

describe('chat: ricordi e mappa mentale', () => {
  it('ai ricordi trovati si aggiungono i vicini più legati (prima quelli del dreaming), fino al massimo', () => {
    const links = [link('a', 'x', 0.3), link('a', 'y', 0.3, 'dream', 'refines'), link('b', 'z', 0.9), link('x', 'w', 1)]
    expect(expandWithNeighbors(['a', 'b'], links, 4)).toEqual(['a', 'b', 'z', 'y'])
    expect(expandWithNeighbors(['a', 'b'], links, 10)).toEqual(['a', 'b', 'z', 'y', 'x']) // w è a due passi
  })

  it('i temi sono comunità dei collegamenti; i ricordi senza collegamenti vanno in "Altro"', () => {
    const memories = [mem('a', ['kafka', 'retry']), mem('b', ['kafka']), mem('c', ['kafka', 'retry']), mem('d', ['postgres']), mem('e', ['postgres', 'indici']), mem('f', ['pdf'])]
    const links = [link('a', 'b', 0.8), link('b', 'c', 0.8), link('a', 'c', 0.8), link('d', 'e', 0.9, 'dream', 'depends-on')]
    const map = buildMindMap('come gestiamo i retry?', memories, links, new Set(['a', 'd']))
    expect(map.themes.map((t) => t.memories.sort())).toEqual([['a', 'b', 'c'], ['d', 'e'], ['f']])
    expect(map.themes[0].label).toContain('kafka')
    expect(map.themes[2]).toMatchObject({ id: -1, label: '' }) // "Altro"
    expect(map.links.find((l) => l.kind === 'dream')).toMatchObject({ source: 'd', target: 'e', rel: 'depends-on' })
    expect(map.memories.find((m) => m.id === 'a')).toMatchObject({ found: true, line: 'Corpo del ricordo a.' })
    expect(map.memories.find((m) => m.id === 'b')!.found).toBe(false)
  })

  it('il materiale per l\'LLM numera i ricordi, segnala le Radici, porta le ultime 3 domande', () => {
    const memories = [mem('a', ['kafka'], { root: { category: 'practice' } }), mem('b', ['kafka'])]
    const map = buildMindMap('retry?', memories, [link('a', 'b')], new Set(['a']))
    const history = [1, 2, 3, 4].map((i) => ({ question: `domanda ${i}`, answer: `risposta ${i}` }))
    const { input, numbers } = chatInput('e i timeout?', memories, map, history)
    expect([...numbers]).toEqual([[1, 'a'], [2, 'b']])
    expect(input).toContain('[1] Ricordo a  (howto · RADICE (practice) · #kafka)')
    expect(input).toContain('tema 0: ricordi 1, 2')
    expect(input).not.toContain('domanda 1') // solo le ultime 3
    expect(input).toContain('domanda 4')
    expect(input.trim().endsWith('e i timeout?')).toBe(true)
  })

  it('prima riga leggibile: senza Markdown né blocchi di codice, tagliata', () => {
    expect(lineOf('**Usa** `npm ci` in CI. Poi il resto.')).toBe('Usa npm ci in CI.')
    expect(lineOf('```\ncodice\n```\nTesto dopo il codice.')).toBe('Testo dopo il codice.')
    expect(lineOf('x'.repeat(300)).length).toBe(140)
  })
})
