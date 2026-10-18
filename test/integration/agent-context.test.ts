// B4: contesto automatico per gli agenti, dal nodo (come lo chiedono gli hook di Claude Code).
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MicelioNode } from '../../src/node/micelio-node'
import { localDht, makeNode, published, tmpHome } from '../helpers'

describe('contesto automatico', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  let node: MicelioNode
  const project = path.join(tmpHome('ctx'), 'ordini')
  let rootId = ''

  beforeAll(async () => {
    dht = await localDht()
    fs.mkdirSync(project, { recursive: true })
    node = makeNode('ctx', dht.bootstrap).node
    await node.start()
    await node.init('Prodotto', 'ada')
    rootId = published(await node.remember({ title: 'Architettura del servizio ordini', body: 'Il servizio ordini pubblica eventi su Kafka e non chiama altri servizi in modo sincrono.', tags: ['ordini'] })).id
    await node.rootSet(rootId, 'architecture')
    published(await node.remember({ title: 'Retry del pagamento negli ordini', body: 'Il pagamento si riprova al massimo tre volte con backoff esponenziale.', tags: ['ordini', 'pagamenti'] }))
    published(await node.remember({ title: 'Configurazione del proxy aziendale per npm', body: 'Impostare HTTPS_PROXY prima di npm install nelle pipeline.', tags: ['npm'] }))
    // i vettori si calcolano in background: aspettiamo che ci siano
    for (let i = 0; i < 50 && (node as any).index.missingVectors('hash', 1).length; i++) await new Promise((r) => setTimeout(r, 100))
  })

  afterAll(async () => {
    await node?.stop()
    await dht?.destroy()
  })

  it('a inizio sessione: le Radici e i ricordi del progetto della cartella', async () => {
    const t = await node.agentContext({ event: 'session-start', cwd: project, sessionId: 's1' })
    expect(t).toContain('per il progetto «ordini»')
    expect(t).toContain('[RADICE architettura] Architettura del servizio ordini')
    expect(t).toContain('Retry del pagamento negli ordini')
    expect(t).not.toContain('proxy aziendale') // di un altro argomento
  })

  it('a ogni richiesta: solo ciò che è pertinente e non già mostrato nella sessione', async () => {
    const t = await node.agentContext({ event: 'prompt', cwd: project, sessionId: 's2', prompt: 'come configuro il proxy aziendale per npm install?' })
    expect(t).toContain('Configurazione del proxy aziendale per npm')
    // stessa sessione, stessa domanda: niente di nuovo da dire
    expect(await node.agentContext({ event: 'prompt', cwd: project, sessionId: 's2', prompt: 'come configuro il proxy aziendale per npm install?' })).toBe('')
    // richiesta troppo corta: nessun contesto
    expect(await node.agentContext({ event: 'prompt', cwd: project, sessionId: 's3', prompt: 'ok grazie' })).toBe('')
  })

  it('si spegne dalle impostazioni', async () => {
    node.updateContextSettings({ sessionStart: false, prompt: false })
    expect(node.settings().context).toMatchObject({ sessionStart: false, prompt: false })
    expect(await node.agentContext({ event: 'session-start', cwd: project, sessionId: 's4' })).toBe('')
    expect(await node.agentContext({ event: 'prompt', cwd: project, sessionId: 's4', prompt: 'come configuro il proxy aziendale per npm install?' })).toBe('')
  })

  it('lacune: una ricerca senza risposta si registra, si segnala al team e si chiude', async () => {
    expect(await node.recallHybrid('kubernetes helm chart', 5)).toEqual([])
    await node.recallHybrid('helm chart kubernetes', 5) // stessa domanda, altre parole in ordine diverso
    const [mine] = node.myGaps()
    expect(mine).toMatchObject({ query: 'helm chart kubernetes', count: 2, answer: null })
    // ricerche interne (track = false) non contano
    await node.recallHybrid('terraform', 5, false)
    expect(node.myGaps()).toHaveLength(1)

    const [g] = await node.reportGap(mine.key)
    expect(g).toMatchObject({ question: 'helm chart kubernetes', status: 'open', askerNames: ['ada'] })
    expect(node.myGaps()).toEqual([]) // segnalata: non è più fra le tue
    const mem = published(await node.remember({ title: 'Chart Helm per kubernetes', body: 'I chart Helm del team stanno nel repository infra, cartella charts.', tags: ['helm'] }))
    expect((await node.teamGaps())[0].answer?.id).toBe(mem.id)
    const [closed] = await node.closeGap(g.id.slice(0, 10), mem.id)
    expect(closed).toMatchObject({ status: 'closed', memory: mem.id })
  })

  it('riepilogo: ricordi nuovi, Radici, lacune della settimana', async () => {
    const d = await node.digest(7)
    expect(d.memories.added).toBe(4)
    expect(d.memories.byAuthor).toEqual([{ name: 'ada', count: 4 }])
    expect(d.roots.added.map((r) => r.title)).toEqual(['Architettura del servizio ordini'])
    expect(d.gaps).toEqual([]) // l'unica lacuna è chiusa
  })
})
