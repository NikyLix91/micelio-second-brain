// Protezione completa, strato 1 (0.7.0): si replica solo con i membri attivi. Il caso reale da
// chiudere: un membro rimosso conserva la chiave del registro e continuava a ricevere tutto quello
// che il team scriveva dopo (revisione di sicurezza 2026-10-26).
// EN: Full protection, layer 1 (0.7.0): replication only with active members. The real case to
//     close: a removed member keeps the log key and kept receiving everything the team wrote
//     afterwards (security review 2026-10-26).
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import Hypercore from 'hypercore'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { memberPayload, validProof } from '../../src/net/member-gate'
import type { MicelioNode } from '../../src/node/micelio-node'
import { eventually, localDht, makeNode, published } from '../helpers'

describe('prova di appartenenza', () => {
  it('vale solo per QUESTA sessione e solo per il feed della chiave che firma', () => {
    const kp = crypto.keyPair()
    const writer = b4a.toString(Hypercore.key(kp.publicKey), 'hex')
    const hh = b4a.alloc(32, 3)
    const sig = b4a.toString(crypto.sign(memberPayload(hh), kp.secretKey), 'hex')
    const proof = { writer, signer: b4a.toString(kp.publicKey, 'hex'), sig }
    expect(validProof(hh, proof)).toBe(true)
    expect(validProof(b4a.alloc(32, 4), proof)).toBe(false) // altra connessione / EN: another connection
    expect(validProof(hh, { ...proof, writer: 'a'.repeat(64) })).toBe(false) // feed di un altro / EN: someone else's feed
    expect(validProof(hh, { ...proof, sig: 'b'.repeat(128) })).toBe(false)
    expect(validProof(hh, null)).toBe(false)
  })
})

describe('protezione completa: replica solo con i membri attivi', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  const nodes: MicelioNode[] = []
  let alice: MicelioNode, bruno: MicelioNode, carla: MicelioNode

  beforeAll(async () => {
    dht = await localDht()
    alice = makeNode('gate-alice', dht.bootstrap).node
    bruno = makeNode('gate-bruno', dht.bootstrap).node
    carla = makeNode('gate-carla', dht.bootstrap).node
    nodes.push(alice, bruno, carla)
    await Promise.all(nodes.map((n) => n.start()))
    await alice.init('Team Cancello', 'alice')
    await bruno.join((await alice.invite()).code, 'bruno')
    await carla.join((await alice.invite()).code, 'carla')
  })

  afterAll(async () => {
    await Promise.all(nodes.map((n) => n.stop().catch(() => {})))
    await dht?.destroy()
  })

  it('i membri attivi si sincronizzano come sempre (team nuovo: protezione accesa)', async () => {
    expect(await (alice as any).team.config('security.strict')).toBe(true)
    published(await alice.remember({ kind: 'fact', title: 'Prima della rimozione', body: 'Tutti e tre lo vedono.' }))
    await eventually(() => bruno.recall('prima della rimozione').length === 1 && carla.recall('prima della rimozione').length === 1, nodes)
  })

  it('carla rimossa: con i suoi nodo e chiavi intatti non riceve più niente di nuovo', async () => {
    await alice.removeMember('carla')
    await eventually(async () => (await bruno.members()).find((m) => m.name === 'carla')?.removed === true, [alice, bruno])
    published(await alice.remember({ kind: 'decision', title: 'Dopo la rimozione', body: 'Solo alice e bruno lo vedono.' }))
    published(await bruno.remember({ kind: 'fact', title: 'Anche bruno scrive dopo', body: 'Carla non deve vederlo.' }))
    const has = (n: MicelioNode, title: string) => n.recall(title).some((h) => h.title === title)
    await eventually(() => has(bruno, 'Dopo la rimozione') && has(alice, 'Anche bruno scrive dopo'), [alice, bruno])
    // Carla resta online con la chiave del registro: lasciamo il tempo a eventuali riconnessioni
    // EN: Carla stays online with the log key: we leave time for any reconnection
    for (let i = 0; i < 15; i++) { await carla.sync().catch(() => {}); await new Promise((r) => setTimeout(r, 200)) }
    expect(has(carla, 'Dopo la rimozione')).toBe(false)
    expect(has(carla, 'Anche bruno scrive dopo')).toBe(false)
    // ...e quello che aveva prima resta suo (nessun sistema può toglierlo)
    // EN: ...and what she had before stays hers (no system can take it away)
    expect(has(carla, 'Prima della rimozione')).toBe(true)
  })
})

