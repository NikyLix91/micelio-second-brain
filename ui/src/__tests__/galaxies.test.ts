/**
 * Galassie nelle viste grafiche: quale livello si disegna (tutto, vista d'insieme, una galassia,
 * solo i risultati) a seconda della dimensione del team, di ricerca e filtri.
 */
import { describe, expect, it } from 'vitest'
import type { Graph, GraphNode } from '../api/client'
import { buildView, galaxyNodeId, galaxyStops, GALAXY_THRESHOLD, isGalaxyNode, STAR_BUDGET, usesGalaxies } from '../pages/galaxies'

/** Team finto: `perGalaxy` ricordi in ognuna di `count` galassie, collegati in catena. */
function team (count: number, perGalaxy: number): Graph {
  const nodes: GraphNode[] = []
  const links: Graph['links'] = []
  for (let g = 0; g < count; g++) {
    for (let i = 0; i < perGalaxy; i++) {
      nodes.push({ id: `m${g}-${i}`, title: `t${g}-${i}`, kind: 'fact', tags: [`topic${g}`], author: 'a', authorName: 'Ada', ts: 0, activation: i / perGalaxy, galaxy: g, ...(i === 0 ? { root: { category: 'architecture', status: 'ok' as const } } : {}) })
      if (i > 0) links.push({ source: `m${g}-${i - 1}`, target: `m${g}-${i}`, weight: 0.5, kind: 'tags' })
    }
  }
  return {
    nodes,
    links,
    galaxies: Array.from({ length: count }, (_, g) => ({ id: g, label: `topic${g}`, tags: [`topic${g}`], size: perGalaxy, roots: 1, top: [`m${g}-${perGalaxy - 1}`] })),
    galaxyLinks: count > 1 ? [{ source: 0, target: 1, weight: 1 }] : []
  }
}

describe('galassie nelle viste', () => {
  it('team piccolo: tutto come sempre', () => {
    const g = team(2, 50)
    expect(usesGalaxies(g)).toBe(false)
    const v = buildView(g, null, null)
    expect(v.level).toBe('all')
    expect(v.nodes).toHaveLength(100)
  })

  it('team grande: una stella per galassia, con i legami fra galassie', () => {
    const g = team(5, 100)
    expect(usesGalaxies(g)).toBe(true)
    const v = buildView(g, null, null)
    expect(v.level).toBe('overview')
    expect(v.nodes).toHaveLength(5)
    expect(v.nodes.every(isGalaxyNode)).toBe(true)
    expect(v.links).toEqual([{ source: galaxyNodeId(0), target: galaxyNodeId(1), weight: 1, kind: 'tags' }])
  })

  it('dentro una galassia: solo i suoi ricordi e i loro collegamenti', () => {
    const v = buildView(team(5, 100), 2, null)
    expect(v.level).toBe('galaxy')
    expect(v.galaxy?.id).toBe(2)
    expect(v.nodes.every((n) => n.galaxy === 2)).toBe(true)
    expect(v.links).toHaveLength(99)
  })

  it('galassia enorme: al massimo STAR_BUDGET stelle, Radici e accesi sempre dentro', () => {
    const g = team(2, STAR_BUDGET + 300)
    const lit = new Set(['m0-5'])
    const v = buildView(g, 0, lit)
    expect(v.nodes).toHaveLength(STAR_BUDGET)
    expect(v.hidden).toBe(300)
    const ids = new Set(v.nodes.map((n) => n.id))
    expect(ids.has('m0-0')).toBe(true) // Radice
    expect(ids.has('m0-5')).toBe(true) // acceso, poco vivo
    expect(ids.has(`m0-${STAR_BUDGET + 299}`)).toBe(true) // il più vivo
    expect(v.lit).toEqual(lit)
  })

  it('pochi risultati: solo quelli, da tutte le galassie', () => {
    const v = buildView(team(5, 100), null, new Set(['m0-1', 'm3-7']))
    expect(v.level).toBe('filtered')
    expect(v.nodes.map((n) => n.id).sort()).toEqual(['m0-1', 'm3-7'])
    expect(v.lit).toBeNull()
  })

  it('tanti risultati: si accendono le galassie che li contengono, con il conteggio', () => {
    const g = team(5, 100)
    const lit = new Set(g.nodes.filter((n) => n.galaxy! <= 2).map((n) => n.id)) // 300 > soglia
    expect(lit.size).toBeGreaterThan(GALAXY_THRESHOLD)
    const v = buildView(g, null, lit)
    expect(v.level).toBe('overview')
    expect(v.lit).toEqual(new Set([0, 1, 2].map(galaxyNodeId)))
    const third = v.nodes.find((n) => n.id === galaxyNodeId(2))
    expect(isGalaxyNode(third) && third.galaxyInfo.matches).toBe(100)
  })

  it('tour: una tappa per galassia, che accende la galassia nella vista d\'insieme', () => {
    const g = team(5, 100)
    const stops = galaxyStops(g, 3)
    expect(stops.map((s) => s.galaxy)).toEqual([0, 1, 2])
    expect(stops[0].ids).toHaveLength(100)
    expect(buildView(g, null, null, 1).lit).toEqual(new Set([galaxyNodeId(1)]))
  })

  it('la struttura (key) non cambia accendendo galassie: la simulazione non riparte', () => {
    const g = team(5, 100)
    const lit = new Set(g.nodes.filter((n) => n.galaxy! <= 2).map((n) => n.id))
    expect(buildView(g, null, lit).key).toBe(buildView(g, null, null).key)
  })
})
