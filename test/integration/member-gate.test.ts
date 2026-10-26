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
    // Un team di prima della 0.7.0: protezione mai accesa (dalla UI non si spegne, qui si simula)
    // EN: A team from before 0.7.0: protection never on (the UI can't turn it off, here we simulate it)
    await (alice as any).team.append({ type: 'team.config', key: 'security.strict', value: false })
    await carla.join((await alice.invite()).code, 'carla')
  })

  afterAll(async () => {
    await Promise.all(nodes.map((n) => n.stop().catch(() => {})))
    await dht?.destroy()
  })

  it('accensione: solo un admin, e da lì non si spegne più; la prima generazione nasce da sola', async () => {
    // Si può accendere quando tutti i membri hanno pubblicato versione e chiave pubblica
    // EN: It can be turned on when every member has published version and public key
    await eventually(async () => (await alice.protection()).canEnable, nodes)
    const before = await alice.protection()
    expect(before).toMatchObject({ strict: false, waitingFor: [] })
    expect(before.members.map((m) => m.name).sort()).toEqual(['alice', 'carla'])
    expect(before.members.every((m) => m.version !== null)).toBe(true)
    await expect(carla.enableProtection()).rejects.toThrow(/riservata agli admin/)
    await alice.enableProtection()
    await eventually(async () => { const p = await alice.protection(); return p.strict && p.gen >= 1 && p.members.every((m) => m.hasKey) }, nodes)
    const gen = (await alice.protection()).gen
    await expect(alice.setTeamConfig('security.strict', false)).rejects.toThrow(/non si spegne/)
    // Cambio di chiave a mano: generazione 2, consegnata a tutti
    // EN: Manual key change: generation 2, handed to everyone
    expect(await alice.rotateKeys()).toEqual({ gen: gen + 1 })
    await eventually(async () => (await carla.protection()).gen === gen + 1 && (carla as any).team.keyStatus.ready, nodes)
    // Si spegne di nuovo solo per la controprova qui sotto (simula un team vecchio)
    // EN: Turned off again only for the counter-check below (simulates an old team)
    await (alice as any).team.append({ type: 'team.config', key: 'security.strict', value: false })
    await eventually(async () => !(await carla.protection()).strict, nodes)
  })

  it('senza il cancello un membro rimosso continua a ricevere: è il limite che la protezione chiude', async () => {
    await alice.removeMember('carla')
    published(await alice.remember({ kind: 'fact', title: 'Scritto dopo la rimozione', body: 'Senza protezione arriva lo stesso.' }))
    await eventually(() => carla.recall('Scritto dopo la rimozione').some((h) => h.title === 'Scritto dopo la rimozione'), nodes)
  })
})

describe('protezione completa: due admin cambiano la chiave insieme senza vedersi', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  const nodes: MicelioNode[] = []
  let alice: MicelioNode, bruno: MicelioNode, carla: MicelioNode
  let brunoHome = ''

  beforeAll(async () => {
    dht = await localDht()
    alice = makeNode('race-alice', dht.bootstrap).node
    const b = makeNode('race-bruno', dht.bootstrap)
    bruno = b.node
    brunoHome = b.home
    carla = makeNode('race-carla', dht.bootstrap).node
    nodes.push(alice, bruno, carla)
    await Promise.all(nodes.map((n) => n.start()))
    await alice.init('Team Corsa', 'alice')
    await bruno.join((await alice.invite()).code, 'bruno')
    await carla.join((await alice.invite()).code, 'carla')
    await alice.promoteMember('bruno')
    await eventually(async () => (await bruno.status()).role === 'admin' && (bruno as any).team.keyStatus.ready && (carla as any).team.keyStatus.ready, nodes)
  })

  afterAll(async () => {
    await Promise.all(nodes.map((n) => n.stop().catch(() => {})))
    await dht?.destroy()
  })

  it('vince una sola rotazione, ma i ricordi scritti con entrambe le chiavi restano leggibili a tutti', async () => {
    const gen = (await alice.protection()).gen
    // bruno spento: alice cambia la chiave e scrive
    // EN: bruno off: alice changes the key and writes
    await bruno.stop()
    nodes.splice(nodes.indexOf(bruno), 1)
    expect(await alice.rotateKeys()).toEqual({ gen: gen + 1 })
    published(await alice.remember({ kind: 'fact', title: 'Scritto da alice nella corsa', body: 'Con la chiave di alice.' }))
    await eventually(() => carla.recall('Scritto da alice nella corsa').some((h) => h.title === 'Scritto da alice nella corsa'), [alice, carla])
    // bruno riparte da solo (alice e carla spente per lui: niente rete), cambia la chiave e scrive
    // EN: bruno restarts on his own (alice and carla off for him: no network), changes the key and writes
    await alice.stop(); await carla.stop()
    bruno = makeNode('race-bruno', dht.bootstrap, brunoHome).node
    await bruno.start()
    expect((await bruno.protection()).gen).toBe(gen)
    expect(await bruno.rotateKeys()).toEqual({ gen: gen + 1 })
    published(await bruno.remember({ kind: 'fact', title: 'Scritto da bruno nella corsa', body: 'Con la chiave di bruno.' }))
    // Tutti di nuovo insieme
    // EN: Everyone together again
    await bruno.stop()
    const again = ['race-alice', 'race-bruno', 'race-carla'].map((l, i) => makeNode(l, dht.bootstrap, [(alice as any).paths.home, brunoHome, (carla as any).paths.home][i]).node)
    nodes.splice(0, nodes.length, ...again)
    await Promise.all(again.map((n) => n.start()))
    const titles = ['Scritto da alice nella corsa', 'Scritto da bruno nella corsa']
    await eventually(() => again.every((n) => titles.every((t) => n.recall(t).some((h) => h.title === t))), again, 60_000)
    // Una sola generazione corrente per tutti, e da lì si scrive con quella
    // EN: A single current generation for everyone, and from there on everyone writes with it
    await eventually(async () => (await Promise.all(again.map(async (n) => (await n.protection()).gen))).every((g) => g === gen + 1), again)
    // La rotazione perdente è conservata come alternativa: è lei che tiene leggibile il ricordo del perdente
    // EN: The losing rotation is kept as an alternate: it's what keeps the loser's memory readable
    expect((await (again[0] as any).team.rawScan({ gt: 'keyalt/', lt: 'keyalt0' })).length).toBe(1)
    published(await again[2].remember({ kind: 'fact', title: 'Scritto da carla dopo la corsa', body: 'Con la chiave vincente.' }))
    await eventually(() => again.every((n) => n.recall('Scritto da carla dopo la corsa').some((h) => h.title === 'Scritto da carla dopo la corsa')), again)
  }, 180_000)
})
