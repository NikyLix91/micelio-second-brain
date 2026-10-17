/** Dreaming (Fase 6): selezione dei duplicati, decadimento, turnazione, regole in apply. */
import { describe, expect, it } from 'vitest'
import { envelope, type EventPayload } from '../../src/core/events'
import type { RecallHit } from '../../src/core/model'
import { decayCandidates, dreamOrder, duplicateGroups } from '../../src/dream/dreamer'
import { applyNodes, KEYS } from '../../src/net/apply'

const DAY = 24 * 3600 * 1000
const hit = (id: string, o: Partial<RecallHit> = {}): RecallHit =>
  ({ id, kind: 'fact', title: id, body: '', tags: [], author: 'k', authorName: null, ts: Date.now(), score: 0, ...o })
const vec = (...v: number[]) => { const n = Math.hypot(...v); return Float32Array.from(v.map((x) => x / n)) }

describe('selezione', () => {
  it('raggruppa i quasi duplicati per transitività, esclusi i fissati', () => {
    const vectors = new Map([['a', vec(1, 0, 0)], ['b', vec(0.99, 0.1, 0)], ['c', vec(0.97, 0.2, 0)], ['d', vec(0, 1, 0)], ['p', vec(1, 0, 0)]])
    const groups = duplicateGroups([hit('a'), hit('b'), hit('c'), hit('d'), hit('p', { pinned: true })], vectors, 0.98)
    expect(groups).toHaveLength(1)
    expect(groups[0].sort()).toEqual(['a', 'b', 'c']) // a~b, b~c → stesso gruppo; d diverso; p fissato
  })

  it('decadono solo i ricordi vecchi, poco attivi e non fissati', () => {
    const old = Date.now() - 200 * DAY
    const c = decayCandidates([
      hit('vecchio-spento', { ts: old, activation: 0.05 }),
      hit('vecchio-vivo', { ts: old, activation: 0.6 }),
      hit('nuovo-spento', { activation: 0.05 }),
      hit('fissato', { ts: old, activation: 0.05, pinned: true })
    ])
    expect(c.map((m) => m.id)).toEqual(['vecchio-spento'])
  })

  it('la turnazione è deterministica e cambia ogni epoca', () => {
    const m = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]
    expect(dreamOrder('2026-10-17', m)).toEqual(dreamOrder('2026-10-17', [...m].reverse()))
    const days = new Set(['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'].map((d) => dreamOrder(d, m)[0]))
    expect(days.size).toBeGreaterThan(1) // non sogna sempre lo stesso nodo
  })
})

describe('apply: eventi del dreaming', () => {
  function fakeView () {
    const data = new Map<string, any>()
    return {
      data,
      async get (k: string) { return data.has(k) ? { key: k, value: structuredClone(data.get(k)) } : null },
      async put (k: string, v: unknown) { data.set(k, structuredClone(v)) },
      async del (k: string) { data.delete(k) }
    }
  }
  const host = { async addWriter () {}, async removeWriter () {}, removeable: () => true }
  const A = 'a'.repeat(64)
  const B = 'b'.repeat(64)
  const M1 = '1'.repeat(64); const M2 = '2'.repeat(64); const M3 = '3'.repeat(64)
  const node = (from: string, payload: EventPayload) => ({ from: { key: Buffer.from(from, 'hex') }, value: envelope(payload, 5) })
  const mem = (id: string) => ({ id, kind: 'fact', title: id, body: 'x', tags: [], source: { type: 'cli' }, author: A, ts: 1, status: 'active' })

  async function setup () {
    const view = fakeView()
    await applyNodes([node(A, { type: 'team.init', name: 'T', founderName: 'a' })], view, host)
    view.data.set(KEYS.member(B), { key: B, name: 'b', role: 'member', removed: false })
    for (const id of [M1, M2, M3]) view.data.set(KEYS.memory(id), mem(id))
    return view
  }
  const merged = { title: 'Fusione', body: 'Contenuto fuso' } as any

  it('supersede: i vecchi diventano storico; una seconda fusione sugli stessi ricordi è ignorata', async () => {
    const view = await setup()
    await applyNodes([
      node(A, { type: 'memory.supersede', old: [M1, M2], memory: merged, reason: 'duplicati' }),
      node(B, { type: 'memory.supersede', old: [M2, M3], memory: { title: 'Altra', body: 'altro' } as any, reason: 'concorrente' })
    ], view, host)
    expect(view.data.get(KEYS.memory(M1))).toMatchObject({ status: 'superseded', statusReason: 'duplicati' })
    expect(view.data.get(KEYS.memory(M3)).status).toBe('active') // la seconda fusione non è passata
    expect([...view.data.values()].filter((v) => v?.title === 'Altra')).toHaveLength(0)
  })

  it('i ricordi fissati non si archiviano né si fondono; restore li riporta attivi', async () => {
    const view = await setup()
    view.data.set(KEYS.pin(M1), { by: A })
    await applyNodes([
      node(A, { type: 'memory.archive', id: M1, reason: 'decaduto' }),
      node(A, { type: 'memory.supersede', old: [M1, M2], memory: merged, reason: 'x' }),
      node(A, { type: 'memory.archive', id: M2, reason: 'decaduto' })
    ], view, host)
    expect(view.data.get(KEYS.memory(M1)).status).toBe('active')
    expect(view.data.get(KEYS.memory(M2)).status).toBe('archived')
    await applyNodes([node(B, { type: 'memory.restore', id: M2 })], view, host)
    expect(view.data.get(KEYS.memory(M2))).toEqual(mem(M2))
  })

  it('un\'epoca ha un solo sognatore: vale la prima rivendicazione, e il diario solo da lui', async () => {
    const view = await setup()
    await applyNodes([
      node(B, { type: 'dream.claim', epoch: 'e1' }),
      node(A, { type: 'dream.claim', epoch: 'e1' }),
      node(A, { type: 'dream.complete', epoch: 'e1', summary: 'falso', stats: {} }),
      node(B, { type: 'dream.complete', epoch: 'e1', summary: 'vero', stats: { merged: 2 } })
    ], view, host)
    expect(view.data.get(KEYS.dreamClaim('e1')).by).toBe(B)
    expect(view.data.get(KEYS.dreamLog('e1')).summary).toBe('vero')
  })
})
