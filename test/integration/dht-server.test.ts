// Server del team (server/): due nodi Micelio che usano SOLO il nodo di avvio privato come punto
// d'incontro creano il team, si invitano e si scambiano un ricordo. Verifica anche la diagnosi
// di `micelio network check` contro lo stesso server.
// Tutto su 127.0.0.1: prova il funzionamento della DHT privata, NON l'attraversamento dei NAT reali.
// EN: Team server (server/): two Micelio nodes that use ONLY the private bootstrap node as meeting
//     point create the team, invite each other and exchange a memory. It also checks the diagnosis
//     of `micelio network check` against the same server.
//     All on 127.0.0.1: it tests how the private DHT works, NOT traversal of real NATs.
import { randomBytes } from 'node:crypto'
import dgram from 'node:dgram'
import Hyperswarm from 'hyperswarm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkNetwork } from '../../src/net/diagnose'
import { relayKeyFor } from '../../src/net/relay-key'
import { parseBootstrap } from '../../src/node/config'
import type { MicelioNode } from '../../src/node/micelio-node'
import { startServer, type RunningServer } from '../../server/src/dht-server'
import { eventually, localDht, makeNode } from '../helpers'

/** Una porta UDP libera (il nodo di avvio ha bisogno di una porta fissa). / EN: A free UDP port (the bootstrap node needs a fixed port). */
async function freeUdpPort (): Promise<number> {
  const s = dgram.createSocket('udp4')
  await new Promise<void>((resolve) => s.bind(0, '127.0.0.1', resolve))
  const { port } = s.address()
  await new Promise<void>((resolve) => s.close(() => resolve()))
  return port
}

describe('server del team: DHT privata', () => {
  let server: RunningServer
  const nodes: MicelioNode[] = []
  let alice: MicelioNode, bruno: MicelioNode
  let bootstrap: { host: string, port: number }[]

  beforeAll(async () => {
    const port = await freeUdpPort()
    server = await startServer({ publicHost: '127.0.0.1', bindHost: '127.0.0.1', port })
    bootstrap = [{ host: '127.0.0.1', port }]
    alice = makeNode('srv-alice', bootstrap).node
    bruno = makeNode('srv-bruno', bootstrap).node
    nodes.push(alice, bruno)
    await Promise.all(nodes.map((n) => n.start()))
  })

  afterAll(async () => {
    await Promise.all(nodes.map((n) => n.stop().catch(() => {})))
    await server?.close()
  })

  it('il server indica ai client la stringa host:porta da configurare', () => {
    expect(server.bootstrap).toBe(`127.0.0.1:${bootstrap[0].port}`)
  })

  it('invito e ricordi passano usando solo il server come punto d\'incontro', async () => {
    await alice.init('Team Server', 'alice')
    const { code } = await alice.invite()
    const s = await bruno.join(code, 'bruno')
    expect(s.writable).toBe(true)
    await alice.remember({ kind: 'decision', title: 'DHT privata con il server del team', body: 'Nodo di avvio su una macchina Linux, una porta UDP aperta.' })
    await eventually(() => bruno.recall('dht privata').length === 1, [alice, bruno])
  })

  it('network check: il server risponde', async () => {
    const r = await checkNetwork(bootstrap, 10_000)
    expect(r.reachable).toBe(true)
    expect(r.dht).toBe(`127.0.0.1:${bootstrap[0].port}`)
  })

  it('network check: il server offre il relay (B8)', async () => {
    const r = await checkNetwork(bootstrap, 10_000)
    expect(r.relay).toBe(true)
  })

  it('i nodi trovano il relay del server; il server conta chi lo contatta (B8)', async () => {
    await eventually(async () => (await alice.status()).relay?.reachable === true, [alice, bruno])
    expect(server.relayKey).toBe(relayKeyFor('127.0.0.1', bootstrap[0].port).toString('hex'))
    const a = server.activity()
    expect(a.clients).toBeGreaterThan(0)
    expect(a.announces).toBeGreaterThan(0)
    expect(a.lookups).toBeGreaterThan(0)
    // i contatori ripartono da zero a ogni lettura (un intervallo del log)
    // EN: the counters restart from zero on every read (one log interval)
    expect(server.activity().announces).toBeLessThan(a.announces)
  })

  it('due PC che non si raggiungono direttamente si collegano tramite il relay (B8)', async () => {
    const before = server.activity().relay.sessions
    // relayThrough che restituisce SEMPRE la chiave: simula un hole punching impossibile
    // EN: relayThrough that ALWAYS returns the key: simulates hole punching that cannot succeed
    const key = relayKeyFor('127.0.0.1', bootstrap[0].port)
    const mk = () => new Hyperswarm({ bootstrap, relayThrough: () => key })
    const a = mk()
    const b = mk()
    try {
      const topic = randomBytes(32)
      const got = new Promise<string>((resolve) => {
        b.on('connection', (conn: any) => { conn.on('error', () => {}); conn.on('data', (d: Buffer) => resolve(d.toString())) })
      })
      a.on('connection', (conn: any) => { conn.on('error', () => {}); conn.write('ciao attraverso il relay') })
      a.join(topic, { server: true, client: false })
      await a.flush()
      b.join(topic, { server: false, client: true })
      expect(await got).toBe('ciao attraverso il relay')
      expect(server.activity().relay.sessions - before).toBeGreaterThanOrEqual(2)
    } finally {
      await a.destroy()
      await b.destroy()
    }
  }, 30_000)

  it('network check: server spento → non raggiungibile', async () => {
    const r = await checkNetwork([{ host: '127.0.0.1', port: await freeUdpPort() }], 3_000)
    expect(r.reachable).toBe(false)
  })
})

