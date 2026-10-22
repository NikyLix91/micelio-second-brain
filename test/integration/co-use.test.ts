// B12: sinapsi d'uso con due nodi veri. Due ricordi serviti nelle stesse sessioni su un PC si legano
// per tutto il team: il legame compare nella costellazione dell'altro nodo e la sua ricerca, trovato
// uno, si porta dietro l'altro.
// EN: B12: use synapses with two real nodes. Two memories that helped in the same sessions on one PC
//     become linked for the whole team: the link shows in the other node's constellation and its
//     search, having found one, brings the other along.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MicelioNode } from '../../src/node/micelio-node'
import { eventually, localDht, makeNode, published } from '../helpers'

describe('sinapsi d\'uso (B12)', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  let alice: MicelioNode
  let bob: MicelioNode
  const ids: Record<string, string> = {}

  /** Sessione in cui i ricordi indicati sono serviti (stessa strada degli esiti veri). / EN: Session in which the given memories helped (same path as real outcomes). */
  const session = (name: string, memories: string[]) => {
    const store = (alice as any).privateStore
    for (const m of memories) store.setOutcome({ session: name, memory: m, verdict: 'used', judge: 'llm' })
    ;(alice as any).recordCoUse(name)
  }

  beforeAll(async () => {
    dht = await localDht()
    alice = makeNode('alice', dht.bootstrap).node
    bob = makeNode('bob', dht.bootstrap).node
    await Promise.all([alice.start(), bob.start()])
    await alice.init('Team Dev', 'alice')
    await bob.join((await alice.invite()).code, 'bob')
    ids.gateway = published(await alice.remember({ kind: 'fact', title: 'Configurazione del gateway', body: 'Il gateway legge le rotte da gateway.yaml e va riavviato dopo ogni modifica.', tags: ['gateway'] })).id
    ids.deploy = published(await alice.remember({ kind: 'howto', title: 'Procedura di rilascio', body: 'Si rilascia con lo script release.ps1 dopo aver aggiornato il numero di versione.', tags: ['rilascio'] })).id
    ids.other = published(await alice.remember({ kind: 'fact', title: 'Orari del supporto', body: 'Il supporto risponde dalle 9 alle 18 nei giorni feriali.', tags: ['supporto'] })).id
  })

  afterAll(async () => {
    await Promise.all([alice, bob].map((n) => n?.stop().catch(() => {})))
    await dht?.destroy()
  })

  it('una sessione conta ogni coppia una volta sola, anche se rielaborata', () => {
    session('s1', [ids.gateway, ids.deploy])
    session('s1', [ids.gateway, ids.deploy])
    expect((alice as any).privateStore.unreportedCoUse()).toEqual({ [[ids.gateway, ids.deploy].sort().join(':')]: { count: 1, last: expect.any(Number) } })
  })

  it('il legame arriva all\'altro nodo e compare nella sua costellazione', async () => {
    session('s2', [ids.deploy, ids.gateway])
    session('s3', [ids.gateway, ids.deploy, ids.other])
    await alice.flushCoUse()
    const useLink = (n: MicelioNode) => n.graph().links.find((l) => l.kind === 'use' && [l.source, l.target].sort().join(':') === [ids.gateway, ids.deploy].sort().join(':'))
    await eventually(() => !!useLink(bob), [alice, bob])
    // 3 sessioni insieme: forza 0.63
    // EN: 3 sessions together: strength 0.63
    expect(useLink(bob)!.weight).toBeCloseTo(0.63, 1)
    // Tutto pubblicato: niente di nuovo da inviare
    // EN: Everything published: nothing new to send
    expect((alice as any).privateStore.unreportedCoUse()).toEqual({})
  })

  it('la ricerca porta con sé il ricordo che serve insieme, anche senza le parole cercate', async () => {
    await eventually(async () => (await bob.recallHybrid('rotte del gateway yaml', 5, false)).some((h) => h.id === ids.deploy), [bob])
    const hits = await bob.recallHybrid('rotte del gateway yaml', 5, false)
    const deploy = hits.find((h) => h.id === ids.deploy)!
    expect(deploy.broughtBy).toBe(ids.gateway)
    // Subito dopo il ricordo che lo porta
    // EN: Right after the memory that brings it
    expect(hits.findIndex((h) => h.id === ids.deploy)).toBe(hits.findIndex((h) => h.id === ids.gateway) + 1)
    // Il legame con "other" (una sola sessione) è sotto la soglia per portarlo
    // EN: The link with "other" (one session only) is below the threshold to bring it
    expect(hits.find((h) => h.id === ids.other)?.broughtBy).toBeUndefined()
  })
})
