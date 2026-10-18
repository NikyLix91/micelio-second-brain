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

  it('file per gli agenti: CLAUDE.md con le Radici, aggiornato da solo quando cambiano', async () => {
    fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# Mie istruzioni\n\nUsa pnpm.\n')
    const r = await node.exportAgentFile({ dir: project, format: 'claude', keep: true })
    expect(r.changed).toBe(true)
    let text = fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8')
    expect(text).toContain('Usa pnpm.')
    expect(text).toContain('**Architettura del servizio ordini**')
    expect(node.agentFiles()).toMatchObject([{ format: 'claude', project: 'ordini', exists: true }])
    // una nuova Radice del progetto: il file si aggiorna senza fare nulla
    const id = published(await node.remember({ title: 'Policy dei segreti negli ordini', body: 'Le chiavi del servizio ordini stanno nel vault, mai nel repository.', tags: ['ordini'] })).id
    await node.rootSet(id, 'policy')
    for (let i = 0; i < 50 && !fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8').includes('Policy dei segreti'); i++) await new Promise((r) => setTimeout(r, 100))
    text = fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8')
    expect(text).toContain('**Policy dei segreti negli ordini**')
    expect(text.match(/micelio:start/g)).toHaveLength(1)
    node.removeAgentFile(project, 'claude')
    expect(node.agentFiles()).toEqual([])
  })

  it('import: ADR e CLAUDE.md diventano Radici, i contenuti riservati no', async () => {
    const dir = path.join(project, 'docs', 'adr')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '0002-api-rest.md'), '# API REST versionate\n\nTutte le API pubbliche hanno la versione nel percorso (/v1/).')
    fs.writeFileSync(path.join(dir, '0003-hr.md'), '# Note sulla valutazione annuale\n\nValutazione delle performance e stipendio di un collega.')
    const r = await node.importRoots(dir)
    expect(r).toMatchObject({ imported: 1, duplicates: 0 })
    expect(r.blocked).toHaveLength(1)
    const roots = await node.roots()
    expect(roots.find((x) => x.memory.title === 'API REST versionate')).toMatchObject({ category: 'architecture' })
    // reimportare non duplica
    expect(await node.importRoots(dir)).toMatchObject({ imported: 0, duplicates: 1 })
  })
})
