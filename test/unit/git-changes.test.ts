/**
 * Distillazione consapevole delle modifiche (src/ingest/git-changes.ts):
 * - riconoscimento delle dichiarazioni (classi, funzioni, endpoint) nelle righe di un diff;
 * - riassunto di un repository git temporaneo con commit DATATI (dentro e fuori dal capitolo)
 *   e modifiche non committate;
 * - riferimenti al codice dei ricordi (source.code): progetto, remote senza credenziali, branch,
 *   file relativi, simboli, commit verificati;
 * - aggancio alla pipeline: il riassunto arriva al distillatore e i riferimenti ai ricordi pubblicati.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MemoryData } from '../../src/core/events'
import { cleanRemote, codeRefs, declarationOf, parseDiff, repoInfo, summarizeChanges } from '../../src/ingest/git-changes'
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
    const r = summarizeChanges(repo, since, until, false)!
    const s = r.text!
    expect(s).toContain('MODIFICHE AL CODICE')
    expect(s).toContain(`progetto "${path.basename(repo)}"`)
    expect(s).toContain('Commit nel periodo (2)')
    expect(s).toContain('"Aggiunge OrderService"')
    expect(s).toMatch(/src\/orders\/order\.service\.ts \(nuovo\): \+ class OrderService/)
    expect(s).toMatch(/orders\.controller\.ts \(nuovo\): \+ .*POST confirm/)
    expect(s).not.toContain('legacy.ts') // commit di due giorni prima: fuori dal capitolo
    expect(s).not.toContain('non ancora committate')
    // l'hash breve del commit è citabile nei ricordi; quelli completi servono a validarli
    const hash = git(repo, ['log', '-1', '--format=%H']).trim()
    expect(s).toContain(hash.slice(0, 8))
    expect(r.commits).toHaveLength(2)
    expect(r.commits[0]).toBe(hash)
    expect(r.files.sort()).toEqual(['src/orders/order.service.ts', 'src/orders/orders.controller.ts'])
  })

  it('include il lavoro non committato (anche i file nuovi) se richiesto', () => {
    const { repo, since, until } = makeRepo()
    fs.writeFileSync(path.join(repo, 'src/legacy.ts'), 'export function vecchiaFunzione () {}\nexport function rifattorizzata () {}\n')
    fs.writeFileSync(path.join(repo, 'src/nuovo.ts'), 'export class NonAncoraCommittato {}\n')
    const s = summarizeChanges(repo, since, until, true)!.text!
    expect(s).toContain('Modifiche non ancora committate')
    expect(s).toMatch(/src\/legacy\.ts \(modificato\): \+ rifattorizzata/)
    expect(s).toContain('src/nuovo.ts (nuovo)')
  })

  it('nessuna modifica nel periodo → testo null; cartella non git → null', () => {
    const { repo } = makeRepo()
    const r = summarizeChanges(repo, Date.now() - 10 * 24 * HOUR, Date.now() - 9 * 24 * HOUR, true)!
    expect(r.text).toBeNull()
    expect(r.info.project).toBe(path.basename(repo))
    expect(summarizeChanges(tmpHome('nogit'), 0, Date.now(), true)).toBeNull()
  })
})

describe('riferimenti al codice (source.code)', () => {
  it('repoInfo: progetto, branch e remote SENZA credenziali', () => {
    const { repo } = makeRepo()
    git(repo, ['remote', 'add', 'origin', 'https://mario:segreto123@dev.azure.com/org/prj/_git/ordini'])
    const info = repoInfo(repo)!
    expect(info.project).toBe(path.basename(repo))
    expect(info.repo).toBe('https://dev.azure.com/org/prj/_git/ordini')
    expect(info.branch).toBe(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim())
    expect(cleanRemote('git@github.com:org/ordini.git')).toBe('git@github.com:org/ordini.git')
    expect(repoInfo(tmpHome('nogit'))).toBeNull()
  })

  it('codeRefs: commit verificati e completati, percorsi relativi, assoluti esterni scartati', () => {
    const { repo, since, until } = makeRepo()
    const summary = summarizeChanges(repo, since, until, false)!
    const full = summary.commits[1] // commit "Aggiunge OrderService"
    const refs = codeRefs({
      files: [path.join(repo, 'src', 'orders', 'order.service.ts'), './src/orders/orders.controller.ts', 'C:/Users/mario/altro/segreto.ts', 'src\\orders\\order.service.ts'],
      symbols: ['class OrderService', ' POST confirm '],
      commits: [full.slice(0, 8), 'deadbeef12'] // il secondo non esiste: inventato dal modello
    }, repo, summary.info, summary)!
    expect(refs.project).toBe(path.basename(repo))
    expect(refs.files).toEqual(['src/orders/order.service.ts', 'src/orders/orders.controller.ts'])
    expect(refs.symbols).toEqual(['class OrderService', 'POST confirm'])
    expect(refs.commits).toEqual([full])
  })

  it('fuori da un repository: solo il nome della cartella come progetto, nessun commit', () => {
    const dir = path.join(tmpHome('plain'), 'gestionale')
    const refs = codeRefs({ files: ['docs/note.md'], commits: ['abcdef12'] }, dir, null, null)!
    expect(refs).toEqual({ project: 'gestionale', files: ['docs/note.md'], symbols: [], commits: [] })
  })
})

describe('pipeline: modifiche al distillatore e riferimenti ai ricordi', () => {
  const longTech = 'Abbiamo spostato la conferma degli ordini fuori dai controller per evitare duplicazioni. '.repeat(6)

  /** Pipeline minima su un repository di prova; `gitChanges` riflette l'opzione `watch.gitChanges`. */
  const run = async (gitChanges: boolean) => {
    const { repo, since } = makeRepo()
    const hash = git(repo, ['log', '-1', '--format=%H', '--skip=1']).trim() // "Aggiunge OrderService"
    const store = new PrivateStore(':memory:')
    const fake = new FakeAdapter()
    const published: MemoryData[] = []
    const p = new IngestPipeline({
      store,
      llm: new LlmRunner(fake, store, { dailyBudget: () => 100 }),
      models: () => ({ classify: 'haiku', distill: 'sonnet' }),
      publish: async (m) => { published.push(m); return { id: 'x', duplicate: false } },
      rules: async () => mergeRules([]),
      blockedPaths: async () => mergeBlockedPaths([]),
      language: async () => 'it',
      gitChanges: () => gitChanges,
      log: () => {}
    })
    // Trascrizione con timestamp a partire da `since`: la conversazione copre il primo commit,
    // che cade un minuto dopo. Il finto distillatore legge i riferimenti dopo "rif:".
    const transcriptPath = writeTranscript(tmpHome('tr'), 's1', [
      { user: 'Centralizziamo la conferma degli ordini. ' + longTech },
      { assistant: `LEZIONE: OrderService centralizza la conferma | Introdotto in src/orders. | rif: src/orders/order.service.ts, class OrderService, ${hash.slice(0, 8)}` }
    ], false, repo, since)
    p.enqueueSession({ sessionId: 's1', transcriptPath, cwd: repo })
    await p.tick()
    return { input: fake.calls.find((c) => c.name === 'distill')!.input, published, hash, repo }
  }

  it('opzione attiva: il materiale contiene MODIFICHE AL CODICE e il ricordo i riferimenti verificati', async () => {
    const { input, published, hash, repo } = await run(true)
    expect(input).toContain('Centralizziamo la conferma')
    expect(input).toContain('MODIFICHE AL CODICE')
    expect(input).toContain('class OrderService')
    expect(published).toHaveLength(1)
    expect(published[0].source.code).toMatchObject({
      project: path.basename(repo), files: ['src/orders/order.service.ts'], symbols: ['class OrderService'], commits: [hash]
    })
  })

  it('opzione disattivata: solo la conversazione; i commit non sono verificabili e vengono scartati', async () => {
    const { input, published, repo } = await run(false)
    expect(input).not.toContain('MODIFICHE AL CODICE')
    expect(published[0].source.code).toMatchObject({ project: path.basename(repo), files: ['src/orders/order.service.ts'], commits: [] })
  })
})
