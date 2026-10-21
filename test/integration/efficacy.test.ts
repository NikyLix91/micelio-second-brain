// B11: efficacia con un nodo vero. Consultazioni registrate, esiti di una sessione di Claude Code
// (euristica e giudizio dell'LLM alla distillazione), pollice in su automatico, utilità per il team.
// EN: B11: efficacy with a real node. Recorded agent queries, outcomes of a Claude Code session
//     (heuristic and LLM judgment at distillation), automatic thumbs up, usefulness for the team.
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nodePaths } from '../../src/core/paths'
import { HashEmbedder } from '../../src/embed/embedder'
import { FakeAdapter } from '../../src/llm/fake'
import { MicelioHost } from '../../src/node/micelio-host'
import type { MicelioNode } from '../../src/node/micelio-node'
import { eventually, published, tmpHome } from '../helpers'

describe('efficacia di Micelio per gli agenti', () => {
  let host: MicelioHost
  let node: MicelioNode
  let project: string
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    const home = tmpHome('efficacy')
    host = new MicelioHost(nodePaths(home), { materializeDelayMs: 50, llm: new FakeAdapter(), embedder: new HashEmbedder() })
    await host.start()
    await host.createTeam('Ordini', 'ada', 'local')
    node = host.node()
    project = path.join(home, 'progetti', 'ordini')
    fs.mkdirSync(project, { recursive: true })
    node.watchAdd(project)
    ids.heap = published(await node.remember({ kind: 'howto', title: 'Heap di Node nelle pipeline', body: 'Sugli agent ospitati impostare `NODE_OPTIONS=--max-old-space-size=6144` prima della build.', tags: ['ci'] })).id
    ids.cache = published(await node.remember({ kind: 'howto', title: 'Pulire la cache di npm', body: 'Con errori di integrità: `npm cache clean --force` e poi reinstallare.', tags: ['npm'] })).id
    ids.port = published(await node.remember({ kind: 'fact', title: 'Porta del gateway di test', body: 'Il gateway di test ascolta sulla porta 8443 (`gateway-test.internal:8443`).', tags: ['gateway'] })).id
  })

  afterAll(async () => { await host?.stop() })

  it('ogni richiesta di un agente è registrata, con il tempo di risposta e senza segreti', () => {
    node.consulted('recall', 'come pulisco la cache di npm', [ids.cache], 12)
    node.consulted('prompt', 'deploy con token ghp_abcdefghijklmnopqrstuvwxyz0123456789', [], 3, { project: 'ordini', session: 's0' })
    const r = node.efficacyReport(1)
    expect(r.summary).toMatchObject({ consultations: 2, withResults: 1, byChannel: { recall: 1, prompt: 1 } })
    expect(r.consultations[0].query).not.toContain('ghp_') // redatto / EN: redacted
    expect(r.consultations[1].memories[0]).toMatchObject({ id: ids.cache, title: 'Pulire la cache di npm' })
  })

  it('a fine sessione: esiti per ricordo, pollice in su sul ricordo usato, utilità per il team', async () => {
    const short = (id: string) => id.slice(0, 12)
    const transcript = path.join(tmpHome('efficacy-tr'), 'sessione.jsonl')
    const lines = [
      { type: 'user', cwd: project, message: { content: 'La build di Angular in CI va in out of memory e npm segnala errori di integrità: sistemiamo entrambe le cose, poi verifichiamo la porta del gateway di test.' } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__micelio__recall', input: { query: 'build memoria npm gateway' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: `### Heap di Node nelle pipeline\n[howto] id:${short(ids.heap)}\n\n### Pulire la cache di npm\n[howto] id:${short(ids.cache)}\n\n### Porta del gateway di test\n[fact] id:${short(ids.port)}` }] } },
      // usa il comando del primo ricordo (euristica: probabilmente utile) e l'LLM lo conferma
      // EN: uses the first memory's command (heuristic: probably useful) and the LLM confirms it
      { type: 'assistant', message: { content: [{ type: 'text', text: `Imposto l'heap come da memoria del team. USATO ${short(ids.heap)}` }, { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'export NODE_OPTIONS=--max-old-space-size=6144 && npm run build' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'Build completata in 4 minuti.' }] } },
      // il secondo ricordo: esegue lo stesso comando (euristica: probabile) ma l'LLM dice "ignorato"
      // EN: the second memory: runs the same command (heuristic: likely) but the LLM says "ignored"
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npm cache clean --force' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: 'ok' }] } },
      // il terzo è sbagliato: la porta è cambiata
      // EN: the third is wrong: the port has changed
      { type: 'assistant', message: { content: [{ type: 'text', text: `La porta 8443 non risponde: ora è 9443. SBAGLIATO ${short(ids.port)}. LEZIONE: Porta del gateway di test cambiata | Il gateway di test ora ascolta sulla porta 9443, non più sulla 8443.` }] } },
      { type: 'user', message: { content: 'Perfetto, grazie: tutto risolto e verificato.' } }
    ]
    fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    expect(node.ingestSession({ sessionId: 'sessione-1', transcriptPath: transcript, cwd: project }).queued).toBe(true)

    await eventually(() => node.efficacyReport(1).outcomes.filter((o) => o.judge === 'llm').length === 3, [node])
    const byId = new Map(node.efficacyReport(1).outcomes.map((o) => [o.memory.id, o]))
    expect(byId.get(ids.heap)).toMatchObject({ verdict: 'used', judge: 'llm', project: 'ordini' })
    // l'LLM prevale sull'euristica (che aveva trovato il comando)
    // EN: the LLM wins over the heuristic (which had found the command)
    expect(byId.get(ids.cache)).toMatchObject({ verdict: 'ignored', judge: 'llm' })
    expect(byId.get(ids.port)).toMatchObject({ verdict: 'wrong', judge: 'llm' })

    // pollice in su automatico sul ricordo usato, e solo su quello
    // EN: automatic thumbs up on the used memory, and only on that one
    await eventually(() => byId.get(ids.heap) !== undefined && node.efficacyReport(1).outcomes.find((o) => o.memory.id === ids.heap)!.voted, [node])
    await node.sync()
    expect(node.detail(ids.heap)!.votes).toBe(1)
    expect(node.detail(ids.cache)!.votes ?? 0).toBe(0)

    // utilità pubblicata al team: "utile 1 volta"
    // EN: usefulness published to the team: "useful 1 time"
    await node.flushUseful()
    await eventually(() => node.efficacyReport(1).topUseful.some((m) => m.id === ids.heap && m.teamUseful === 1), [node])

    const r = node.efficacyReport(1)
    expect(r.summary).toMatchObject({ delivered: 3, useful: 1, confirmed: 1, wrong: 1, thumbsUp: 1 })
    expect(r.wrong.map((w) => w.id)).toEqual([ids.port])
    // solo le notifiche "utile" e "sbagliato" confermate dall'LLM
    // EN: only the "useful" and "wrong" notifications confirmed by the LLM
    expect(node.efficacyNotices(0).map((n) => n.verdict).sort()).toEqual(['used', 'wrong'])
    node.setEfficacyNotify(false)
    expect(node.efficacyNotices(0)).toEqual([])
  })

  it('a scala: registrare una consultazione costa poco, il resoconto resta rapido', () => {
    const memIds = Object.values(ids)
    const store = (node as any).privateStore
    const t0 = performance.now()
    for (let i = 0; i < 10_000; i++) node.consulted(i % 3 ? 'prompt' : 'recall', `domanda numero ${i % 400}`, i % 5 ? [memIds[i % 3]] : [], 5 + (i % 50), { project: `progetto${i % 4}`, session: `s${i % 300}` })
    const perConsultation = (performance.now() - t0) / 10_000
    for (let i = 0; i < 3_000; i++) store.setOutcome({ session: `s${i}`, memory: memIds[i % 3], verdict: i % 4 ? 'likely' : 'none', judge: 'heuristic', project: `progetto${i % 4}` })
    const t1 = performance.now()
    const r = node.efficacyReport(90)
    const report = performance.now() - t1
    expect(r.summary.consultations).toBeGreaterThanOrEqual(10_000)
    expect(perConsultation).toBeLessThan(2)
    expect(report).toBeLessThan(1000)
    console.log(`efficacia a scala: ${perConsultation.toFixed(3)} ms per consultazione, resoconto su 10 000 consultazioni e 3 000 esiti in ${report.toFixed(0)} ms`)
  })

  it('un voto dato a mano non viene mai sovrascritto dal pollice automatico', async () => {
    await node.vote(ids.cache, -1)
    const transcript = path.join(tmpHome('efficacy-tr2'), 'sessione2.jsonl')
    const short = ids.cache.slice(0, 12)
    const lines = [
      { type: 'user', cwd: project, message: { content: 'Di nuovo errori di integrità del pacchetto npm durante l\'installazione delle dipendenze del progetto ordini: proviamo a ripulire tutto per bene.' } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x1', name: 'mcp__micelio__get', input: { id: short } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x1', content: `### Pulire la cache di npm\n[howto] id:${short}` }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: `Seguo la procedura. USATO ${short}. LEZIONE: Reinstallare dopo la pulizia della cache | Dopo npm cache clean serve cancellare node_modules e reinstallare con npm ci.` }] } },
      { type: 'user', message: { content: 'Ok, funziona: risolto.' } }
    ]
    fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    node.ingestSession({ sessionId: 'sessione-2', transcriptPath: transcript, cwd: project })
    await eventually(() => node.efficacyReport(1).outcomes.some((o) => o.session === 'sessione-2' && o.memory.id === ids.cache && o.voted), [node])
    await node.sync()
    expect(node.detail(ids.cache)!.votes).toBe(-1) // resta il voto dato a mano / EN: the manual vote stays
  })
})
