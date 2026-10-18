// Radici (Fase 8) su due nodi veri: promozione replicata, filtri (progetto, categoria, file,
// testo), "Radici pertinenti" in coda alle ricerche, marcatura nel grafo, conferma e rimozione.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MicelioNode } from '../../src/node/micelio-node'
import { ROOT_FLOOR } from '../../src/rank/activation'
import { eventually, localDht, makeNode, published } from '../helpers'

describe('Radici fra due nodi', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  const nodes: MicelioNode[] = []
  let alice: MicelioNode, bruno: MicelioNode
  let arch: string, sec: string, gotcha: string

  beforeAll(async () => {
    dht = await localDht()
    alice = makeNode('roots-alice', dht.bootstrap).node
    bruno = makeNode('roots-bruno', dht.bootstrap).node
    nodes.push(alice, bruno)
    await Promise.all(nodes.map((n) => n.start()))
    await alice.init('Team Radici', 'alice')
    await bruno.join((await alice.invite()).code, 'bruno')

    // Una Radice di progetto (con riferimenti al codice), una generale, un ricordo normale
    arch = published(await alice.remember({
      kind: 'decision',
      title: 'Architettura a eventi del gestionale ordini',
      body: 'Ogni servizio pubblica eventi di dominio sul bus; nessuna chiamata sincrona fra servizi.',
      tags: ['architettura'],
      source: { type: 'claude-code', code: { project: 'ordini', files: ['src/orders/'], symbols: [], commits: [] } }
    })).id
    sec = published(await alice.remember({ kind: 'reference', title: 'Policy di sicurezza: segreti fuori dal codice', body: 'I segreti stanno nel vault aziendale, mai nei repository.' })).id
    gotcha = published(await alice.remember({ kind: 'gotcha', title: 'Timeout del bus eventi in sviluppo', body: 'In locale il bus risponde lento al primo avvio.' })).id
    await eventually(() => bruno.recall('architettura').length >= 1, nodes)
  })

  afterAll(async () => {
    await Promise.all(nodes.map((n) => n.stop().catch(() => {})))
    await dht?.destroy()
  })

  it('chiunque può promuovere: la Radice di bruno arriva ad alice', async () => {
    await bruno.rootSet(arch, 'architecture')
    await bruno.rootSet(sec, 'policy')
    await eventually(async () => (await alice.roots()).length === 2, nodes)
    const r = (await alice.roots()).find((x) => x.id === arch)!
    expect(r).toMatchObject({ category: 'architecture', status: 'ok', byName: 'bruno' })
    expect(r.memory.root).toEqual({ category: 'architecture', status: 'ok' })
    expect(r.memory.activation).toBeGreaterThanOrEqual(ROOT_FLOOR)
  })

  it('filtri: progetto, categoria, file (anche per cartella)', async () => {
    expect((await alice.roots({ project: 'ordini' })).map((r) => r.id)).toEqual([arch])
    expect((await alice.roots({ category: 'policy' })).map((r) => r.id)).toEqual([sec])
    expect((await alice.roots({ files: ['src/orders/order.service.ts'] })).map((r) => r.id)).toEqual([arch])
    expect(await alice.roots({ files: ['src/billing/x.ts'] })).toEqual([])
  })

  it('Radici pertinenti: arrivano anche se non sono fra i risultati, mai doppie', async () => {
    // Con un solo risultato la Radice può essere fuori: deve arrivare comunque, e mai due volte.
    for (const q of ['timeout bus eventi', 'eventi di dominio sul bus']) {
      const hits = (await alice.recallHybrid(q, 1)).map((h) => h.id)
      const related = (await alice.relatedRoots(q, hits)).map((h) => h.id)
      expect([...hits, ...related]).toContain(arch)
      expect(related.filter((id) => hits.includes(id))).toEqual([])
    }
    // Nessuna Radice pertinente a un argomento estraneo
    expect(await alice.relatedRoots('zzz qwerty', [])).toEqual([])
  })

  it('il grafo marca le Radici', () => {
    const g = alice.graph()
    expect(g.nodes.find((n) => n.id === arch)?.root).toEqual({ category: 'architecture', status: 'ok' })
    expect(g.nodes.find((n) => n.id === gotcha)?.root).toBeUndefined()
  })

  it('rimozione e conferma', async () => {
    await alice.rootUnset(sec)
    await eventually(async () => (await bruno.roots()).length === 1, nodes)
    const c = await alice.rootConfirm(arch)
    expect(c.status).toBe('ok')
    await expect(alice.rootConfirm(gotcha)).rejects.toThrow(/non è una Radice/)
  })
})
