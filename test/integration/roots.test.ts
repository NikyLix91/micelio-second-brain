// Radici (Fase 8) su due nodi veri: promozione replicata, filtri (progetto, categoria, file,
// testo), "Radici pertinenti" in coda alle ricerche, marcatura nel grafo, conferma e rimozione,
// revisione manuale (codice cambiato, contraddizione) con segnalazione replicata.
// EN: Roots (Phase 8) on two real nodes: replicated promotion, filters (project, category, file,
//     text), "related Roots" appended to searches, marking in the graph, confirm and removal,
//     manual review (changed code, contradiction) with a replicated flag.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MicelioNode } from '../../src/node/micelio-node'
import { ROOT_FLOOR } from '../../src/rank/activation'
import { eventually, localDht, makeNode, published, tmpHome } from '../helpers'

describe('Radici fra due nodi', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  const nodes: MicelioNode[] = []
  let alice: MicelioNode, bruno: MicelioNode
  let arch: string, sec: string, gotcha: string

  beforeAll(async () => {
    dht = await localDht()
    alice = makeNode('roots-alice', dht.bootstrap).node
    bruno = makeNode('roots-bruno', dht.bootstrap).node
    nodes.push(alice, bruno)
    await Promise.all(nodes.map((n) => n.start()))
    await alice.init('Team Radici', 'alice')
    await bruno.join((await alice.invite()).code, 'bruno')

    // Una Radice di progetto (con riferimenti al codice), una generale, un ricordo normale
    // EN: A project Root (with code references), a general one, a normal memory
    arch = published(await alice.remember({
      kind: 'decision',
      title: 'Architettura a eventi del gestionale ordini',
      body: 'Ogni servizio pubblica eventi di dominio sul bus; nessuna chiamata sincrona fra servizi.',
      tags: ['architettura'],
      source: { type: 'claude-code', code: { project: 'ordini', files: ['src/orders/'], symbols: [], commits: [] } }
    })).id
    sec = published(await alice.remember({ kind: 'reference', title: 'Policy di sicurezza: segreti fuori dal codice', body: 'I segreti stanno nel vault aziendale, mai nei repository.' })).id
    gotcha = published(await alice.remember({ kind: 'gotcha', title: 'Timeout del bus eventi in sviluppo', body: 'In locale il bus risponde lento al primo avvio.' })).id
    await eventually(() => bruno.recall('architettura').length >= 1, nodes)
  })

  afterAll(async () => {
    await Promise.all(nodes.map((n) => n.stop().catch(() => {})))
    await dht?.destroy()
  })

  it('team nuovo: solo gli admin creano Radici, anche contro un client modificato (0.6.2)', async () => {
    expect((await alice.teamConfig()).rootsAdminOnly).toBe(true)
    await expect(bruno.rootSet(arch, 'architecture')).rejects.toThrow(/solo gli admin creano e tolgono le Radici/)
    // Un client modificato che scrive comunque l'evento: ogni nodo lo scarta
    // EN: A modified client that writes the event anyway: every node drops it
    await (bruno as any).team.append({ type: 'root.set', id: arch, category: 'architecture' })
    // un voto subito dopo fa da segnale: quando alice lo vede, ha applicato anche il root.set
    // EN: a vote right after acts as a marker: when alice sees it, she has applied the root.set too
    await bruno.vote(arch, 1)
    await eventually(() => alice.detail(arch)?.votes === 1, nodes)
    expect(await alice.roots()).toEqual([])
    expect(await bruno.roots()).toEqual([])
    // Un membro non può nemmeno cambiare l'impostazione
    // EN: A member can't even change the setting
    await expect(bruno.setTeamConfig('roots.adminOnly', false)).rejects.toThrow(/riservata agli admin/)
    await expect(alice.setTeamConfig('roots.adminOnly', 'no')).rejects.toThrow(/true oppure false/)
  })

  it('con la regola spenta dall\'admin chiunque può promuovere: la Radice di bruno arriva ad alice', async () => {
    await alice.setTeamConfig('roots.adminOnly', false)
    await eventually(async () => !(await bruno.teamConfig()).rootsAdminOnly, nodes)
    await bruno.rootSet(arch, 'architecture')
    await bruno.rootSet(sec, 'policy')
    await eventually(async () => (await alice.roots()).length === 2, nodes)
    const r = (await alice.roots()).find((x) => x.id === arch)!
    expect(r).toMatchObject({ category: 'architecture', status: 'ok', byName: 'bruno' })
    expect(r.memory.root).toEqual({ category: 'architecture', status: 'ok' })
    expect(r.memory.activation).toBeGreaterThanOrEqual(ROOT_FLOOR)
  })

  it('filtri: progetto, categoria, file (anche per cartella)', async () => {
    expect((await alice.roots({ project: 'ordini' })).map((r) => r.id)).toEqual([arch])
    expect((await alice.roots({ category: 'policy' })).map((r) => r.id)).toEqual([sec])
    expect((await alice.roots({ files: ['src/orders/order.service.ts'] })).map((r) => r.id)).toEqual([arch])
    expect(await alice.roots({ files: ['src/billing/x.ts'] })).toEqual([])
  })

  it('Radici pertinenti: arrivano anche se non sono fra i risultati, mai doppie', async () => {
    // Con un solo risultato la Radice può essere fuori: deve arrivare comunque, e mai due volte.
    // EN: With a single result the Root may be left out: it must arrive anyway, and never twice.
    for (const q of ['timeout bus eventi', 'eventi di dominio sul bus']) {
      const hits = (await alice.recallHybrid(q, 1)).map((h) => h.id)
      const related = (await alice.relatedRoots(q, hits)).map((h) => h.id)
      expect([...hits, ...related]).toContain(arch)
      expect(related.filter((id) => hits.includes(id))).toEqual([])
    }
    // Nessuna Radice pertinente a un argomento estraneo
    // EN: No Root related to an unrelated topic
    expect(await alice.relatedRoots('zzz qwerty', [])).toEqual([])
  })

  it('il grafo marca le Radici', () => {
    const g = alice.graph()
    expect(g.nodes.find((n) => n.id === arch)?.root).toEqual({ category: 'architecture', status: 'ok' })
    expect(g.nodes.find((n) => n.id === gotcha)?.root).toBeUndefined()
  })

  it('rimozione e conferma', async () => {
    await alice.rootUnset(sec)
    await eventually(async () => (await bruno.roots()).length === 1, nodes)
    const c = await alice.rootConfirm(arch)
    expect(c.status).toBe('ok')
    await expect(alice.rootConfirm(gotcha)).rejects.toThrow(/non è una Radice/)
  })

  it('revisione manuale: codice cambiato e ricordo recente che la contraddice → "da rivedere" per tutti', async () => {
    // Il repository del progetto "ordini" sta in una cartella abilitata su questo PC
    // EN: The repository of the "ordini" project is in an enabled folder on this PC
    const parent = tmpHome('progetti')
    const repo = path.join(parent, 'ordini')
    fs.mkdirSync(path.join(repo, 'src', 'orders'), { recursive: true })
    const git = (args: string[], at?: number) => spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: repo, env: { ...process.env, ...(at ? { GIT_AUTHOR_DATE: new Date(at).toISOString(), GIT_COMMITTER_DATE: new Date(at).toISOString() } : {}) }
    })
    git(['init', '-q'])
    fs.writeFileSync(path.join(repo, 'src', 'orders', 'order.service.ts'), 'export class OrderService {}\n')
    git(['add', '-A'])
    git(['commit', '-q', '-m', 'OrderService chiama i pagamenti in modo sincrono'], Date.now() + 60_000) // dopo la revisione / EN: after the review
    alice.watchAdd(parent)

    // Un collega scrive un ricordo che contraddice la Radice
    // EN: A colleague writes a memory that contradicts the Root
    await bruno.remember({ kind: 'decision', title: 'Gestionale ordini: chiamate sincrone fra servizi', body: 'Il gestionale ordini ora usa chiamate sincrone fra servizi al posto degli eventi di dominio sul bus. [contraddice]' })
    await eventually(() => alice.recall('chiamate sincrone').length === 1, nodes)

    // Gli embedding si calcolano in background: si riprova finché anche la contraddizione è trovata
    // EN: Embeddings are computed in the background: retry until the contradiction is found too
    let result = await alice.rootReview()
    await eventually(async () => {
      result = await alice.rootReview()
      return (result.flagged.find((f) => f.id === arch)?.reasons.length ?? 0) >= 2
    }, nodes)
    const reasons = result.flagged.find((f) => f.id === arch)!.reasons
    expect(reasons.some((r) => /1 commit hanno modificato i file citati/.test(r))).toBe(true)
    expect(reasons.some((r) => /^Contraddetta/.test(r))).toBe(true)

    // La segnalazione arriva a tutti; la conferma la azzera
    // EN: The flag reaches everyone; confirming clears it
    await eventually(async () => (await bruno.roots()).find((r) => r.id === arch)?.status === 'review', nodes)
    await bruno.rootConfirm(arch)
    await eventually(async () => (await alice.roots()).find((r) => r.id === arch)?.status === 'ok', nodes)
  })
})
