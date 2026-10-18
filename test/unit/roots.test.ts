/**
 * Radici (Fase 8), parte deterministica:
 * - apply: promozione, categoria, segnalazioni (senza doppioni), conferma, rimozione; le Radici
 *   non si fondono e non si archiviano;
 * - attivazione: mai sotto ROOT_FLOOR;
 * - dreaming: le Radici sono escluse da fusioni e decadimento;
 * - revisione: repository locali, commit successivi alla revisione, file scomparsi, documenti.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { envelope, memoryId, type EventPayload } from '../../src/core/events'
import type { RecallHit, RootRecord } from '../../src/core/model'
import { decayCandidates, duplicateGroups } from '../../src/dream/dreamer'
import { applyNodes, KEYS } from '../../src/net/apply'
import { activation, ROOT_FLOOR } from '../../src/rank/activation'
import { codeFindings, documentFinding, findRepo, localRepos } from '../../src/roots/review'
import { tmpHome } from '../helpers'

/** Vista finta in memoria con l'interfaccia minima di Hyperbee usata da apply. */
function fakeView () {
  const data = new Map<string, unknown>()
  return {
    data,
    async get (k: string) { return data.has(k) ? { key: k, value: structuredClone(data.get(k)) } : null },
    async put (k: string, v: unknown) { data.set(k, structuredClone(v)) },
    async del (k: string) { data.delete(k) }
  }
}
const host = { async addWriter () {}, async removeWriter () {}, removeable: () => true }

const A = 'a'.repeat(64)
const node = (payload: EventPayload, ts = 1000) => ({ from: { key: Buffer.from(A, 'hex') }, value: envelope(payload, ts) })
const MEM = { kind: 'decision' as const, title: 'Architettura a eventi per gli ordini', body: 'Ogni servizio pubblica eventi di dominio sul bus.', tags: [], source: { type: 'cli' } }
const ID = memoryId(MEM)
const OTHER = { kind: 'decision' as const, title: 'Architettura a eventi (copia)', body: 'Ogni servizio pubblica eventi.', tags: [], source: { type: 'cli' } }

/** Team con un ricordo, poi gli eventi indicati. */
async function run (...events: ReturnType<typeof node>[]) {
  const view = fakeView()
  await applyNodes([node({ type: 'team.init', name: 'T', founderName: 'alice' }), node({ type: 'memory.add', memory: MEM }), ...events], view, host)
  return { view, root: () => view.data.get(KEYS.root(ID)) as RootRecord | undefined }
}

describe('apply: Radici', () => {
  it('root.set promuove un ricordo esistente; un secondo set cambia solo la categoria', async () => {
    const { root } = await run(node({ type: 'root.set', id: ID, category: 'architecture' }, 2000), node({ type: 'root.set', id: ID, category: 'domain' }, 3000))
    expect(root()).toMatchObject({ id: ID, category: 'domain', by: A, ts: 2000, reviewedAt: 2000, status: 'ok', flags: [] })
  })

  it('root.set su un ricordo inesistente non fa nulla', async () => {
    const { view } = await run(node({ type: 'root.set', id: 'f'.repeat(64), category: 'other' }))
    expect([...view.data.keys()].some((k) => k.startsWith('root/'))).toBe(false)
  })

  it('root.flag accumula segnalazioni senza doppioni; root.confirm le azzera e aggiorna la revisione', async () => {
    const flag = (reason: string, ts: number) => node({ type: 'root.flag', id: ID, reason, refs: ['abc1234'] }, ts)
    const { root, view } = await run(node({ type: 'root.set', id: ID, category: 'architecture' }, 2000), flag('codice cambiato', 3000), flag('codice cambiato', 3100), flag('contraddetta', 3200))
    expect(root()!.status).toBe('review')
    expect(root()!.flags.map((f) => f.reason)).toEqual(['codice cambiato', 'contraddetta'])
    await applyNodes([node({ type: 'root.confirm', id: ID }, 4000)], view, host)
    expect(root()).toMatchObject({ status: 'ok', flags: [], reviewedAt: 4000, reviewedBy: A })
  })

  it('root.unset la toglie', async () => {
    const { root } = await run(node({ type: 'root.set', id: ID, category: 'architecture' }), node({ type: 'root.unset', id: ID }))
    expect(root()).toBeUndefined()
  })

  it('una Radice non si fonde (supersede) e non si archivia', async () => {
    const { view } = await run(
      node({ type: 'root.set', id: ID, category: 'architecture' }),
      node({ type: 'memory.supersede', old: [ID], memory: OTHER, reason: 'fusione' }),
      node({ type: 'memory.archive', id: ID, reason: 'decadimento' })
    )
    expect((view.data.get(KEYS.memory(ID)) as any).status).toBe('active')
    expect(view.data.has(KEYS.memory(memoryId(OTHER)))).toBe(false)
  })
})

