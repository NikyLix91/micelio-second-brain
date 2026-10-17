/**
 * Distillazione consapevole delle modifiche (src/ingest/git-changes.ts):
 * - riconoscimento delle dichiarazioni (classi, funzioni, endpoint) nelle righe di un diff;
 * - riassunto di un repository git temporaneo con commit DATATI (dentro e fuori dal capitolo)
 *   e modifiche non committate;
 * - aggancio alla pipeline: il riassunto arriva al distillatore in coda alla conversazione.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { declarationOf, parseDiff, summarizeChanges } from '../../src/ingest/git-changes'
import { IngestPipeline } from '../../src/ingest/pipeline'
import { FakeAdapter } from '../../src/llm/fake'
import { LlmRunner } from '../../src/llm/runner'
import { mergeRules } from '../../src/privacy/filter'
import { mergeBlockedPaths } from '../../src/privacy/paths'
import { PrivateStore } from '../../src/store/private-store'
import { writeTranscript } from '../fixtures/transcript'
import { tmpHome } from '../helpers'

const HOUR = 3600_000

/** Esegue git nel repository di prova; `at` imposta la data del commit (autore e committer). */
function git (cwd: string, args: string[], at?: number): string {
  const date = at !== undefined ? new Date(at).toISOString() : undefined
  const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) }
  })
  if (r.status !== 0) throw new Error(r.stderr)
  return r.stdout
}

/** Scrive un file nel repo e lo committa alla data indicata. */
function commit (repo: string, file: string, content: string, message: string, at: number): void {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), content)
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', message], at)
}

/**
 * Repository con tre commit: uno VECCHIO (fuori dal capitolo) e due DENTRO l'intervallo
 * [now-2h, now-1h]. Restituisce il percorso e l'intervallo del capitolo.
 */
function makeRepo (): { repo: string, since: number, until: number } {
  const repo = tmpHome('git')
  git(repo, ['init', '-q'])
  const now = Date.now()
  commit(repo, 'src/legacy.ts', 'export function vecchiaFunzione () {}\n', 'Commit vecchio', now - 48 * HOUR)
  commit(repo, 'src/orders/order.service.ts', 'export class OrderService {\n  confirm () {}\n}\n', 'Aggiunge OrderService', now - 2 * HOUR + 60_000)
  commit(repo, 'src/orders/orders.controller.ts', "@Controller('orders')\nexport class OrdersController {\n  @Post('confirm')\n  confirm () {}\n}\n", 'Endpoint di conferma', now - HOUR - 60_000)
  return { repo, since: now - 2 * HOUR, until: now - HOUR }
}

describe('declarationOf / parseDiff', () => {
  it('riconosce classi, funzioni ed endpoint in più linguaggi', () => {
    expect(declarationOf('export class OrderService {')).toBe('class OrderService')
    expect(declarationOf('export async function confirmOrder (id: string) {')).toBe('confirmOrder')
    expect(declarationOf("  @Post('confirm')")).toBe('POST confirm')
    expect(declarationOf("router.get('/orders/:id', handler)")).toBe('GET /orders/:id')
    expect(declarationOf('public sealed class InvoiceService')).toBe('class InvoiceService')
    expect(declarationOf('    [HttpGet("{id}")]')).toBe('GET {id}')
    expect(declarationOf('def calcola_totale(ordine):')).toBe('def calcola_totale')
    expect(declarationOf('const x = 1')).toBeNull()
  })

  it('una dichiarazione solo spostata/riformattata non conta come aggiunta né rimozione', () => {
    const diff = [
      '+++ b/src/a.ts',
      '-export class A {',
      '+export class A {',
      '+export function nuova () {}',
      '-export function vecchia () {}'
    ].join('\n')
    const a = parseDiff(diff).get('src/a.ts')!
    expect([...a.added]).toEqual(['nuova'])
    expect([...a.removed]).toEqual(['vecchia'])
  })
})

