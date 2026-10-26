// Protezione completa a scala (0.7.0): 5 000 ricordi cifrati. Ogni ricostruzione dell'indice
// apre tutte le buste: deve restare veloce, e la cifratura in scrittura non deve rallentare un
// ripristino di backup (appendMany).
// EN: Full protection at scale (0.7.0): 5,000 encrypted memories. Every index rebuild opens every
//     envelope: it must stay fast, and encryption on write must not slow down a backup restore
//     (appendMany).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MicelioNode } from '../../src/node/micelio-node'
import { localDht, makeNode } from '../helpers'

describe('protezione completa a scala', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  let node: MicelioNode
  const N = 5000

  beforeAll(async () => {
    dht = await localDht()
    node = makeNode('prot-scale', dht.bootstrap).node
    await node.start()
    await node.init('Team Grande', 'alice')
    for (let i = 0; i < 50 && !(node as any).team.keyStatus.ready; i++) await new Promise((r) => setTimeout(r, 100))
  }, 60_000)

  afterAll(async () => {
    await node?.stop().catch(() => {})
    await dht?.destroy()
  })

  it(`scrive ${N} ricordi cifrati in blocco, li apre e li indicizza in pochi secondi`, async () => {
    const team = (node as any).team
    expect(team.keyStatus.ready).toBe(true)
    const payloads = Array.from({ length: N }, (_, i) => ({ type: 'memory.add', memory: { kind: 'fact', title: `Ricordo numero ${i} sul servizio ${i % 97}`, body: `Dettaglio ${i}: configurazione, errori e soluzione del caso ${i}.`, tags: [`t${i % 13}`], source: { type: 'api' } } }))
    const t0 = performance.now()
    for (let i = 0; i < N; i += 500) await team.appendMany(payloads.slice(i, i + 500))
    const write = performance.now() - t0
    // Il costo da misurare è quello della cifratura: lettura dalla vista a cache calda, con e senza
    // apertura delle buste
    // EN: The cost to measure is the encryption's: reading the view with a warm cache, with and
    //     without opening the envelopes
    await team.rawScan({ gt: 'memory/', lt: 'memory0' })
    const tr = performance.now()
    await team.rawScan({ gt: 'memory/', lt: 'memory0' })
    const raw = performance.now() - tr
    const t1 = performance.now()
    const all = await team.memories()
    const read = performance.now() - t1
    expect(all.length).toBe(N)
    expect(all.every((m: any) => !m.sealed && m.title.startsWith('Ricordo numero'))).toBe(true)
    const t2 = performance.now()
    await node.sync()
    await (node as any).materialize(true)
    const index = performance.now() - t2
    expect(node.recall('Ricordo numero 4321').some((h) => h.title.startsWith('Ricordo numero 4321'))).toBe(true)
    console.log(`scala ${N}: scrittura cifrata ${Math.round(write)} ms, lettura ${Math.round(raw)} ms, lettura e apertura ${Math.round(read)} ms, indice ${Math.round(index)} ms`)
    // Aprire 5 000 buste costa meno di un secondo in più della sola lettura: margini larghi per i PC lenti
    // EN: Opening 5,000 envelopes costs less than a second more than reading alone: wide margins for slow PCs
    expect(read - raw).toBeLessThan(1000)
    expect(write).toBeLessThan(20_000)
  }, 120_000)
})
