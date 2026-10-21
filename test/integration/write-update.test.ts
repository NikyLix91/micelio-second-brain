// B4: aggiornare invece di aggiungere, dal salvataggio fino al log del team.
// EN: B4: update instead of add, from saving all the way to the team log.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeAdapter } from '../../src/llm/fake'
import type { MicelioNode } from '../../src/node/micelio-node'
import { localDht, makeNode, published } from '../helpers'

describe('aggiornare invece di aggiungere', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  let node: MicelioNode
  let fake: FakeAdapter
  const writeCalls = () => fake.calls.filter((c) => c.name === 'write-update').length

  beforeAll(async () => {
    dht = await localDht()
    node = makeNode('write-update', dht.bootstrap).node
    fake = (node as any).llm.adapter as FakeAdapter
    await node.start()
    await node.init('Team', 'ada')
  })

  afterAll(async () => {
    await node?.stop()
    await dht?.destroy()
  })

  it('un ricordo che corregge uno esistente lo sostituisce con una versione unica', async () => {
    const old = published(await node.remember({ title: 'Timeout del gateway di pagamento', body: 'Il gateway di pagamento va in timeout dopo 30 secondi.', tags: ['gateway'] }))
    // Prima versione: nessun ricordo simile, nessuna chiamata all'LLM
    // EN: First version: no similar memory, no LLM call
    expect(writeCalls()).toBe(0)
    const r = await node.remember({ title: 'Timeout del gateway di pagamento aggiornato', body: 'Il gateway di pagamento va in timeout dopo 60 secondi [aggiorna].', tags: ['gateway'] })
    expect(r).toMatchObject({ outcome: 'team', updated: old.id })
    expect(writeCalls()).toBe(1)
    // Nella ricerca c'è una sola versione, quella nuova; la vecchia è nello storico
    // EN: Search returns a single version, the new one; the old one is in the history
    const hits = node.recall('gateway timeout')
    expect(hits.map((h) => h.title)).toEqual(['Timeout del gateway di pagamento (aggiornato)'])
    expect(node.archived().find((m) => m.id === old.id)).toMatchObject({ status: 'superseded' })
  })

  it('un duplicato non aggiunge niente', async () => {
    const before = (await node.status()).memories
    const r = await node.remember({ title: 'Gateway di pagamento: timeout', body: 'Timeout del gateway di pagamento dopo 60 secondi [duplicato].', tags: ['gateway'] })
    expect(r).toMatchObject({ outcome: 'team', duplicate: true })
    expect((await node.status()).memories).toBe(before)
  })

  it('una Radice non viene mai sostituita, e l\'admin può spegnere il controllo', async () => {
    const root = published(await node.remember({ title: 'Regole per i deploy di venerdì', body: 'Niente deploy in produzione il venerdì pomeriggio.', tags: ['deploy'] }))
    await node.rootSet(root.id, 'policy')
    const r = await node.remember({ title: 'Deploy di venerdì consentiti', body: 'Deploy in produzione il venerdì pomeriggio consentiti con approvazione [aggiorna].', tags: ['deploy'] })
    expect(r).toMatchObject({ outcome: 'team' })
    expect((r as any).updated).toBeUndefined()
    expect(node.recall('venerdì deploy').map((h) => h.id)).toContain(root.id)

    await node.setTeamConfig('memory.updateOnWrite', false)
    expect((await node.teamConfig()).updateOnWrite).toBe(false)
    const calls = writeCalls()
    await node.remember({ title: 'Deploy di venerdì: eccezioni', body: 'Il venerdì pomeriggio deploy solo per hotfix [aggiorna].', tags: ['deploy'] })
    expect(writeCalls()).toBe(calls)
    await expect(node.setTeamConfig('memory.updateOnWrite', 'sì')).rejects.toThrow(/true oppure false/)
  })
})
