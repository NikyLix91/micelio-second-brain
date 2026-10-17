// Server del team (server/): due nodi Micelio che usano SOLO il nodo di avvio privato come punto
// d'incontro creano il team, si invitano e si scambiano un ricordo. Verifica anche la diagnosi
// di `micelio network check` contro lo stesso server.
// Tutto su 127.0.0.1: prova il funzionamento della DHT privata, NON l'attraversamento dei NAT reali.
import dgram from 'node:dgram'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkNetwork } from '../../src/net/diagnose'
import type { MicelioNode } from '../../src/node/micelio-node'
import { startServer, type RunningServer } from '../../server/src/dht-server'
import { eventually, makeNode } from '../helpers'

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

  it('network check: server spento → non raggiungibile', async () => {
    const r = await checkNetwork([{ host: '127.0.0.1', port: await freeUdpPort() }], 3_000)
    expect(r.reachable).toBe(false)
  })
})
