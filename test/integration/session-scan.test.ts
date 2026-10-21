/**
 * Sessione lunga in corso, raccolta a capitoli dal controllo periodico (senza hook di fine
 * sessione): ogni parte nuova viene distillata una sola volta.
 *
 * EN: Long session in progress, collected in chapters by the periodic check (no end-of-session
 * hook): each new part is distilled only once.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MicelioNode } from '../../src/node/micelio-node'
import { writeTranscript } from '../fixtures/transcript'
import { localDht, makeNode, tmpHome } from '../helpers'

describe('raccolta delle sessioni in corso', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  let node: MicelioNode
  const claudeDir = tmpHome('claude-config')
  const project = tmpHome('progetto-lungo')
  const transcripts = path.join(claudeDir, 'projects', 'C--progetto-lungo')
  const prev = process.env.CLAUDE_CONFIG_DIR

  /** Fa sembrare la trascrizione "in pausa" da 20 minuti. / EN: Makes the transcript look "paused" for 20 minutes. */
  const pause = (file: string) => { const t = new Date(Date.now() - 20 * 60_000); fs.utimesSync(file, t, t) }
  const chapter = (lesson: string) => [
    ...Array.from({ length: 4 }, (_, i) => ({ user: `passo ${i} del lavoro sul servizio ordini ` + 'x'.repeat(120) })),
    { assistant: `LEZIONE: ${lesson} | Verificato durante la sessione.` }
  ]

  beforeAll(async () => {
    process.env.CLAUDE_CONFIG_DIR = claudeDir
    fs.mkdirSync(transcripts, { recursive: true })
    dht = await localDht()
    node = makeNode('scan', dht.bootstrap).node
    await node.start()
    await node.init('Team Scan', 'scan')
    node.watchAdd(project)
  })

  afterAll(async () => {
    await node?.stop()
    await dht?.destroy()
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prev
  })

  it('primo capitolo di una sessione ancora aperta → ricordo nel team', async () => {
    const file = writeTranscript(transcripts, 'sessione-lunga', chapter('Primo capitolo concluso') as any, false, project)
    pause(file)
    expect(await node.scanSessions()).toBe(1)
    await node.processQueue()
    expect(node.recall('primo capitolo').length).toBe(1)
  })

  it('il giorno dopo la sessione continua: si distilla solo la parte nuova', async () => {
    const file = writeTranscript(transcripts, 'sessione-lunga', chapter('Secondo capitolo concluso') as any, true, project)
    pause(file)
    expect(await node.scanSessions()).toBe(1)
    await node.processQueue()
    expect(node.recall('secondo').map((h) => h.title)).toEqual(['Secondo capitolo concluso'])
    expect((await node.status()).memories).toBe(2) // il primo capitolo non è stato rielaborato / EN: the first chapter was not processed again
    expect(await node.scanSessions()).toBe(0) // niente di nuovo / EN: nothing new
  })
})