describe('summarizeChanges', () => {
  it('riassume SOLO i commit del capitolo, con file, dichiarazioni ed hash', () => {
    const { repo, since, until } = makeRepo()
    const s = summarizeChanges(repo, since, until, false)!
    expect(s).toContain('MODIFICHE AL CODICE')
    expect(s).toContain('Commit nel periodo (2)')
    expect(s).toContain('"Aggiunge OrderService"')
    expect(s).toMatch(/src\/orders\/order\.service\.ts \(nuovo\): \+ class OrderService/)
    expect(s).toMatch(/orders\.controller\.ts \(nuovo\): \+ .*POST confirm/)
    expect(s).not.toContain('legacy.ts') // commit di due giorni prima: fuori dal capitolo
    expect(s).not.toContain('non ancora committate')
    // l'hash breve del commit è citabile nei ricordi
    const hash = git(repo, ['log', '-1', '--format=%H']).trim()
    expect(s).toContain(hash.slice(0, 8))
  })

  it('include il lavoro non committato (anche i file nuovi) se richiesto', () => {
    const { repo, since, until } = makeRepo()
    fs.writeFileSync(path.join(repo, 'src/legacy.ts'), 'export function vecchiaFunzione () {}\nexport function rifattorizzata () {}\n')
    fs.writeFileSync(path.join(repo, 'src/nuovo.ts'), 'export class NonAncoraCommittato {}\n')
    const s = summarizeChanges(repo, since, until, true)!
    expect(s).toContain('Modifiche non ancora committate')
    expect(s).toMatch(/src\/legacy\.ts \(modificato\): \+ rifattorizzata/)
    expect(s).toContain('src/nuovo.ts (nuovo)')
  })

  it('nessun commit nel periodo e niente in sospeso → null; cartella non git → null', () => {
    const { repo } = makeRepo()
    expect(summarizeChanges(repo, Date.now() - 10 * 24 * HOUR, Date.now() - 9 * 24 * HOUR, true)).toBeNull()
    expect(summarizeChanges(tmpHome('nogit'), 0, Date.now(), true)).toBeNull()
  })
})

describe('pipeline: il riassunto git arriva al distillatore', () => {
  const longTech = 'Abbiamo spostato la conferma degli ordini fuori dai controller per evitare duplicazioni. '.repeat(6)

  /** Pipeline minima; `gitChanges` riflette l'opzione `watch.gitChanges`. */
  const run = async (gitChanges: boolean) => {
    const { repo, since } = makeRepo()
    const store = new PrivateStore(':memory:')
    const fake = new FakeAdapter()
    const p = new IngestPipeline({
      store,
      llm: new LlmRunner(fake, store, { dailyBudget: () => 100 }),
      models: () => ({ classify: 'haiku', distill: 'sonnet' }),
      publish: async () => ({ id: 'x', duplicate: false }),
      rules: async () => mergeRules([]),
      blockedPaths: async () => mergeBlockedPaths([]),
      language: async () => 'it',
      gitChanges: () => gitChanges,
      log: () => {}
    })
    // Trascrizione con timestamp a partire da `since`: la conversazione copre il primo commit
    const transcriptPath = writeTranscript(tmpHome('tr'), 's1', [
      { user: 'Centralizziamo la conferma degli ordini. ' + longTech },
      { assistant: 'LEZIONE: OrderService centralizza la conferma | Introdotto in src/orders.' }
    ], false, repo, since) // il primo commit del capitolo cade un minuto dopo
    p.enqueueSession({ sessionId: 's1', transcriptPath, cwd: repo })
    await p.tick()
    return fake.calls.find((c) => c.name === 'distill')!.input
  }

  it('con l\'opzione attiva il materiale contiene la sezione MODIFICHE AL CODICE', async () => {
    const input = await run(true)
    expect(input).toContain('Centralizziamo la conferma')
    expect(input).toContain('MODIFICHE AL CODICE')
    expect(input).toContain('class OrderService')
  })

  it('con l\'opzione disattivata solo la conversazione', async () => {
    expect(await run(false)).not.toContain('MODIFICHE AL CODICE')
  })
})
