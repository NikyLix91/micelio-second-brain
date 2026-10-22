// B12: abituazione con un nodo vero. I ricordi forniti più volte senza servire scendono nel contesto
// automatico (per intero) e nelle ricerche (a metà); un esito utile li riporta; i fissati non si toccano.
// EN: B12: habituation with a real node. Memories delivered several times without helping go down in
//     automatic context (fully) and in searches (by half); a useful outcome brings them back; pinned
//     ones are not touched.
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nodePaths } from '../../src/core/paths'
import { HashEmbedder } from '../../src/embed/embedder'
import { FakeAdapter } from '../../src/llm/fake'
import { MicelioHost } from '../../src/node/micelio-host'
import type { MicelioNode } from '../../src/node/micelio-node'
import { eventually, published, tmpHome } from '../helpers'

describe('abituazione (B12)', () => {
  let host: MicelioHost
  let node: MicelioNode
  let store: any
  let session = 0
  const ids: Record<string, string> = {}

  /** Registra `n` esiti per un ricordo, come farebbero n sessioni diverse. / EN: Records `n` outcomes for a memory, as n different sessions would. */
  const outcomes = (id: string, verdict: string, n = 1) => {
    for (let i = 0; i < n; i++) store.setOutcome({ session: `s${session++}`, memory: id, verdict, judge: 'llm' })
    ;(node as any).refreshHabituation()
  }

  beforeAll(async () => {
    host = new MicelioHost(nodePaths(tmpHome('habituation')), { materializeDelayMs: 50, llm: new FakeAdapter(), embedder: new HashEmbedder() })
    await host.start()
    await host.createTeam('Ordini', 'ada', 'local')
    node = host.node()
    store = (node as any).privateStore
    ids.a = published(await node.remember({ kind: 'howto', title: 'Retry delle chiamate SFTP', body: 'Per le chiamate SFTP instabili usare retry con backoff esponenziale e keepalive.', tags: ['sftp'] })).id
    ids.b = published(await node.remember({ kind: 'howto', title: 'Timeout delle chiamate SFTP', body: 'Per le chiamate SFTP lente alzare il timeout di connessione a 30 secondi.', tags: ['sftp'] })).id
    await eventually(async () => (await node.recallHybrid('chiamate sftp', 5, false)).length === 2, [node])
  })

  afterAll(async () => { await host?.stop() })

  it('fornito più volte senza servire: scende nella ricerca, ma solo a metà', async () => {
    const before = await node.recallHybrid('chiamate sftp retry', 5, false)
    expect(before[0].id).toBe(ids.a)
    outcomes(ids.a, 'ignored', 7)
    const after = await node.recallHybrid('chiamate sftp retry', 5, false)
    const a = after.find((h) => h.id === ids.a)!
    expect(a.habituation).toEqual({ streak: 7, factor: 0.3 })
    // A metà: il punteggio scende al 65%, non al 30%
    // EN: Halved: the score goes down to 65%, not to 30%
    expect(a.score / before.find((h) => h.id === ids.a)!.score).toBeCloseTo(0.65, 2)
    expect(node.detail(ids.a)!.habituation?.streak).toBe(7)
  })

  it('nel contesto automatico pesa per intero: il rumore esce dal contesto della richiesta', async () => {
    const ctx = await node.agentContext({ event: 'prompt', cwd: process.cwd(), prompt: 'come gestisco le chiamate SFTP con retry e backoff esponenziale e keepalive?' })
    expect(ctx).not.toContain('Retry delle chiamate SFTP')
  })

  it('un esito utile lo riporta subito al pieno', async () => {
    outcomes(ids.a, 'used')
    expect(node.detail(ids.a)!.habituation).toBeUndefined()
    const hits = await node.recallHybrid('chiamate sftp retry', 5, false)
    expect(hits[0].id).toBe(ids.a)
    const ctx = await node.agentContext({ event: 'prompt', cwd: process.cwd(), prompt: 'come gestisco le chiamate SFTP con retry e backoff esponenziale e keepalive?' })
    expect(ctx).toContain('Retry delle chiamate SFTP')
  })

  it('i ricordi fissati non si abituano; nella lista «rumore» si vede il peso', async () => {
    outcomes(ids.b, 'none', 6)
    expect(node.detail(ids.b)!.habituation?.factor).toBeCloseTo(0.4)
    // Lista rumore: servono anche consultazioni (restituito almeno 5 volte)
    // EN: Noise list: queries are needed too (returned at least 5 times)
    for (let i = 0; i < 5; i++) node.consulted('prompt', 'sftp lento', [ids.b], 3, { project: path.basename(process.cwd()) })
    expect(node.efficacyReport(1).noisy.find((m) => m.id === ids.b)?.factor).toBeCloseTo(0.4)
    await node.pin(ids.b, true)
    expect(node.detail(ids.b)!.habituation).toBeUndefined()
  })
})
