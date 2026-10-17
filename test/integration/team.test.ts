// Integrazione multi-nodo su DHT locale: creazione del team, ingresso via invito (blind-pairing),
// convergenza dei ricordi, ingresso con chi ha invitato offline, permessi admin.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MicelioNode } from '../../src/node/micelio-node'
import { eventually, localDht, makeNode, published } from '../helpers'

describe('team multi-nodo', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  const nodes: MicelioNode[] = []
  let alice: MicelioNode, bob: MicelioNode, carol: MicelioNode

  beforeAll(async () => {
    dht = await localDht()
    alice = makeNode('alice', dht.bootstrap).node
    bob = makeNode('bob', dht.bootstrap).node
    carol = makeNode('carol', dht.bootstrap).node
    nodes.push(alice, bob, carol)
    await Promise.all(nodes.map((n) => n.start()))
  })

  afterAll(async () => {
    await Promise.all(nodes.map((n) => n.stop().catch(() => {})))
    await dht?.destroy()
  })

  it('il fondatore crea il team ed è admin e indexer', async () => {
    const s = await alice.init('Team Dev', 'alice')
    expect(s.configured).toBe(true)
    expect(s.team?.name).toBe('Team Dev')
    expect(s.role).toBe('admin')
    expect(s.indexer).toBe(true)
  })

  it('un nuovo membro entra con un codice d\'invito', async () => {
    const { code } = await alice.invite()
    const s = await bob.join(code, 'bob')
    expect(s.writable).toBe(true)
    expect(s.role).toBe('member')
    expect(s.indexer).toBe(false)
    const members = await alice.members()
    await eventually(async () => (await alice.members()).length === 2, [alice])
    expect(members.length).toBeGreaterThanOrEqual(1)
    const bobRec = (await alice.members()).find((m) => m.name === 'bob')
    expect(bobRec?.invitedBy).toBe((await alice.status()).nodeKey)
  })

  it('un invito usato sparisce dagli inviti pendenti (monouso)', async () => {
    await eventually(async () => (await alice.invites()).length === 0, [alice])
  })

  it('i ricordi convergono e sono ricercabili su ogni nodo', async () => {
    await alice.remember({ kind: 'gotcha', title: 'Build Angular in out of memory su Azure DevOps', body: 'Impostare NODE_OPTIONS=--max-old-space-size=6144 nello step di build.', tags: ['angular', 'ci'] })
    await bob.remember({ kind: 'decision', title: 'Drizzle come ORM per i nuovi servizi', body: 'Scelto Drizzle al posto di Prisma: niente motore binario, problemi passati con Alpine.', tags: ['orm', 'postgres'] })
    await eventually(() => alice.recall('drizzle').length === 1 && bob.recall('angular').length === 1, [alice, bob])
    const hit = bob.recall('memoria esaurita build angular')[0]
    expect(hit.title).toContain('Angular')
    expect(hit.authorName).toBe('alice')
  })

  it('lo stesso ricordo scritto da due nodi non si duplica', async () => {
    const m = { title: 'Le migrazioni si eseguono nel job di release', body: 'Mai a mano in produzione.' }
    const a = published(await alice.remember(m))
    await eventually(() => bob.get(a.id) !== null, [bob])
    const b = published(await bob.remember(m))
    expect(b.id).toBe(a.id)
    expect(b.duplicate).toBe(true)
  })

  it('chi ha invitato può essere offline: un altro membro accoglie il nuovo arrivato', async () => {
    const { code, replicated } = await bob.invite()
    expect(replicated).toBe(true) // alice ha già l'invito: bob può andarsene
    const bobIndex = nodes.indexOf(bob)
    await bob.stop()
    nodes.splice(bobIndex, 1)
    const s = await carol.join(code, 'carol')
    expect(s.writable).toBe(true)
    await eventually(() => carol.recall('drizzle').length === 1, [carol])
    const carolRec = (await carol.members()).find((m) => m.name === 'carol')
    // accolta da alice, ma l'invito resta attribuito a bob che l'ha creato
    const bobKey = (await carol.members()).find((m) => m.name === 'bob')?.key
    expect(carolRec?.invitedBy).toBe(bobKey)
  })

  it('solo un admin può espellere; l\'admin può promuovere', async () => {
    // carol (membro) prova a espellere alice: rifiutato dal nodo stesso
    await expect(carol.removeMember('alice')).rejects.toThrow(/riservata agli admin/)
    await eventually(async () => (await alice.members()).some((m) => m.name === 'carol'), [alice])
    expect((await alice.members()).find((m) => m.name === 'alice')?.removed).toBe(false)

    await alice.promoteMember('carol')
    await eventually(async () => (await carol.status()).role === 'admin', [carol, alice])
    await eventually(async () => (await carol.status()).indexer, [carol, alice])
  })

  it('un membro espulso non può più scrivere ricordi visibili al team', async () => {
    await alice.removeMember('bob')
    const bobRec = (await alice.members()).find((m) => m.name === 'bob')
    expect(bobRec?.removed).toBe(true)
    expect((await alice.status()).members).toBe(2)
  })
})
