/** Costellazione (src/graph/constellation.ts): collegamenti per tag pesati per rarità, potatura. */
import { describe, expect, it } from 'vitest'
import type { RecallHit } from '../../src/core/model'
import { buildGraph, keepStrongest } from '../../src/graph/constellation'

const m = (id: string, tags: string[]): RecallHit => ({ id, kind: 'fact', title: id, body: '', tags, author: 'k', authorName: 'alice', ts: 0, score: 0 })

describe('buildGraph', () => {
  it('collega i ricordi con tag in comune; i tag rari pesano di più', () => {
    const g = buildGraph([m('a', ['raro', 'comune']), m('b', ['raro', 'comune']), m('c', ['comune']), m('d', ['comune']), m('e', [])])
    const ab = g.links.find((l) => [l.source, l.target].sort().join() === 'a,b')!
    const cd = g.links.find((l) => [l.source, l.target].sort().join() === 'c,d')!
    expect(ab.weight).toBe(1) // il legame più forte è normalizzato a 1
    expect(cd.weight).toBeLessThan(ab.weight)
    expect(g.nodes).toHaveLength(5)
  })

  it('un tag presente in tutti i ricordi non crea collegamenti', () => {
    expect(buildGraph([m('a', ['x']), m('b', ['x'])]).links).toEqual([])
  })

  it('ogni nodo tiene al massimo k collegamenti, ma nessun vicino resta isolato per la potatura', () => {
    const links = ['b', 'c', 'd', 'e'].map((t, i) => ({ source: 'a', target: t, weight: 1 - i * 0.1, kind: 'tags' as const }))
    // "a" ne terrebbe solo 2, ma ogni vicino tiene il proprio unico collegamento: restano tutti.
    expect(keepStrongest(links, 2)).toHaveLength(4)
  })
})
