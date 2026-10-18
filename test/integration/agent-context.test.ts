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
})
