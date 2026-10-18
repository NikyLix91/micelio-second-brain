/**
 * Qualità della distillazione (Fase 10): metriche per posizione nel distillato, saturazione del
 * limite, indicazione all'admin; e il limite `distill.maxMemories` rispettato dalla pipeline.
 */
import { describe, expect, it } from 'vitest'
import { IngestPipeline } from '../../src/ingest/pipeline'
import { distillQuality, maxMemoriesOf, MIN_SAMPLE, type QualityInput } from '../../src/ingest/quality'
import { FakeAdapter } from '../../src/llm/fake'
import { LlmRunner } from '../../src/llm/runner'
import { mergeRules } from '../../src/privacy/filter'
import { mergeBlockedPaths } from '../../src/privacy/paths'
import { PrivateStore } from '../../src/store/private-store'
import { writeTranscript } from '../fixtures/transcript'
import { tmpHome } from '../helpers'

const NOW = Date.UTC(2026, 9, 18)
const OLD = NOW - 10 * 24 * 3600 * 1000
const NEW = NOW - 3600 * 1000

/** Un ricordo distillato in posizione `rank` di un distillato da `batch` ricordi. */
const mem = (rank: number, o: Partial<QualityInput> = {}, batch = 5): QualityInput =>
  ({ ts: OLD, status: 'active', source: { type: 'claude-code', rank, batch }, votes: 0, uses: 0, ...o })

/**
 * `n` distillazioni da 5 ricordi: le posizioni 1–3 sempre usate; le posizioni 4–5 usate con
 * la qualità indicata ("good" = come le prime, "bad" = fuse o votate inutili).
 */
function batches (n: number, tail: 'good' | 'bad', batch = 5): QualityInput[] {
  const out: QualityInput[] = []
  for (let i = 0; i < n; i++) {
    for (const r of [1, 2, 3]) out.push(mem(r, { uses: 2 }, batch))
    for (const r of [4, 5]) out.push(mem(r, tail === 'good' ? { uses: 1 } : (r === 4 ? { status: 'superseded' } : { votes: -1 }), batch))
  }
  return out
}

describe('distillQuality', () => {
  it('fasce di posizione: utili, votati inutili, rimossi, mai usati, punteggio; i recenti a parte', () => {
    const q = distillQuality([
      mem(1, { uses: 3 }), mem(1, { votes: 1 }), mem(1, { votes: -2 }), mem(1, { status: 'archived' }),
      mem(2), mem(2, { ts: NEW }), mem(1, { status: 'redacted' }),
      { ts: OLD, status: 'active', source: { type: 'mcp' }, votes: 0, uses: 9 } // non distillato: escluso
    ], 5, NOW)
    const first = q.buckets.find((b) => b.label === '1ª')!
    expect(first).toMatchObject({ n: 4, useful: 0.5, notUseful: 0.25, removed: 0.25, unused: 0, young: 0 })
    expect(first.score).toBeCloseTo(0)
    expect(q.buckets.find((b) => b.label === '2ª')).toMatchObject({ n: 1, unused: 1, young: 1 })
    expect(q.total).toBe(6)
    // Fasce mostrate: quelle entro il limite (5) — non "6ª–10ª" se non ha dati
    expect(q.buckets.map((b) => b.label)).toEqual(['1ª', '2ª', '3ª', '4ª–5ª'])
  })

  it('saturazione: distillazioni (posizione 1) che hanno proposto almeno quanti il limite', () => {
    const q = distillQuality([mem(1, {}, 5), mem(1, {}, 7), mem(1, {}, 2), mem(2, {}, 7)], 5, NOW)
    expect(q.saturation).toEqual({ batches: 3, atLimit: 2, rate: 2 / 3 })
  })

  it('indicazioni: dati insufficienti, alzare, abbassare, tenere', () => {
    expect(distillQuality(batches(2, 'good'), 5, NOW).advice.action).toBe('unknown')
    expect(batches(10, 'good').length).toBeGreaterThanOrEqual(MIN_SAMPLE)
    // Ultime posizioni buone come le prime e limite sempre raggiunto → alzare
    expect(distillQuality(batches(10, 'good'), 5, NOW).advice).toMatchObject({ action: 'raise' })
    // Ultime posizioni fuse o votate inutili → abbassare
    expect(distillQuality(batches(10, 'bad'), 5, NOW).advice.action).toBe('lower')
    // Buone ma il modello propone quasi sempre meno del limite (saturazione bassa) → tenere
    const unsaturated = batches(10, 'good').map((m) => (m.source!.rank === 1 ? { ...m, source: { ...m.source!, batch: 3 } } : m))
    expect(distillQuality(unsaturated, 5, NOW).advice).toMatchObject({ action: 'keep' })
  })

  it('maxMemoriesOf: default 5, solo interi fra 1 e 20', () => {
    expect(maxMemoriesOf(undefined)).toBe(5)
    expect(maxMemoriesOf(8)).toBe(8)
    for (const bad of [0, 21, 3.5, '8', null]) expect(maxMemoriesOf(bad)).toBe(5)
  })
})

describe('pipeline: limite di ricordi per distillazione', () => {
  it('il limite va nel prompt ed è fatto rispettare; ogni ricordo ha posizione e batch', async () => {
    const store = new PrivateStore(':memory:')
    const fake = new FakeAdapter()
    const published: any[] = []
    const p = new IngestPipeline({
      store,
      llm: new LlmRunner(fake, store, { dailyBudget: () => 100 }),
      models: () => ({ classify: 'haiku', distill: 'sonnet' }),
      publish: async (m) => { published.push(m); return { id: `id-${published.length}`, duplicate: false } },
      rules: async () => mergeRules([]),
      blockedPaths: async () => mergeBlockedPaths([]),
      language: async () => 'it',
      maxMemories: async () => 2,
      log: () => {}
    })
    const lessons = [1, 2, 3, 4].map((i) => `LEZIONE: Lezione numero ${i} | corpo ${i}`).join('\n')
    const transcriptPath = writeTranscript(tmpHome('q'), 's1', [{ user: 'Sessione tecnica sulla pipeline di build. '.repeat(15) }, { assistant: lessons }])
    p.enqueueSession({ sessionId: 's1', transcriptPath, cwd: tmpHome('cwd') })
    await p.tick()
    expect(published.map((m) => m.title)).toEqual(['Lezione numero 1', 'Lezione numero 2'])
    expect(published.map((m) => [m.source.rank, m.source.batch])).toEqual([[1, 4], [2, 4]])
    expect(fake.calls.find((c) => c.name === 'distill')!.system).toContain('estrai da 0 a 2 ricordi')
  })
})
