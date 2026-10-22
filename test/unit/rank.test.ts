/** Fase 5: attivazione (src/rank/activation.ts), ricerca ibrida (src/rank/hybrid.ts), eventi di priorità in apply. / EN: Phase 5: activation (src/rank/activation.ts), hybrid search (src/rank/hybrid.ts), priority events in apply. */
import { describe, expect, it } from 'vitest'
import { envelope, type EventPayload } from '../../src/core/events'
import { applyNodes, KEYS } from '../../src/net/apply'
import { activation } from '../../src/rank/activation'
import { cosine, hybridRank, nearest, rrf } from '../../src/rank/hybrid'

const DAY = 24 * 3600 * 1000
const NOW = 1_800_000_000_000
const base = { kind: 'howto', createdAt: NOW, uses: 0, votes: 0, degree: 0, pinned: false }

describe('attivazione', () => {
  it('decade con il tempo, più lentamente per le decisioni', () => {
    const fresh = activation(base, NOW)
    const old = activation({ ...base, createdAt: NOW - 360 * DAY }, NOW)
    expect(old).toBeLessThan(fresh)
    const oldDecision = activation({ ...base, kind: 'decision', createdAt: NOW - 360 * DAY }, NOW)
    expect(oldDecision).toBeGreaterThan(old)
  })

  it('usi, voti e collegamenti la fanno salire; i voti negativi la abbassano', () => {
    const a = activation(base, NOW)
    expect(activation({ ...base, uses: 20 }, NOW)).toBeGreaterThan(a)
    expect(activation({ ...base, votes: 3 }, NOW)).toBeGreaterThan(a)
    expect(activation({ ...base, votes: -3 }, NOW)).toBeLessThan(a)
    expect(activation({ ...base, degree: 6 }, NOW)).toBeGreaterThan(a)
  })

  it('un uso recente "rinfresca" un ricordo vecchio', () => {
    const old = { ...base, createdAt: NOW - 400 * DAY }
    expect(activation({ ...old, lastUsed: NOW - DAY }, NOW)).toBeGreaterThan(activation(old, NOW))
  })

  it('un ricordo fissato ha sempre attivazione massima; i valori restano fra 0 e 1', () => {
    expect(activation({ ...base, pinned: true, createdAt: 0 }, NOW)).toBe(1)
    const v = activation({ ...base, uses: 1e6, votes: 1e6, degree: 1e6 }, NOW)
    expect(v).toBeLessThanOrEqual(1)
  })
})

describe('ricerca ibrida', () => {
  it('RRF premia chi è in alto in entrambe le classifiche', () => {
    const s = rrf([['a', 'b', 'c'], ['b', 'a', 'd']])
    expect(s.get('a')).toBe(s.get('b'))
    expect(s.get('a')!).toBeGreaterThan(s.get('c')!)
    expect(s.get('d')!).toBeLessThan(s.get('a')!)
  })

  it('a parità di pertinenza vince il ricordo più attivo', () => {
    const r = hybridRank(['x', 'y'], ['y', 'x'], (id) => (id === 'y' ? 1 : 0))
    expect(r[0].id).toBe('y')
  })

  it('un risultato solo semantico entra comunque in classifica', () => {
    expect(hybridRank([], ['solo-semantico'], () => 0).map((r) => r.id)).toEqual(['solo-semantico'])
  })

  it('nearest: i più simili sopra la soglia', () => {
    const v = (a: number, b: number) => { const n = Math.hypot(a, b); return Float32Array.from([a / n, b / n]) }
    const vectors = new Map([['vicino', v(1, 0.1)], ['lontano', v(0, 1)], ['medio', v(1, 1)]])
    expect(nearest(v(1, 0), vectors, 2).map((r) => r.id)).toEqual(['vicino', 'medio'])
    expect(nearest(v(1, 0), vectors, 5, 0.9).map((r) => r.id)).toEqual(['vicino'])
    expect(cosine(v(1, 0), v(1, 0))).toBeCloseTo(1)
  })
})

describe('apply: voti, pin, uso', () => {
  function fakeView () {
    const data = new Map<string, unknown>()
    return {
      data,
      async get (k: string) { return data.has(k) ? { key: k, value: structuredClone(data.get(k)) } : null },
      async put (k: string, v: unknown) { data.set(k, structuredClone(v)) },
      async del (k: string) { data.delete(k) }
    }
  }
  const host = { async addWriter () {}, async removeWriter () {}, removeable: () => true }
  const A = 'a'.repeat(64)
  const MEM = 'f'.repeat(64)
  const node = (payload: EventPayload) => ({ from: { key: Buffer.from(A, 'hex') }, value: envelope(payload, 1) })

  it('un voto per nodo (l\'ultimo vince), 0 lo ritira; niente voti su ricordi inesistenti', async () => {
    const view = fakeView()
    await applyNodes([node({ type: 'team.init', name: 'T', founderName: 'a' })], view, host)
    view.data.set(KEYS.memory(MEM), { id: MEM })
    await applyNodes([node({ type: 'memory.vote', id: MEM, delta: 1 }), node({ type: 'memory.vote', id: MEM, delta: -1 })], view, host)
    expect(view.data.get(KEYS.vote(MEM, A))).toMatchObject({ delta: -1 })
    await applyNodes([node({ type: 'memory.vote', id: MEM, delta: 0 }), node({ type: 'memory.vote', id: 'e'.repeat(64), delta: 1 })], view, host)
    expect([...view.data.keys()].filter((k) => k.startsWith('vote/'))).toEqual([])
  })

  it('pin e unpin', async () => {
    const view = fakeView()
    await applyNodes([node({ type: 'team.init', name: 'T', founderName: 'a' })], view, host)
    view.data.set(KEYS.memory(MEM), { id: MEM })
    await applyNodes([node({ type: 'memory.pin', id: MEM })], view, host)
    expect(view.data.has(KEYS.pin(MEM))).toBe(true)
    await applyNodes([node({ type: 'memory.unpin', id: MEM })], view, host)
    expect(view.data.has(KEYS.pin(MEM))).toBe(false)
  })

  it('usage.report è un G-Counter: si tiene il massimo, i report vecchi non riducono il conteggio', async () => {
    const view = fakeView()
    await applyNodes([node({ type: 'team.init', name: 'T', founderName: 'a' })], view, host)
    await applyNodes([
      node({ type: 'usage.report', counts: { [MEM]: { count: 5, last: 100 } } }),
      node({ type: 'usage.report', counts: { [MEM]: { count: 3, last: 50 } } }), // vecchio, arrivato dopo / EN: old, arrived later
      node({ type: 'usage.report', counts: { [MEM]: { count: 5, last: 100 } } }) // duplicato / EN: duplicate
    ], view, host)
    expect(view.data.get(KEYS.usage(MEM, A))).toEqual({ count: 5, last: 100 })
  })

  it('couse.report (B12) è un G-Counter per coppia, come usage.report', async () => {
    const view = fakeView()
    const pair = `${MEM}:${'b'.repeat(64)}`
    await applyNodes([node({ type: 'team.init', name: 'T', founderName: 'a' })], view, host)
    await applyNodes([
      node({ type: 'couse.report', counts: { [pair]: { count: 4, last: 200 } } }),
      node({ type: 'couse.report', counts: { [pair]: { count: 2, last: 100 } } }) // vecchio / EN: old
    ], view, host)
    expect(view.data.get(KEYS.couse(pair, A))).toEqual({ count: 4, last: 200 })
  })
})
