/**
 * Lacune di conoscenza e riepilogo settimanale (B4): chiave di raggruppamento delle ricerche,
 * eventi gap.report / gap.close in apply (più persone, chiusura, riapertura), calcolo del riepilogo.
 *
 * EN: Knowledge gaps and weekly digest (B4): grouping key for searches,
 * gap.report / gap.close events in apply (several people, closing, reopening), digest computation.
 */
import { describe, expect, it } from 'vitest'
import { envelope, type EventPayload } from '../../src/core/events'
import type { RecallHit, RootRecord } from '../../src/core/model'
import { computeDigest } from '../../src/insight/digest'
import { gapId, gapKey } from '../../src/insight/gaps'
import { applyNodes, KEYS } from '../../src/net/apply'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const DAY = 24 * 3600_000
const node = (from: string, payload: EventPayload, ts = 1000) => ({ from: { key: Buffer.from(from, 'hex') }, value: envelope(payload, ts) })
function fakeView () {
  const data = new Map<string, unknown>()
  return { data, async get (k: string) { return data.has(k) ? { key: k, value: structuredClone(data.get(k)) } : null }, async put (k: string, v: unknown) { data.set(k, structuredClone(v)) }, async del (k: string) { data.delete(k) } }
}
const host = { async addWriter () {}, async removeWriter () {}, removeable () { return true } }

describe('lacune di conoscenza', () => {
  it('ricerche uguali a meno di ordine, maiuscole, accenti e parole vuote hanno la stessa chiave', () => {
    expect(gapKey('Come si configura il Timeout del gateway?')).toBe(gapKey('gateway TIMEOUT configura si'))
    expect(gapKey('perché è lento?')).toBe('lento')
    expect(gapKey('a di il')).toBe('')
    expect(gapId(gapKey('timeout gateway'))).toMatch(/^[0-9a-f]{64}$/)
  })

  it('apply: chi ha lo stesso bisogno si aggiunge, chiudere e riaprire', async () => {
    const view = fakeView()
    const id = gapId('gateway timeout')
    const inv = 'd'.repeat(64)
    await applyNodes([
      node(A, { type: 'team.init', name: 'T', founderName: 'ada' }),
      node(A, { type: 'invite.add', id: inv, publicKey: 'e'.repeat(64), expires: 0 }),
      node(A, { type: 'member.add', key: B, name: 'bo', inviteId: inv }),
      node(A, { type: 'gap.report', id, question: 'Timeout del gateway?' }),
      node(B, { type: 'gap.report', id, question: 'gateway timeout' }),
      node(B, { type: 'gap.report', id, question: 'gateway timeout' })
    ], view, host)
    let g = view.data.get(KEYS.gap(id)) as any
    expect(g).toMatchObject({ question: 'Timeout del gateway?', by: A, askers: [A, B], status: 'open' })
    await applyNodes([node(B, { type: 'gap.close', id, memory: 'f'.repeat(64) }, 2000)], view, host)
    g = view.data.get(KEYS.gap(id))
    expect(g).toMatchObject({ status: 'closed', closedBy: B, memory: 'f'.repeat(64) })
    await applyNodes([node(A, { type: 'gap.report', id, question: 'Timeout del gateway?' }, 3000)], view, host)
    expect((view.data.get(KEYS.gap(id)) as any).status).toBe('open')
  })
})

describe('riepilogo settimanale', () => {
  const now = 100 * DAY
  const mem = (n: number, ts: number, extra: Partial<RecallHit> = {}): RecallHit =>
    ({ id: String(n).repeat(64).slice(0, 64), kind: 'gotcha', title: `R${n}`, body: '', tags: [], author: A, authorName: n % 2 ? 'ada' : 'bo', ts, score: 0, uses: n, ...extra }) as RecallHit

  it('conta ciò che è successo nel periodo, non prima', () => {
    const memories = [mem(1, now - DAY), mem(2, now - 2 * DAY, { kind: 'decision' }), mem(3, now - 30 * DAY, { stale: { commits: 2, missing: 0 } }), mem(4, now - 3 * DAY)]
    const roots: RootRecord[] = [
      { id: memories[1].id, category: 'architecture', by: A, ts: now - DAY, reviewedAt: now - DAY, reviewedBy: A, status: 'ok', flags: [] },
      { id: memories[2].id, category: 'policy', by: A, ts: now - 40 * DAY, reviewedAt: 0, reviewedBy: A, status: 'review', flags: [] }
    ]
    const d = computeDigest({
      now,
      days: 7,
      memories,
      roots,
      lastUsed: new Map([[memories[2].id, now - DAY], [memories[3].id, now - 20 * DAY]]),
      gaps: [{ id: 'g1', question: 'Q1', askers: [A, B], status: 'open' }, { id: 'g2', question: 'Q2', askers: [A], status: 'closed' }],
      myMisses: [{ last: now - DAY }, { last: now - 10 * DAY }],
      dreams: [{ ts: now - DAY, summary: 'Fusi 2 ricordi' }, { ts: now - 9 * DAY, summary: 'vecchio' }]
    })
    expect(d.memories.added).toBe(3)
    expect(d.memories.byKind).toEqual({ gotcha: 2, decision: 1 })
    expect(d.memories.byAuthor).toEqual([{ name: 'ada', count: 1 }, { name: 'bo', count: 2 }].sort((a, b) => b.count - a.count))
    expect(d.roots.added.map((r) => r.title)).toEqual(['R2'])
    expect(d.roots.toReview.map((r) => r.title)).toEqual(['R3'])
    expect(d.mostUsed.map((m) => m.title)).toEqual(['R3']) // R4 usato 20 giorni fa: fuori periodo / EN: R4 used 20 days ago: outside the period
    expect(d.gaps).toEqual([{ id: 'g1', title: 'Q1', detail: '2' }])
    expect(d.myMisses).toBe(1)
    expect(d.dreams).toEqual({ count: 1, lastSummary: 'Fusi 2 ricordi' })
    expect(d.stale).toBe(1)
  })
})