describe('protezione completa, strato 2: il contenuto nuovo è cifrato con una chiave che chi è stato rimosso non ha', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  const nodes: MicelioNode[] = []
  let alice: MicelioNode, bruno: MicelioNode, carla: MicelioNode

  beforeAll(async () => {
    dht = await localDht()
    alice = makeNode('gen-alice', dht.bootstrap).node
    bruno = makeNode('gen-bruno', dht.bootstrap).node
    carla = makeNode('gen-carla', dht.bootstrap).node
    nodes.push(alice, bruno, carla)
    await Promise.all(nodes.map((n) => n.start()))
    await alice.init('Team Generazioni', 'alice')
    await bruno.join((await alice.invite()).code, 'bruno')
    await carla.join((await alice.invite()).code, 'carla')
    published(await carla.remember({ kind: 'fact', title: 'Scritto da carla quando era membro', body: 'Cifrato con la prima generazione.' }))
    await eventually(() => alice.recall('Scritto da carla').some((h) => h.title === 'Scritto da carla quando era membro'), nodes)
  })

  afterAll(async () => {
    await Promise.all(nodes.map((n) => n.stop().catch(() => {})))
    await dht?.destroy()
  })

  it('nella vista il contenuto è cifrato: niente testo in chiaro nei blocchi replicati', async () => {
    const raw: any[] = []
    for await (const { value } of (alice as any).team.base.view.createReadStream({ gt: 'memory/', lt: 'memory0' })) raw.push(value)
    expect(raw.length).toBeGreaterThan(0)
    expect(raw.every((m) => typeof m.sealed === 'string' && m.title === '' && m.body === '')).toBe(true)
    expect(JSON.stringify(raw)).not.toMatch(/Cifrato con la prima generazione/)
  })

  it('rimossa e con i dati passati da un membro scavalcando il cancello, carla non legge il nuovo', async () => {
    await alice.removeMember('carla')
    // La rotazione parte da sola: generazione 2 senza carla
    // EN: Rotation starts by itself: generation 2 without carla
    await eventually(() => (alice as any).team.keyStatus.gen === 2 && (bruno as any).team.keyStatus.ready && (bruno as any).team.keyStatus.gen === 2, [alice, bruno])
    published(await alice.remember({ kind: 'decision', title: 'Segreto dopo la rimozione', body: 'Carla non deve poterlo leggere.' }))
    await eventually(() => bruno.recall('Segreto dopo la rimozione').some((h) => h.title === 'Segreto dopo la rimozione'), [alice, bruno])
    // Un membro "complice" replica direttamente con carla, fuori dal cancello
    // EN: An "accomplice" member replicates directly with carla, outside the gate
    const a = (bruno as any).team.store.replicate(true)
    const c = (carla as any).team.store.replicate(false)
    a.pipe(c).pipe(a)
    const sawSealed = async () => {
      for await (const { value } of (carla as any).team.base.view.createReadStream({ gt: 'memory/', lt: 'memory0' })) if (value.kind === 'decision' && value.sealed) return true
      return false
    }
    await eventually(sawSealed, [carla], 30_000)
    expect((carla as any).team.keyStatus).toMatchObject({ gen: 2, ready: false })
    expect(carla.recall('Segreto dopo la rimozione').some((h) => h.title === 'Segreto dopo la rimozione')).toBe(false)
    expect(JSON.stringify(await (carla as any).team.memories())).not.toMatch(/Carla non deve poterlo leggere/)
    // ...mentre quello scritto prima, con la generazione 1 che aveva, resta leggibile
    // EN: ...while what was written before, with generation 1 she had, stays readable
    expect(carla.recall('Scritto da carla').some((h) => h.title === 'Scritto da carla quando era membro')).toBe(true)
    a.destroy(); c.destroy()
  })

  it('chi entra dopo legge anche la storia: la catena delle chiavi risale alle generazioni precedenti', async () => {
    const dario = makeNode('gen-dario', dht.bootstrap).node
    nodes.push(dario)
    await dario.start()
    await dario.join((await alice.invite()).code, 'dario')
    await eventually(() => dario.recall('Scritto da carla').some((h) => h.title === 'Scritto da carla quando era membro') && dario.recall('Segreto dopo la rimozione').some((h) => h.title === 'Segreto dopo la rimozione'), [alice, bruno, dario])
  })
})

describe('protezione spenta (team esistenti, nodi 0.6.x): come prima della 0.7.0', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  const nodes: MicelioNode[] = []
  let alice: MicelioNode, carla: MicelioNode

  beforeAll(async () => {
    dht = await localDht()
    alice = makeNode('open-alice', dht.bootstrap).node
    carla = makeNode('open-carla', dht.bootstrap).node
    nodes.push(alice, carla)
    await Promise.all(nodes.map((n) => n.start()))
    await alice.init('Team Aperto', 'alice')
    await alice.setTeamConfig('security.strict', false)
    await carla.join((await alice.invite()).code, 'carla')
  })

  afterAll(async () => {
    await Promise.all(nodes.map((n) => n.stop().catch(() => {})))
    await dht?.destroy()
  })

  it('senza il cancello un membro rimosso continua a ricevere: è il limite che la protezione chiude', async () => {
    await alice.removeMember('carla')
    published(await alice.remember({ kind: 'fact', title: 'Scritto dopo la rimozione', body: 'Senza protezione arriva lo stesso.' }))
    await eventually(() => carla.recall('Scritto dopo la rimozione').some((h) => h.title === 'Scritto dopo la rimozione'), nodes)
  })
})
