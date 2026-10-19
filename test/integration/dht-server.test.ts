// Server del team (server/): due nodi Micelio che usano SOLO il nodo di avvio privato come punto
// d'incontro creano il team, si invitano e si scambiano un ricordo. Verifica anche la diagnosi
// di `micelio network check` contro lo stesso server.
// Tutto su 127.0.0.1: prova il funzionamento della DHT privata, NON l'attraversamento dei NAT reali.
import { randomBytes } from 'node:crypto'
import dgram from 'node:dgram'
import Hyperswarm from 'hyperswarm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkNetwork } from '../../src/net/diagnose'
import { relayKeyFor } from '../../src/net/relay-key'
import type { MicelioNode } from '../../src/node/micelio-node'
import { startServer, type RunningServer } from '../../server/src/dht-server'
import { eventually, localDht, makeNode } from '../helpers'

/** Una porta UDP libera (il nodo di avvio ha bisogno di una porta fissa). */
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
    expect(server.activity().announces).toBeLessThan(a.announces)
  })

  it('due PC che non si raggiungono direttamente si collegano tramite il relay (B8)', async () => {
    const before = server.activity().relay.sessions
    // relayThrough che restituisce SEMPRE la chiave: simula un hole punching impossibile
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
