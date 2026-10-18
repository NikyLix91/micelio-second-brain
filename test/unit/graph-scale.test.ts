/**
 * Costellazione e galassie su un team GRANDE: niente crash (prima buildGraph superava lo stack
 * oltre i 1 800 ricordi con tag molto usati), tempi lineari, galassie con un nome sensato.
 */
import { describe, expect, it } from 'vitest'
import type { RecallHit } from '../../src/core/model'
import { detectCommunities, galaxyLinks, MAX_GALAXIES } from '../../src/graph/communities'
import { buildGraph, MAX_LINKS_PER_NODE } from '../../src/graph/constellation'

const TOPICS = ['kafka', 'postgres', 'angular', 'docker', 'kubernetes', 'oauth', 'gateway', 'ordini', 'pagamenti', 'fatture', 'redis', 'etl']
/** n ricordi, ognuno con il tag del suo argomento (12 argomenti) e qualche ponte fra argomenti. */
function team (n: number): RecallHit[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i.toString(16).padStart(64, '0'),
    kind: 'fact',
    title: `Ricordo ${i}`,
    body: '',
    tags: [TOPICS[i % TOPICS.length], ...(i % 7 === 0 ? [TOPICS[(i + 3) % TOPICS.length]] : [])],
    author: 'a',
    authorName: 'ada',
    ts: i,
    score: 0
  }) as RecallHit)
}

describe('costellazione su un team grande', () => {
  it('6 000 ricordi con tag molto usati: nessun crash, tempo contenuto, collegamenti limitati', () => {
    const t0 = Date.now()
    const g = buildGraph(team(6000))
    const ms = Date.now() - t0
    expect(g.nodes).toHaveLength(6000)
    expect(ms).toBeLessThan(5000)
    const per = new Map<string, number>()
    for (const l of g.links) for (const k of [l.source, l.target]) per.set(k, (per.get(k) ?? 0) + 1)
    // ogni nodo tiene i suoi K più forti; un ricordo può essere fra i più forti di molti altri,
    // ma in media i collegamenti restano pochi (niente "gomitolo")
    const avg = [...per.values()].reduce((a, b) => a + b, 0) / per.size
    expect(avg).toBeLessThanOrEqual(MAX_LINKS_PER_NODE * 2)
  })

  it('galassie: una per argomento, con il nome dell\'argomento, al massimo MAX_GALAXIES', () => {
    const nodes = team(2400)
    const g = buildGraph(nodes)
    const c = detectCommunities(g.nodes, g.links)
    expect(c.galaxies.length).toBeLessThanOrEqual(MAX_GALAXIES + 1)
    expect(c.galaxies.length).toBeGreaterThanOrEqual(6)
    // il nome di ogni galassia grande è un argomento vero
    for (const x of c.galaxies.filter((x) => x.size > 50)) expect(TOPICS).toContain(x.tags[0])
    // la stessa costellazione dà le stesse galassie (deterministico)
    expect(detectCommunities(g.nodes, g.links).galaxies).toEqual(c.galaxies)
    expect(galaxyLinks(g.links, c.of).every((l) => l.weight > 0 && l.weight <= 1)).toBe(true)
  })
})
