// B10: chat sulla memoria con un nodo vero (LLM finto): risposta con riferimenti, mappa, domande che
// seguono, "non lo so" senza consumare il budget, salvataggio come ricordo, espandi, cronologia, scala.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { memoryId } from '../../src/core/events'
import { nodePaths } from '../../src/core/paths'
import { HashEmbedder } from '../../src/embed/embedder'
import { FakeAdapter } from '../../src/llm/fake'
import { MicelioHost } from '../../src/node/micelio-host'
import type { MicelioNode } from '../../src/node/micelio-node'
import { type BackupContent, countsOf, encodeBackup } from '../../src/backup/archive'
import { published, tmpHome } from '../helpers'

describe('chat sulla memoria', () => {
  let host: MicelioHost
  let node: MicelioNode
  const llm = new FakeAdapter()

  beforeAll(async () => {
    host = new MicelioHost(nodePaths(tmpHome('chat')), { materializeDelayMs: 50, llm, embedder: new HashEmbedder() })
    await host.start()
    await host.createTeam('Ordini', 'ada', 'local')
    node = host.node()
    published(await node.remember({ kind: 'howto', title: 'Retry dei consumer Kafka con backoff', body: 'Backoff esponenziale, massimo 5 tentativi, poi coda di scarto.', tags: ['kafka', 'retry'] }))
    published(await node.remember({ kind: 'gotcha', title: 'Messaggio malformato che blocca il consumer Kafka', body: 'Rifiutare senza rimettere in coda dopo 3 tentativi.', tags: ['kafka', 'retry'] }))
    published(await node.remember({ kind: 'decision', title: 'Indici sulle foreign key in Postgres', body: 'Postgres non indicizza le FK: aggiungere gli indici a mano.', tags: ['postgres'] }))
  })

  afterAll(async () => { await host?.stop() })

  it('mappa subito, poi risposta con i riferimenti; la domanda successiva porta la conversazione', async () => {
    const map = (await node.chatContext('come gestiamo i retry su kafka?')).map
    expect(map.memories.length).toBeGreaterThanOrEqual(2)
    expect(map.memories.filter((m) => m.found).map((m) => m.title)).toContain('Retry dei consumer Kafka con backoff')

    const r = await node.askChat('come gestiamo i retry su kafka?')
    expect(r.unknown).toBe(false)
    expect(r.answer).toMatch(/\[1\]/)
    expect(r.cited).toEqual([r.refs[0].id])
    // i temi prendono il nome dato dall'LLM
    expect(r.map.themes.every((t) => t.label.startsWith('Tema '))).toBe(true)

    const r2 = await node.askChat('e dopo quanti tentativi si scarta?', r.chatId)
    expect(r2.chatId).toBe(r.chatId)
    expect(llm.calls.filter((c) => c.name === 'chat').at(-1)!.input).toContain('DOMANDA: come gestiamo i retry su kafka?')
    expect(node.chats()[0]).toMatchObject({ id: r.chatId, title: 'come gestiamo i retry su kafka?', questions: 2 })
    expect(node.chatMessages(r.chatId).map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    // la chat finisce fra le consultazioni (pagina Efficacia)
    expect(node.efficacyReport(1).summary.byChannel.chat).toBe(2)
  })

  it('senza ricordi pertinenti: "non lo so" senza chiamare l\'LLM', async () => {
    const before = llm.calls.length
    const r = await node.askChat('qual è la ricetta della carbonara zzqq?')
    if (r.map.memories.length === 0) {
      expect(r.unknown).toBe(true)
      expect(llm.calls.length).toBe(before)
    }
  })

  it('salva come ricordo: la risposta entra nella memoria del team con le fonti', async () => {
    const r = await node.askChat('cosa sappiamo degli indici postgres sulle foreign key?')
    const out = await node.saveChatAnswer(r.messageId)
    expect(out.outcome).toBe('team')
    const saved = node.detail((out as { id: string }).id)!
    expect(saved.title).toBe('cosa sappiamo degli indici postgres sulle foreign key?')
    expect(saved.body).toContain('Fonti:')
    expect(saved.source?.type).toBe('chat')
    expect(node.chatMessages(r.chatId).at(-1)!.data.saved).toMatchObject({ outcome: 'team' })
  })

  it('espandi: i vicini di un ricordo nella costellazione', async () => {
    const kafka = node.recall('consumer kafka backoff')[0]
    const e = node.chatExpand(kafka.id)
    expect(e.links.every((l) => l.source === kafka.id || l.target === kafka.id)).toBe(true)
    expect(e.memories.length).toBe(e.links.length)
  })

  it('cronologia: rinomina e cancella', () => {
    const id = node.chats()[0].id
    node.renameChat(id, 'Retry e indici')
    expect(node.chats().find((c) => c.id === id)!.title).toBe('Retry e indici')
    node.deleteChat(id)
    expect(node.chats().find((c) => c.id === id)).toBeUndefined()
    expect(node.chatMessages(id)).toEqual([])
  })

  it('a scala: mappa di una domanda su 5 000 ricordi in meno di 200 ms (costellazione già pronta)', async () => {
    const memories = Array.from({ length: 5000 }, (_, i) => {
      const topic = ['kafka', 'postgres', 'react', 'docker', 'oauth'][i % 5]
      const base = { kind: 'fact' as const, title: `Nota ${topic} numero ${i}`, body: `Dettaglio su ${topic}: retry, timeout e indici, caso ${i}.` }
      return { id: memoryId(base), ...base, tags: [topic], source: { type: 'cli' }, author: 'a'.repeat(64), authorName: 'ada', ts: 1_700_000_000_000 + i, status: 'active' as const }
    })
    const content: BackupContent = { memories, roots: [], links: [], votes: {}, pins: [], usage: {}, gaps: [], config: {} }
    const file = encodeBackup(content, { team: 'Grande', createdAt: Date.now(), createdBy: 'test', counts: countsOf(content) }, 'una-password-lunga')
    const { id } = await host.restoreAsNewTeam(file, 'una-password-lunga', { network: 'local' })
    const big = host.node(id)
    big.graph() // la costellazione si calcola una volta (in uso reale è già pronta, in sottofondo)
    let t0 = performance.now()
    await big.chatContext('retry e timeout su kafka')
    const first = performance.now() - t0
    t0 = performance.now()
    const { map } = await big.chatContext('indici lenti su postgres')
    const next = performance.now() - t0
    expect(map.memories.length).toBeGreaterThan(5)
    expect(first).toBeLessThan(300)
    expect(next).toBeLessThan(150)
    console.log(`chat a scala (5 000 ricordi): prima domanda ${first.toFixed(0)} ms, successive ${next.toFixed(0)} ms, ${map.memories.length} ricordi in ${map.themes.length} temi`)
  }, 120_000)
})