describe('cambio di rete a caldo e spazio occupato', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  let server: RunningServer
  const nodes: MicelioNode[] = []
  let alice: MicelioNode, bruno: MicelioNode

  beforeAll(async () => {
    // Si parte da una DHT di test (A); il server del team (B) è un'altra DHT.
    // EN: We start from a test DHT (A); the team server (B) is another DHT.
    dht = await localDht()
    server = await startServer({ publicHost: '127.0.0.1', bindHost: '127.0.0.1', port: await freeUdpPort() })
    alice = makeNode('net-alice', dht.bootstrap).node
    bruno = makeNode('net-bruno', dht.bootstrap).node
    nodes.push(alice, bruno)
    await Promise.all(nodes.map((n) => n.start()))
    await alice.init('Team Rete', 'alice')
    await bruno.join((await alice.invite()).code, 'bruno')
  })

  afterAll(async () => {
    await Promise.all(nodes.map((n) => n.stop().catch(() => {})))
    await server?.close()
    await dht?.destroy()
  })

  it('setNetwork: entrambi passano alla DHT privata senza riavvio e continuano a sincronizzarsi', async () => {
    for (const n of nodes) {
      const s = await n.setNetwork('private', [server.bootstrap])
      expect(s).toMatchObject({ mode: 'private', bootstrap: [server.bootstrap], active: [server.bootstrap], fixedByEnv: null })
    }
    await alice.remember({ kind: 'fact', title: 'Ricordo scritto dopo il cambio di rete', body: 'Arriva a bruno attraverso la DHT privata.' })
    await eventually(() => bruno.recall('cambio di rete').length === 1, [alice, bruno])
  })

  it('setNetwork: nodi non validi o DHT privata senza nodi → errore leggibile, nulla cambia', async () => {
    await expect(alice.setNetwork('private', ['non-valido'])).rejects.toThrow(/host:porta/)
    expect(alice.networkSettings().bootstrap).toEqual([server.bootstrap])
  })

  it('passando alla pubblica i nodi privati restano salvati (si torna indietro senza riscriverli)', () => {
    // Solo la configurazione: non apriamo davvero la DHT pubblica nei test.
    // EN: Configuration only: we do not really open the public DHT in tests.
    expect(alice.settings().network.bootstrap).toEqual([server.bootstrap])
  })

  it('storage: totale su disco e quote del log del team per membro (somma 100%)', async () => {
    await bruno.remember({ kind: 'fact', title: 'Ricordo di bruno', body: 'Serve per avere due autori.' })
    await eventually(async () => (await alice.storage()).members.every((m) => m.bytes > 0), [alice, bruno])
    const r = await alice.storage()
    expect(r.disk.total).toBe(r.disk.log + r.disk.index + r.disk.private + r.disk.cache + r.disk.export)
    expect(r.disk.log).toBeGreaterThan(0)
    expect(r.members.map((m) => m.name).sort()).toEqual(['alice', 'bruno'])
    expect(r.members.reduce((n, m) => n + m.share, 0)).toBeCloseTo(1, 5)
    expect(r.teamLogBytes).toBe(r.members.reduce((n, m) => n + m.bytes, 0))
    expect(r.members.find((m) => m.name === 'bruno')!.memories).toBe(1)
  })
})

describe('server del team: chiave casuale del relay (0.6.2)', () => {
  it('l\'indirizzo da dare ai PC porta la chiave; senza chiave vecchia il relay non si impersona più', async () => {
    const port = await freeUdpPort()
    const seed = randomBytes(32)
    const srv = await startServer({ publicHost: '127.0.0.1', bindHost: '127.0.0.1', port, relay: { seed, legacy: false } })
    try {
      expect(srv.bootstrap).toBe(`127.0.0.1:${port}#${srv.relayKey}`)
      // La chiave non è più quella che chiunque calcola dall'indirizzo
      // EN: The key is no longer the one anyone computes from the address
      expect(srv.relayKey).not.toBe(relayKeyFor('127.0.0.1', port).toString('hex'))
      const withKey = await checkNetwork(parseBootstrap([srv.bootstrap]), 10_000)
      expect(withKey.relay).toBe(true)
      const derived = await checkNetwork(parseBootstrap([`127.0.0.1:${port}`]), 10_000)
      expect(derived.relay).toBe(false)
    } finally {
      await srv.close()
    }
  })

  it('transizione: con la chiave vecchia ancora accesa rispondono entrambe', async () => {
    const port = await freeUdpPort()
    const srv = await startServer({ publicHost: '127.0.0.1', bindHost: '127.0.0.1', port, relay: { seed: randomBytes(32) } })
    try {
      expect((await checkNetwork(parseBootstrap([srv.bootstrap]), 10_000)).relay).toBe(true)
      expect((await checkNetwork(parseBootstrap([`127.0.0.1:${port}`]), 10_000)).relay).toBe(true)
    } finally {
      await srv.close()
    }
  })
})