describe('attivazione e dreaming', () => {
  const OLD = Date.now() - 3 * 365 * 24 * 3600 * 1000 // tre anni senza usi
  const base = { kind: 'decision', createdAt: OLD, uses: 0, votes: 0, degree: 0, pinned: false }

  it('una Radice mai usata da anni resta almeno a ROOT_FLOOR; un ricordo normale decade', () => {
    expect(activation(base)).toBeLessThan(0.2)
    expect(activation({ ...base, root: true })).toBe(ROOT_FLOOR)
  })

  it('il dreaming esclude le Radici da fusioni e decadimento', () => {
    const hit = (id: string, root: boolean): RecallHit => ({ id, kind: 'fact', title: id, body: '', tags: [], author: A, authorName: null, ts: OLD, score: 0, activation: 0.05, ...(root ? { root: { category: 'architecture', status: 'ok' } } : {}) })
    const v = new Float32Array([1, 0])
    const vectors = new Map([['r', v], ['x', v], ['y', v]])
    const groups = duplicateGroups([hit('r', true), hit('x', false), hit('y', false)], vectors, 0.9)
    expect(groups.flat()).not.toContain('r')
    expect(decayCandidates([hit('r', true), hit('x', false)]).map((m) => m.id)).toEqual(['x'])
  })
})

// ═══════════════════════════════ Revisione (8.3) ═══════════════════════════════

describe('revisione: codice e documenti', () => {
  /** git nel repository di prova; `at` = data del commit. */
  const git = (cwd: string, args: string[], at?: number) => {
    const date = at !== undefined ? new Date(at).toISOString() : undefined
    const r = spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } })
    if (r.status !== 0) throw new Error(r.stderr)
    return r.stdout
  }
  const commit = (repo: string, file: string, text: string, at: number) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    fs.writeFileSync(path.join(repo, file), text)
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', `modifica ${file}`], at)
  }
  /** Cartella "progetti" con un repository "ordini" dentro (come chi abilita C:\progetti). */
  const setup = () => {
    const parent = tmpHome('progetti')
    const repo = path.join(parent, 'ordini')
    fs.mkdirSync(repo)
    git(repo, ['init', '-q'])
    git(repo, ['remote', 'add', 'origin', 'https://dev.azure.com/org/prj/_git/ordini'])
    return { parent, repo }
  }
  const HOUR = 3600_000
  const rootAt = (reviewedAt: number): RootRecord => ({ id: ID, category: 'architecture', by: A, ts: reviewedAt, reviewedAt, reviewedBy: A, status: 'ok', flags: [] })

  it('localRepos trova i repository nelle sotto-cartelle; findRepo per remote o per nome', () => {
    const { parent, repo } = setup()
    const repos = localRepos([parent])
    expect(repos.map((r) => r.project)).toEqual(['ordini'])
    expect(findRepo({ repo: 'https://dev.azure.com/org/prj/_git/ordini.git', files: [], symbols: [], commits: [] }, repos)?.root).toBe(repos[0].root)
    expect(findRepo({ project: 'ORDINI', files: [], symbols: [], commits: [] }, repos)).not.toBeNull()
    expect(findRepo({ project: 'fatture', files: [], symbols: [], commits: [] }, repos)).toBeNull()
    expect(fs.existsSync(repo)).toBe(true)
  })

  it('codeFindings: solo i commit DOPO la revisione sui file citati, e i file scomparsi', () => {
    const { repo } = setup()
    const now = Date.now()
    commit(repo, 'src/orders/a.ts', 'v1', now - 5 * HOUR) // prima della revisione: non conta
    commit(repo, 'src/billing/b.ts', 'x', now - HOUR) // dopo, ma su un altro file: non conta
    const [info] = localRepos([repo])
    const code = { project: 'ordini', files: ['src/orders/', 'src/gone.ts'], symbols: [], commits: [] }
    let f = codeFindings(rootAt(now - 2 * HOUR), code, info)
    expect(f.map((x) => x.reason)).toEqual(['File citati non più presenti: src/gone.ts'])

    commit(repo, 'src/orders/a.ts', 'v2', now - HOUR / 2) // dopo la revisione, su un file citato
    f = codeFindings(rootAt(now - 2 * HOUR), code, info)
    expect(f[0].reason).toMatch(/^1 commit hanno modificato i file citati/)
    expect(f[0].refs).toHaveLength(1)
  })

  it('documentFinding: documento proprio modificato o rimosso; altrui o invariato → nulla', () => {
    const mem = { id: ID, source: { type: 'document', ref: 'h1', name: 'architettura.pdf' } } as unknown as RecallHit
    const doc = (hash: string, status: 'done' | 'removed') => ({ path: `C:/docs/${'architettura.pdf'}`, hash, size: 1, folder: 'C:/docs', status, chunksDone: 1, memories: 1, updated: 0 })
    expect(documentFinding(rootAt(0), mem, [doc('h1', 'done')])).toBeNull()
    expect(documentFinding(rootAt(0), mem, [])).toBeNull()
    expect(documentFinding(rootAt(0), mem, [doc('h2', 'done')])?.reason).toMatch(/modificato/)
    expect(documentFinding(rootAt(0), mem, [doc('h1', 'removed')])?.reason).toMatch(/rimosso/)
  })
})
