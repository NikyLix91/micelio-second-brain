// B12: ricevuta di redazione con nodi veri. Un admin redige; ogni PC acceso toglie il ricordo anche
// da chat e copie personali e conferma con una firma; un PC spento resta in attesa.
// EN: B12: redaction receipt with real nodes. An admin redacts; every PC that's on also removes the
//     memory from chat and personal copies and confirms with a signature; a PC that's off stays pending.
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nodePaths } from '../../src/core/paths'
import { ensureIdentity, verifyRedactAck } from '../../src/core/identity'
import { HashEmbedder } from '../../src/embed/embedder'
import { FakeAdapter } from '../../src/llm/fake'
import { MicelioNode } from '../../src/node/micelio-node'
import { eventually, localDht, makeNode, published, tmpHome } from '../helpers'

describe('ricevuta di redazione (B12)', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  let alice: MicelioNode
  let bob: MicelioNode
  let carol: MicelioNode
  let id: string
  const bobIdentity = ensureIdentity(path.join(tmpHome('bob-id'), 'identity.json'), 'bob')

  beforeAll(async () => {
    dht = await localDht()
    alice = makeNode('alice', dht.bootstrap).node
    // Bob con identità personale: le sue conferme sono firmate
    // EN: Bob with a personal identity: his confirmations are signed
    bob = new MicelioNode(nodePaths(tmpHome('bob')), { bootstrap: dht.bootstrap, materializeDelayMs: 50, llm: new FakeAdapter(), embedder: new HashEmbedder(), identity: () => bobIdentity })
    carol = makeNode('carol', dht.bootstrap).node
    await Promise.all([alice.start(), bob.start(), carol.start()])
    await alice.init('Team Dev', 'alice')
    await bob.join((await alice.invite()).code, 'bob')
    await carol.join((await alice.invite()).code, 'carol')
    id = published(await alice.remember({ kind: 'fact', title: 'Endpoint interno della fatturazione', body: 'La fatturazione espone le API su billing-int.example:8443, con certificato interno.', tags: ['fatturazione'] })).id
    await eventually(() => !!bob.detail(id) && !!carol.detail(id), [alice, bob, carol])
    // Copie locali su Bob: una risposta della chat che lo cita e una copia personale
    // EN: Local copies on Bob: a chat answer citing it and a personal copy
    const store = (bob as any).privateStore
    const chat = store.createChat('fatturazione')
    store.addChatMessage(chat, 'user', 'dove sono le API della fatturazione?')
    store.addChatMessage(chat, 'assistant', 'Su billing-int.example:8443 [1].', { cited: [id], refs: [{ n: 1, id, title: 'Endpoint interno della fatturazione' }] })
    store.addPersonal(id, { kind: 'fact', title: 'Endpoint interno della fatturazione', body: 'La fatturazione espone le API su billing-int.example:8443, con certificato interno.', tags: [], source: { type: 'cli' } })
    // Carol è spenta quando arriva la redazione
    // EN: Carol is off when the redaction arrives
    await carol.stop()
  })

  afterAll(async () => {
    await Promise.all([alice, bob].map((n) => n?.stop().catch(() => {})))
    await dht?.destroy()
  })

  it('i PC accesi confermano; quello spento resta in attesa', async () => {
    await alice.redact(id, 'host interno del cliente')
    await eventually(async () => (await alice.redactions())[0]?.confirmed === 2, [alice, bob])
    const [r] = await alice.redactions()
    expect(r).toMatchObject({ id, reason: 'host interno del cliente', confirmed: 2, total: 3, by: { name: 'alice' } })
    expect(r.at).toBeGreaterThan(0)
    expect(r.members.find((m) => m.name === 'carol')).toMatchObject({ status: 'pending', ack: null })
    const b = r.members.find((m) => m.name === 'bob')!
    expect(b.ack).toMatchObject({ cleaned: { chat: 1, inbox: 0, personal: 1 }, backups: 0, person: bobIdentity.publicKey })
    expect(verifyRedactAck(bobIdentity.publicKey, id, b.key, b.ack!.ts, b.ack!.sig!)).toBe(true)
    // Alice non ha identità: conferma valida ma non firmata
    // EN: Alice has no identity: valid confirmation but not signed
    expect(r.members.find((m) => m.name === 'alice')!.ack?.sig).toBeUndefined()
  })

  it('su Bob il contenuto non c\'è più: né in ricerca, né in chat, né fra i personali', async () => {
    const store = (bob as any).privateStore
    expect(store.personal().some((p: any) => p.id === id)).toBe(false)
    const msgs = store.chatMessages(store.chats()[0].id)
    expect(msgs[1]).toMatchObject({ text: '[contenuto rimosso]', data: { redacted: true } })
    expect(JSON.stringify(msgs)).not.toContain('billing-int')
    expect((await bob.recallHybrid('api fatturazione billing', 5, false)).some((h) => h.id === id)).toBe(false)
  })

  it('la ricevuta dice chi ha confermato e i limiti', async () => {
    const rc = await bob.redactionReceipt(id.slice(0, 12))
    expect(rc.text).toContain('PC che hanno confermato: 2 su 3')
    expect(rc.text).toContain('firmato con l\'identità personale')
    expect((rc.json as any).members.find((m: any) => m.name === 'bob').signature.person).toBe(bobIdentity.publicKey)
  })
})
