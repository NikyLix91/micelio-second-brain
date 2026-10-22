// B12: sinapsi d'uso, funzioni pure (coppie per sessione, forza, legami e vicini).
// EN: B12: use synapses, pure functions (pairs per session, strength, links and neighbors).
import { describe, expect, it } from 'vitest'
import { CO_USE_HALF_LIFE_DAYS, CO_USE_PER_MEMORY, coUseLinks, coUseNeighbors, coUseWeight, sessionPairs } from '../../src/rank/co-use'

const DAY = 24 * 3600 * 1000
const id = (n: number) => n.toString(16).padStart(64, '0')

describe('sinapsi d\'uso', () => {
  it('coppie di una sessione: ordinate, senza doppioni, al massimo 6 ricordi (15 coppie)', () => {
    expect(sessionPairs(['b', 'a', 'b'])).toEqual([['a', 'b']])
    expect(sessionPairs(['x'])).toEqual([])
    const many = sessionPairs(Array.from({ length: 10 }, (_, i) => `m${i}`))
    expect(many).toHaveLength(15)
    expect(many.every(([a, b]) => a < b)).toBe(true)
    expect(many.flat().includes('m6')).toBe(false) // oltre i primi 6 / EN: beyond the first 6
  })

  it('forza: cresce con le sessioni insieme e si dimezza ogni 90 giorni senza rinforzi', () => {
    const now = 1_800_000_000_000
    expect(coUseWeight(0, now, now)).toBe(0)
    expect(coUseWeight(1, now, now)).toBeCloseTo(0.315, 2)
    expect(coUseWeight(3, now, now)).toBeCloseTo(0.631, 2)
    expect(coUseWeight(8, now, now)).toBe(1)
    expect(coUseWeight(50, now, now)).toBe(1)
    expect(coUseWeight(8, now - CO_USE_HALF_LIFE_DAYS * DAY, now)).toBeCloseTo(0.5)
  })

  it('legami: sopra la soglia, solo fra ricordi presenti, al massimo 10 per ricordo', () => {
    const now = Date.now()
    const pairs = new Map<string, { count: number, last: number }>()
    pairs.set(`${id(1)}:${id(2)}`, { count: 8, last: now })
    pairs.set(`${id(1)}:${id(3)}`, { count: 1, last: now - 400 * DAY }) // troppo debole / EN: too weak
    pairs.set(`${id(1)}:${id(99)}`, { count: 8, last: now }) // ricordo assente / EN: missing memory
    const present = new Set([id(1), id(2), id(3)])
    const links = coUseLinks(pairs, present, now)
    expect(links).toEqual([{ source: id(1), target: id(2), weight: 1, kind: 'use' }])
    const near = coUseNeighbors(links)
    expect(near.get(id(2))).toEqual([{ id: id(1), weight: 1 }])

    // Un ricordo legato a 30 altri: ne restano i 10 più forti (dal suo lato)
    // EN: A memory linked to 30 others: its 10 strongest remain (on its side)
    const hub = new Map<string, { count: number, last: number }>()
    const all = new Set([id(1)])
    for (let i = 2; i < 32; i++) { hub.set(`${id(1)}:${id(i)}`, { count: i, last: now }); all.add(id(i)) }
    const kept = coUseLinks(hub, all, now)
    // Ogni legame resta anche se è fra i migliori dell'ALTRO estremo (che ne ha uno solo)
    // EN: Each link stays if it's among the best of the OTHER end too (which has only one)
    expect(kept.length).toBe(30)
    expect(coUseNeighbors(kept).get(id(1))!.length).toBe(30)
    expect(CO_USE_PER_MEMORY).toBe(10)
  })

  it('a scala: 50 000 coppie su 5 000 ricordi in pochi decimi di secondo', () => {
    const now = Date.now()
    const pairs = new Map<string, { count: number, last: number }>()
    const present = new Set<string>()
    for (let i = 0; i < 5000; i++) present.add(id(i))
    for (let i = 0; i < 50_000; i++) {
      const a = (i * 7919) % 5000
      const b = (a + 1 + (i % 37)) % 5000
      const [x, y] = a < b ? [a, b] : [b, a]
      pairs.set(`${id(x)}:${id(y)}`, { count: 1 + (i % 9), last: now - (i % 200) * DAY })
    }
    const t0 = performance.now()
    const near = coUseNeighbors(coUseLinks(pairs, present, now))
    const ms = performance.now() - t0
    expect(near.size).toBeGreaterThan(0)
    expect(ms).toBeLessThan(500)
  })
})
