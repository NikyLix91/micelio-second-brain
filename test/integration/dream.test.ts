/**
 * Dreaming su nodi reali (DHT locale, LLM ed embedder finti): fusione dei duplicati con
 * replica a tutto il team, ripristino, sogni concorrenti sulla stessa epoca.
 *
 * EN: Dreaming on real nodes (local DHT, fake LLM and embedder): merging duplicates with
 * replication to the whole team, restore, concurrent dreams on the same epoch.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MicelioNode } from '../../src/node/micelio-node'
import { eventually, localDht, makeNode, published } from '../helpers'

describe('dreaming', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  let alice: MicelioNode, bob: MicelioNode

  beforeAll(async () => {
    dht = await localDht()
    alice = makeNode('alice', dht.bootstrap).node
    bob = makeNode('bob', dht.bootstrap).node
    await alice.start(); await bob.start()
    await alice.init('Team Sogni', 'alice')
    await bob.join((await alice.invite()).code, 'bob')
    // Due quasi duplicati (stesse parole: l'embedder finto li vede molto simili) e uno diverso.
    // EN: Two near duplicates (same words: the fake embedder sees them as very similar) and a different one.
    published(await alice.remember({ title: 'Timeout delle chiamate al magazzino', body: 'Le chiamate sincrone al servizio magazzino hanno timeout di due secondi e circuit breaker.' }))
    published(await bob.remember({ title: 'Timeout chiamate servizio magazzino', body: 'Chiamate sincrone al magazzino: timeout di due secondi e circuit breaker.' }))
    published(await alice.remember({ title: 'Convenzione dei messaggi di commit', body: 'Usiamo Conventional Commits per generare il changelog a ogni release.' }))
    // Attende che entrambi i nodi abbiano i 3 ricordi e i loro vettori.
    // EN: Waits until both nodes have the 3 memories and their vectors.
    await eventually(async () => (await alice.status()).memories === 3 && (await bob.status()).memories === 3, [alice, bob])
    await eventually(() => alice.graph().links.some((l) => l.kind === 'semantic'), [alice])
  })

  afterAll(async () => {
    await alice?.stop(); await bob?.stop()
    await dht?.destroy()
  })

  it('un sogno fonde i quasi duplicati; la fusione arriva a tutto il team', async () => {
    const r = await alice.dreamNow()
    expect(r.merged).toBe(2)
    expect(r.summary).toMatch(/Fusi 2 ricordi/)
    await eventually(async () => (await bob.status()).memories === 2, [bob]) // 2 vecchi → 1 nuovo, + l'altro / EN: 2 old → 1 new, + the other one
    expect((await bob.recallHybrid('magazzino timeout'))[0].title).toMatch(/consolidato/)
    expect(bob.archived().filter((m) => m.status === 'superseded')).toHaveLength(2)
    // Il diario del sogno è un evento a parte, che può arrivare a bob dopo le fusioni: va atteso
    // anche lui (sui runner lenti della CI il test falliva leggendolo subito).
    // EN: The dream log is a separate event that can reach bob after the merges: it must be waited
    //     for too (on slow CI runners the test failed by reading it right away).
    const by = (await alice.status()).nodeKey
    await eventually(async () => (await bob.dreams())[0]?.by === by, [bob])
    expect((await bob.dreams())[0]).toMatchObject({ by })
  })

  it('un ricordo sostituito si può ripristinare', async () => {
    const old = alice.archived()[0]
    await alice.restore(old.id)
    await eventually(() => bob.archived().length === 1, [bob])
    expect(bob.get(old.id)?.title).toBe(old.title)
  })

  it('due nodi che sognano la stessa epoca in parallelo: un solo diario, dello stesso vincitore', async () => {
    const run = (n: MicelioNode) => (n as any).runDream('epoca-contesa') as Promise<unknown>
    const [ra, rb] = await Promise.all([run(alice), run(bob)])
    // Garanzia (apply): dopo la convergenza il diario dell'epoca è UNO solo, uguale su entrambi i
    // nodi, scritto dal vincitore della rivendicazione. (Con l'attesa dopo la rivendicazione, di
    // solito procede anche un solo nodo; ma non è garantito se la rete è lenta.)
    // EN: Guarantee (apply): after convergence there is only ONE log for the epoch, the same on both
    //     nodes, written by the winner of the claim. (With the wait after the claim, usually only one
    //     node proceeds anyway; but that's not guaranteed if the network is slow.)
    expect([ra, rb].some(Boolean)).toBe(true)
    const one = async (n: MicelioNode) => (await n.dreams()).filter((d) => d.epoch === 'epoca-contesa')
    await eventually(async () => (await one(alice)).length === 1 && (await one(bob)).length === 1, [alice, bob])
    expect((await one(alice))[0].by).toBe((await one(bob))[0].by)
  })
})
