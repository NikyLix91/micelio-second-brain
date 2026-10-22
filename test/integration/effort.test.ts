// B12: un capitolo faticoso (errori, durata, tanti messaggi) dà ai ricordi che ne nascono la fatica
// in `source.effort` e un'attivazione più alta di un ricordo nato da un capitolo facile.
// EN: B12: a hard chapter (errors, duration, many messages) gives the memories born from it the
//     effort in `source.effort` and a higher activation than a memory born from an easy chapter.
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nodePaths } from '../../src/core/paths'
import { HashEmbedder } from '../../src/embed/embedder'
import { FakeAdapter } from '../../src/llm/fake'
import { MicelioHost } from '../../src/node/micelio-host'
import type { MicelioNode } from '../../src/node/micelio-node'
import { eventually, tmpHome } from '../helpers'

describe('scoperte sudate (B12)', () => {
  let host: MicelioHost
  let node: MicelioNode
  let project: string

  /** Trascrizione con `errors` strumenti falliti, `turns` messaggi e `minutes` di durata. / EN: Transcript with `errors` failed tools, `turns` messages and `minutes` of duration. */
  const transcript = (name: string, o: { errors: number, turns: number, minutes: number, lesson: string }) => {
    const t0 = Date.parse('2026-10-20T09:00:00Z')
    const at = (i: number, n: number) => new Date(t0 + (o.minutes * 60_000 * i) / Math.max(1, n)).toISOString()
    const rows: unknown[] = []
    const steps = Math.max(o.turns, o.errors)
    for (let i = 0; i < steps; i++) {
      if (i < o.turns) rows.push({ type: 'user', cwd: project, timestamp: at(i, steps), message: { content: `Tentativo ${i + 1}: la build del modulo pagamenti fallisce ancora con un errore di linking, riprova con un'altra configurazione.` } })
      rows.push({ type: 'assistant', timestamp: at(i, steps), message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: `npm run build -- --variant ${i}` } }] } })
      rows.push({ type: 'user', timestamp: at(i, steps), message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, is_error: i < o.errors, content: i < o.errors ? 'error: linking failed' : 'ok' }] } })
    }
    rows.push({ type: 'assistant', timestamp: at(steps, steps), message: { content: [{ type: 'text', text: `LEZIONE: ${o.lesson}` }] } })
    const file = path.join(tmpHome('effort-tr'), `${name}.jsonl`)
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    return file
  }

  beforeAll(async () => {
    host = new MicelioHost(nodePaths(tmpHome('effort')), { materializeDelayMs: 50, llm: new FakeAdapter(), embedder: new HashEmbedder() })
    await host.start()
    await host.createTeam('Pagamenti', 'ada', 'local')
    node = host.node()
    project = path.join(tmpHome('effort-prj'), 'pagamenti')
    fs.mkdirSync(project, { recursive: true })
    node.watchAdd(project)
  })

  afterAll(async () => { await host?.stop() })

  it('il capitolo faticoso lascia la fatica nel ricordo e un vantaggio nell\'attivazione', async () => {
    node.ingestSession({ sessionId: 'dura', transcriptPath: transcript('dura', { errors: 15, turns: 25, minutes: 120, lesson: 'Linking del modulo pagamenti | Serve la variante statica della libreria crypto, altrimenti il linker fallisce.' }), cwd: project })
    node.ingestSession({ sessionId: 'facile', transcriptPath: transcript('facile', { errors: 0, turns: 2, minutes: 5, lesson: 'Script di build dei pagamenti | Il modulo pagamenti si compila con npm run build dalla cartella del modulo.' }), cwd: project })
    await eventually(() => node.recent(10).filter((h) => h.source?.type === 'claude-code').length === 2, [node])
    const [hard] = node.recent(10).filter((h) => h.title.startsWith('Linking'))
    const [easy] = node.recent(10).filter((h) => h.title.startsWith('Script'))
    expect(hard.source?.effort).toEqual({ score: 1, errors: 15, minutes: 120 })
    expect(easy.source?.effort?.score).toBeLessThan(0.1)
    expect(node.detail(hard.id)!.activation! - node.detail(easy.id)!.activation!).toBeGreaterThan(0.12)
  })
})
