// B4: uso da soli (team in modalità solo locale) e ricordi personali che non lasciano il PC.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nodePaths } from '../../src/core/paths'
import { HashEmbedder } from '../../src/embed/embedder'
import { FakeAdapter } from '../../src/llm/fake'
import { MicelioHost } from '../../src/node/micelio-host'
import { localDht, published, tmpHome } from '../helpers'

describe('da soli: modalità solo locale e ricordi personali', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  let host: MicelioHost

  beforeAll(async () => {
    dht = await localDht()
    // Senza bootstrap fissato dall'host: la rete del team viene dalle sue impostazioni.
    // La variabile tiene la DHT di test quando il team esce dalla modalità solo locale.
    process.env.MICELIO_DHT_BOOTSTRAP = dht.bootstrap.map((b) => `${b.host}:${b.port}`).join(',')
    host = new MicelioHost(nodePaths(tmpHome('solo')), { materializeDelayMs: 50, llm: new FakeAdapter(), embedder: new HashEmbedder() })
    await host.start()
  })

  afterAll(async () => {
    await host?.stop()
    await dht?.destroy()
    delete process.env.MICELIO_DHT_BOOTSTRAP
  })

  it('un team "solo per me" funziona senza rete; per invitare serve scegliere una rete', async () => {
    const { status } = await host.createTeam('Personale', 'ada', 'local')
    const node = host.node()
    expect(status.role).toBe('admin')
    expect(node.localOnly).toBe(true)
    expect(node.networkSettings().mode).toBe('local')
    published(await node.remember({ title: 'Comando per pulire la cache di npm', body: 'npm cache clean --force libera spazio.', tags: ['npm'] }))
    expect(node.recall('cache npm')).toHaveLength(1)
    await expect(node.invite()).rejects.toThrow(/solo locale/)
    await expect(node.checkNetwork()).rejects.toThrow(/solo locale/)
    // Scelta una rete il nodo si ricollega e l'invito funziona, senza perdere nulla
    await node.setNetwork('public')
    expect(node.localOnly).toBe(false)
    const inv = await node.invite()
    expect(inv.code.length).toBeGreaterThan(20)
    expect(node.recall('cache npm')).toHaveLength(1)
  })

  it('i ricordi personali si trovano nelle ricerche ma non entrano nel log del team', async () => {
    const node = host.node()
    const p = await node.rememberPersonal({ title: 'Il mio alias per i log del gateway', body: 'Uso alias gwlogs="kubectl logs -l app=gateway -f". Token: ghp_abcdefghijklmnopqrstuvwxyz0123456789', tags: ['kubectl'] })
    expect(p.duplicate).toBe(false)
    const [hit] = await node.recallHybrid('alias log gateway', 5)
    expect(hit).toMatchObject({ id: p.id, personal: true })
    // il segreto è comunque redatto: agli agenti arriva il testo
    expect(hit.body).not.toContain('ghp_')
    // fuori dal team: niente nel log, nell'elenco, nella costellazione, nel conteggio
    expect((await node.status()).memories).toBe(1)
    expect(node.graph().nodes.map((n) => n.id)).not.toContain(p.id)
    expect(node.personal().map((h) => h.id)).toEqual([p.id])
    // le operazioni di team non valgono per un ricordo personale
    await expect(node.vote(p.id, 1)).rejects.toThrow(/personale/)
    await expect(node.rootSet(p.id, 'practice')).rejects.toThrow(/personale/)
  })

  it('un ricordo personale si condivide con il team o si cancella', async () => {
    const node = host.node()
    const [p] = node.personal()
    const out = await node.sharePersonal(p.id.slice(0, 10))
    expect(out.outcome).toBe('team')
    expect(node.personal()).toEqual([])
    expect((await node.status()).memories).toBe(2)
    const q = await node.rememberPersonal({ title: 'Nota da cancellare', body: 'Solo una prova.' })
    await node.deletePersonal(q.id)
    expect(node.recall('nota cancellare')).toEqual([])
  })
})
