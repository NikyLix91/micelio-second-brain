/**
 * Dreaming su nodi reali (DHT locale, LLM ed embedder finti): fusione dei duplicati con
 * replica a tutto il team, ripristino, sogni concorrenti sulla stessa epoca.
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
    published(await alice.remember({ title: 'Timeout delle chiamate al magazzino', body: 'Le chiamate sincrone al servizio magazzino hanno timeout di due secondi e circuit breaker.' }))
    published(await bob.remember({ title: 'Timeout chiamate servizio magazzino', body: 'Chiamate sincrone al magazzino: timeout di due secondi e circuit breaker.' }))
    published(await alice.remember({ title: 'Convenzione dei messaggi di commit', body: 'Usiamo Conventional Commits per generare il changelog a ogni release.' }))
    // Attende che entrambi i nodi abbiano i 3 ricordi e i loro vettori.
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
    await eventually(async () => (await bob.status()).memories === 2, [bob]) // 2 vecchi → 1 nuovo, + l'altro
    expect((await bob.recallHybrid('magazzino timeout'))[0].title).toMatch(/consolidato/)
    expect(bob.archived().filter((m) => m.status === 'superseded')).toHaveLength(2)
    const log = await bob.dreams()
    expect(log[0]).toMatchObject({ by: (await alice.status()).nodeKey })
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
    expect([ra, rb].some(Boolean)).toBe(true)
    const one = async (n: MicelioNode) => (await n.dreams()).filter((d) => d.epoch === 'epoca-contesa')
    await eventually(async () => (await one(alice)).length === 1 && (await one(bob)).length === 1, [alice, bob])
    expect((await one(alice))[0].by).toBe((await one(bob))[0].by)
  })
})
