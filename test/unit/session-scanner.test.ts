/**
 * Raccolta delle sessioni in corso e recupero di quelle perse (src/ingest/session-scanner.ts).
 * Le trascrizioni sono finte ma nel formato di Claude Code; l'età dei file si simula con utimes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { SessionScanner } from '../../src/ingest/session-scanner'
import { PrivateStore } from '../../src/store/private-store'
import { writeTranscript } from '../fixtures/transcript'
import { tmpHome } from '../helpers'

const MIN = 60_000
const NOW = Date.now()

describe('SessionScanner', () => {
  let projects: string
  let project: string
  let store: PrivateStore
  let scanner: SessionScanner
  const opts = () => ({ projectsDir: projects, watched: [project], idleMinutes: 10, minUserTurns: 4, minChars: 6000, staleHours: 6, now: NOW })

  /** Scrive una trascrizione nella cartella del "progetto" Claude con un'età simulata. */
  const session = (id: string, userTurns: number, ageMinutes: number, cwd = project, charsPerTurn = 200) => {
    const dir = path.join(projects, 'C--progetto')
    fs.mkdirSync(dir, { recursive: true })
    const turns = Array.from({ length: userTurns }, (_, i) => [{ user: `domanda ${i} ` + 'x'.repeat(charsPerTurn) }, { assistant: `risposta ${i}` }]).flat()
    const file = writeTranscript(dir, id, turns as any, false, cwd)
    const t = new Date(NOW - ageMinutes * MIN)
    fs.utimesSync(file, t, t)
    return file
  }

  beforeEach(() => {
    projects = tmpHome('claude-projects')
    project = tmpHome('progetto')
    store = new PrivateStore(':memory:')
    scanner = new SessionScanner(store)
  })

  it('prende una sessione in pausa con abbastanza contenuto nuovo', () => {
    session('pausa', 5, 15)
    expect(scanner.scan(opts()).map((c) => c.sessionId)).toEqual(['pausa'])
  })

  it('non tocca una sessione ancora attiva (scritta da poco)', () => {
    session('attiva', 10, 2)
    expect(scanner.scan(opts())).toEqual([])
  })

  it('aspetta più contenuto se la parte nuova è piccola, ma la prende se la sessione è abbandonata', () => {
    session('piccola', 2, 30)
    expect(scanner.scan(opts())).toEqual([])
    session('abbandonata', 2, 8 * 60)
    expect(scanner.scan(opts()).map((c) => c.sessionId)).toEqual(['abbandonata'])
  })

  it('ignora le sessioni avviate fuori dalle cartelle abilitate', () => {
    session('altrove', 6, 20, tmpHome('altro-progetto'))
    expect(scanner.scan(opts())).toEqual([])
  })

  it('niente di nuovo se le righe sono già state elaborate; di nuovo candidata quando la sessione cresce', () => {
    const file = session('lunga', 5, 20)
    expect(scanner.scan(opts())).toHaveLength(1)
    store.setSessionLines('lunga', fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length)
    expect(scanner.scan({ ...opts(), now: NOW + MIN })).toEqual([])
    // La sessione continua (giorni dopo): nuova parte matura
    session('lunga', 12, 15)
    expect(scanner.scan({ ...opts(), now: NOW + 2 * MIN }).map((c) => c.sessionId)).toEqual(['lunga'])
  })

  it('non accoda due volte una sessione con un lavoro già in coda', () => {
    session('in-coda', 5, 20)
    store.enqueue('session', { sessionId: 'in-coda', transcriptPath: 'x', cwd: project })
    expect(scanner.scan(opts())).toEqual([])
  })
})
