/**
 * Qualità del sapere (B4):
 * - aggiornare invece di aggiungere: la decisione dell'LLM viene resa sicura (target valido,
 *   niente sostituzione di ricordi protetti);
 * - ricordi che invecchiano con il codice: commit successivi sui file citati e file spariti, da un
 *   repository git temporaneo con commit DATATI; riduzione dell'attivazione.
 *
 * EN: Knowledge quality (B4):
 * - update instead of add: the LLM decision is made safe (valid target, no replacement of
 *   protected memories);
 * - memories that age with the code: later commits on the cited files and vanished files, from a
 *   temporary git repository with DATED commits; activation reduction.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RecallHit } from '../../src/core/model'
import { repoInfo } from '../../src/ingest/git-changes'
import { checkDecision, type WriteCandidate, writeUpdateInput } from '../../src/ingest/write-update'
import { computeStaleness, stalenessFactor } from '../../src/rank/code-staleness'
import { tmpHome } from '../helpers'

const DAY = 24 * 3600_000
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const hit = (id: string, extra: Partial<RecallHit> = {}): RecallHit =>
  ({ id, kind: 'fact', title: `Ricordo ${id.slice(0, 1)}`, body: 'corpo', tags: [], author: A, authorName: 'ada', ts: 0, score: 0, ...extra }) as RecallHit

/** git nel repository di prova; `at` = data del commit. / EN: git in the test repository; `at` = commit date. */
function git (cwd: string, args: string[], at?: number): void {
  const date = at !== undefined ? new Date(at).toISOString() : undefined
  const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) }
  })
  if (r.status !== 0) throw new Error(r.stderr)
}
function commit (repo: string, file: string, content: string, at: number): void {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), content)
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', `modifica ${file}`], at)
}

describe('aggiornare invece di aggiungere', () => {
  const candidates: WriteCandidate[] = [
    { hit: hit(A), score: 0.9, protected: false },
    { hit: hit(B), score: 0.88, protected: true }
  ]
  const merged = { kind: 'fact' as const, title: 'Versione aggiornata', body: 'testo', tags: [] }

  it('accetta un aggiornamento valido e un duplicato', () => {
    expect(checkDecision({ action: 'update', target: A, merged, reason: 'r' }, candidates).action).toBe('update')
    expect(checkDecision({ action: 'duplicate', target: B, reason: 'r' }, candidates).action).toBe('duplicate')
  })

  it('non sostituisce mai un ricordo protetto (Radice o fissato), né uno inventato', () => {
    expect(checkDecision({ action: 'update', target: B, merged, reason: 'r' }, candidates)).toMatchObject({ action: 'new' })
    expect(checkDecision({ action: 'update', target: 'c'.repeat(64), merged, reason: 'r' }, candidates)).toMatchObject({ action: 'new' })
    expect(checkDecision({ action: 'update', target: A, reason: 'senza versione' }, candidates)).toMatchObject({ action: 'new' })
  })

  it('all\'LLM arrivano gli id completi e i protetti marcati', () => {
    const input = writeUpdateInput({ kind: 'fact', title: 'Nuovo', body: 'x', tags: [], source: { type: 'api' } }, candidates)
    expect(input).toContain(`[${A}] fact · Ricordo a`)
    expect(input).toContain(`[${B}] [PROTETTO]`)
  })
})

describe('ricordi che invecchiano con il codice', () => {
  it('conta i commit dopo il ricordo sui file citati e i file spariti', () => {
    const repo = tmpHome('stale-repo')
    git(repo, ['init', '-q'])
    const t0 = Date.now() - 30 * DAY
    commit(repo, 'src/orders/order.service.ts', 'v1', t0)
    commit(repo, 'src/other.ts', 'x', t0 + DAY)
    const memTs = t0 + 2 * DAY
    // dopo il ricordo: 2 commit sul file citato, 1 su un altro file, poi un file citato rimosso
    // EN: after the memory: 2 commits on the cited file, 1 on another file, then a cited file removed
    commit(repo, 'src/orders/order.service.ts', 'v2', memTs + DAY)
    commit(repo, 'src/other.ts', 'y', memTs + 2 * DAY)
    commit(repo, 'src/orders/order.service.ts', 'v3', memTs + 3 * DAY)
    commit(repo, 'src/legacy.ts', 'z', t0)
    fs.rmSync(path.join(repo, 'src/legacy.ts'))
    git(repo, ['commit', '-qam', 'rimosso legacy'], memTs + 4 * DAY)

    const info = repoInfo(repo)!
    const code = (files: string[]) => ({ project: info.project, files, symbols: [], commits: [] })
    const mems = [
      hit(A, { ts: memTs, source: { type: 'claude-code', code: code(['src/orders/order.service.ts', 'src/legacy.ts']) } }),
      hit(B, { ts: memTs + 10 * DAY, source: { type: 'claude-code', code: code(['src/orders/order.service.ts']) } }),
      hit('c'.repeat(64), { ts: memTs, source: { type: 'claude-code', code: { project: 'altro-progetto', files: ['x.ts'], symbols: [], commits: [] } } })
    ]
    const r = computeStaleness(mems, [info])
    expect(r.get(A)).toEqual({ commits: 3, missing: 1 }) // 2 sul service + la rimozione di legacy / EN: 2 on the service + the removal of legacy
    expect(r.get(B)).toEqual({ commits: 0, missing: 0 }) // scritto dopo tutte le modifiche / EN: written after all the changes
    expect(r.has('c'.repeat(64))).toBe(false) // repository non presente su questo PC / EN: repository not present on this PC
    fs.rmSync(repo, { recursive: true, force: true })
  })

  it('riduce l\'attivazione, ma non sotto la metà', () => {
    expect(stalenessFactor(undefined)).toBe(1)
    expect(stalenessFactor({ commits: 2, missing: 0 })).toBeCloseTo(0.9)
    expect(stalenessFactor({ commits: 30, missing: 3 })).toBe(0.5)
  })
})
