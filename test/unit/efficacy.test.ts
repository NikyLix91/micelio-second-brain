// B11: efficacia. Cosa ha fornito Micelio in una trascrizione di Claude Code e se l'agente l'ha usato.
import { describe, expect, it } from 'vitest'
import { actionsAfter, distinctiveTokens, findDeliveries, judgeUse } from '../../src/insight/efficacy'

const A = 'aaaaaaaaaaaa'
const B = 'bbbbbbbbbbbb'

/** Righe di trascrizione già interpretate (come le restituisce parseLines). */
const rows = [
  { type: 'user', message: { content: 'Il build di Angular va in out of memory' } },
  { type: 'attachment', attachment: { type: 'hook_additional_context', hookEvent: 'UserPromptSubmit', content: ['Micelio — dalla memoria del team, forse pertinente:\n- [gotcha] Build Angular OOM (id:' + A + ')'] } },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__micelio__recall', input: { query: 'angular memoria' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '### Heap di Node in CI\n[howto] id:' + B + ' · ada' }] }] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'Imposto la memoria come indicato.' }, { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'export NODE_OPTIONS=--max-old-space-size=6144 && npm run build' } }] } },
  // un altro recall: non deve contare come "uso" (ripete la domanda)
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'mcp__micelio__recall', input: { query: 'NODE_OPTIONS max-old-space-size' } }] } },
  // sotto-agente: ignorato
  { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'pipeline.yml' }] } }
]

describe('cosa ha fornito Micelio', () => {
  it('contesto automatico e risultati dei tool MCP, con gli id abbreviati', () => {
    expect(findDeliveries(rows)).toEqual([
      { index: 1, channel: 'prompt', ids: [A] },
      { index: 3, channel: 'recall', ids: [B] }
    ])
  })

  it('le azioni successive escludono i tool di Micelio e i sotto-agenti', () => {
    const after = actionsAfter(rows, 3)
    expect(after).toContain('NODE_OPTIONS=--max-old-space-size=6144')
    expect(after).not.toContain('angular memoria')
    expect(after.match(/max-old-space-size/g)).toHaveLength(1) // non dal secondo recall
    expect(after).not.toContain('pipeline.yml')
  })
})

describe('l\'agente l\'ha usato? (euristica)', () => {
  const heap = { title: 'Heap di Node in CI', body: 'Sugli agent ospitati impostare `NODE_OPTIONS=--max-old-space-size=6144` nello step di build (file `azure-pipelines.yml`).' }

  it('elementi distintivi: testo fra backtick, file, identificatori; non le parole comuni', () => {
    const t = distinctiveTokens({ ...heap, source: { code: { files: ['ci/build.yml'], symbols: ['class BuildRunner'] } } })
    expect(t.slice(0, 2)).toEqual(['ci/build.yml', 'BuildRunner'])
    expect(t).toContain('NODE_OPTIONS=--max-old-space-size=6144')
    expect(t).toContain('azure-pipelines.yml')
    expect(t).not.toContain('build') // parola comune
    expect(distinctiveTokens({ title: 'Usa `npm install`', body: 'Poi `true`.' })).toEqual([])
  })

  it('un comando del ricordo eseguito dopo → probabilmente utile, con la prova', () => {
    expect(judgeUse(heap, actionsAfter(rows, 3))).toEqual({ verdict: 'likely', evidence: 'NODE_OPTIONS=--max-old-space-size=6144' })
  })

  it('percorsi confrontati senza badare a barre e maiuscole (Windows)', () => {
    const m = { title: 'Configurazione', body: 'I timeout stanno in `config/Gateway.yml`.' }
    expect(judgeUse(m, '{"file_path":"C:\\\\repo\\\\config\\\\gateway.yml"}').verdict).toBe('likely')
  })

  it('nessuna traccia → none; azioni vuote → none', () => {
    expect(judgeUse(heap, 'Ho aggiornato il README.')).toEqual({ verdict: 'none', evidence: null })
    expect(judgeUse(heap, '')).toEqual({ verdict: 'none', evidence: null })
  })
})
