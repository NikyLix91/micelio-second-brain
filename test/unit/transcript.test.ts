/** Lettura delle trascrizioni di Claude Code (src/ingest/transcript.ts). / EN: Reading Claude Code transcripts (src/ingest/transcript.ts). */
import { describe, expect, it } from 'vitest'
import { extractTranscript } from '../../src/ingest/transcript'
import { writeTranscript } from '../fixtures/transcript'
import { tmpHome } from '../helpers'

describe('extractTranscript', () => {
  const dir = tmpHome('transcript')

  it('tiene domande e risposte, riassume gli strumenti, esclude ragionamenti e sotto-agenti', () => {
    const file = writeTranscript(dir, 's1', [
      { user: 'La build va in out of memory' },
      { assistant: 'Controllo la pipeline.', thinking: 'PENSIERO INTERNO', tool: { name: 'Bash', input: { command: 'cat azure-pipelines.yml' }, result: 'steps: ...' } },
      { sidechain: 'messaggio di un sotto-agente' },
      { assistant: 'Imposta NODE_OPTIONS=--max-old-space-size=6144.' }
    ])
    const ex = extractTranscript(file)
    expect(ex.text).toContain('UTENTE: La build va in out of memory')
    expect(ex.text).toContain('ASSISTENTE: Imposta NODE_OPTIONS')
    expect(ex.text).toContain('[strumento Bash]')
    expect(ex.text).toContain('[esito strumento] steps: ...')
    expect(ex.text).not.toContain('PENSIERO INTERNO')
    expect(ex.text).not.toContain('sotto-agente')
    expect(ex.userTurns).toBe(1)
  })

  it('riparte dalla riga indicata: elabora solo la parte nuova di una sessione ripresa', () => {
    const file = writeTranscript(dir, 's2', [{ user: 'prima parte' }, { assistant: 'ok' }])
    const first = extractTranscript(file)
    writeTranscript(dir, 's2', [{ user: 'seconda parte' }], true)
    const second = extractTranscript(file, first.lines)
    expect(second.text).toContain('seconda parte')
    expect(second.text).not.toContain('prima parte')
    expect(second.lines).toBeGreaterThan(first.lines)
  })

  it('tronca le sessioni enormi tenendo inizio e fine', () => {
    const turns = Array.from({ length: 400 }, (_, i) => ({ user: `domanda ${i} ` + 'x'.repeat(200) }))
    const ex = extractTranscript(writeTranscript(dir, 's3', turns))
    expect(ex.text.length).toBeLessThan(41_000)
    expect(ex.text).toContain('domanda 0 ')
    expect(ex.text).toContain('domanda 399 ')
    expect(ex.text).toContain('parte centrale omessa')
  })
})
