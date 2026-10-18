/**
 * Radici nella UI (Fase 8): elenco per categoria con stato di revisione, revisione manuale,
 * suggerimenti promossi con la categoria scelta, "Rendi Radice" dal dettaglio di un ricordo.
 * fetch è finto: rispondiamo in base a metodo + URL e controlliamo cosa viene inviato al daemon.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTokenForTests } from '../api/auth'
import type { GraphNode, RecallHit, RootView } from '../api/client'
import { MemoryPanel } from '../components/MemoryPanel'
import { Roots } from '../pages/Roots'

const A = 'a'.repeat(64)
const hit = (id: string, title: string, extra: Partial<RecallHit> = {}): RecallHit =>
  ({ id, title, kind: 'decision', body: 'corpo', tags: [], author: A, authorName: 'alice', ts: 0, score: 0, activation: 0.8, votes: 0, uses: 0, pinned: false, ...extra }) as RecallHit
const root = (id: string, title: string, category: RootView['category'], status: 'ok' | 'review', reasons: string[] = []): RootView => ({
  id, category, by: A, ts: 0, reviewedAt: 0, reviewedBy: A, status,
  flags: reasons.map((reason) => ({ reason, refs: [], by: A, ts: 0 })),
  memory: hit(id, title, { root: { category, status }, source: { type: 'claude-code', code: { project: 'ordini', files: [], symbols: [], commits: [] } } }),
  byName: 'alice', reviewedByName: 'bruno'
})

/** fetch finto: "METODO /percorso" → risposta JSON. */
function mockFetch (routes: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`
    return new Response(JSON.stringify(routes[key] ?? { error: `non previsto: ${key}` }), { status: key in routes ? 200 : 404 })
  })
}
const wrap = (Comp: () => JSX.Element | null) => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter><Comp /></MemoryRouter></QueryClientProvider>
)
const sent = (m: ReturnType<typeof mockFetch>, method: string, url: string) => m.mock.calls.find(([u, i]) => u === url && (i?.method ?? 'GET') === method)

describe('Roots', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('raggruppa per categoria, evidenzia le Radici da rivedere, lancia la revisione', async () => {
    setTokenForTests('tok')
    const m = mockFetch({
      'GET /api/roots': [root('r1', 'Architettura a eventi', 'architecture', 'review', ['1 commit hanno modificato i file citati']), root('r2', 'Segreti nel vault', 'policy', 'ok')],
      'GET /api/roots/suggestions': [],
      'POST /api/roots/review': { checked: 2, flagged: [{ id: 'r1', title: 'Architettura a eventi', reasons: ['Contraddetta: ora chiamate sincrone'] }], notes: [{ code: 'missing-projects', params: { projects: ['fatture'] }, text: 'testo per la CLI' }] }
    })
    wrap(Roots)
    expect(await screen.findByText('Architettura a eventi')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Architettura' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Policy' })).toBeTruthy()
    expect(screen.getByText('1 da rivedere')).toBeTruthy()
    expect(screen.getByText('1 commit hanno modificato i file citati')).toBeTruthy()

    fireEvent.click(screen.getByText('Rivedi le Radici'))
    expect(await screen.findByText(/2 Radici esaminate, 1 da rivedere/)).toBeTruthy()
    expect(screen.getByText(/Contraddetta: ora chiamate sincrone/)).toBeTruthy()
    expect(screen.getByText(/progetti assenti da questo PC/)).toBeTruthy()
    expect(sent(m, 'POST', '/api/roots/review')).toBeTruthy()
  })

  it('suggerimento promosso con la categoria scelta', async () => {
    const m = mockFetch({
      'GET /api/roots': [],
      'GET /api/roots/suggestions': [{ id: 's1', category: 'architecture', title: 'Mappa dei servizi', created: 0 }],
      'POST /api/roots/s1': root('s1', 'Mappa dei servizi', 'network', 'ok')
    })
    wrap(Roots)
    expect(await screen.findByText('Mappa dei servizi')).toBeTruthy()
    fireEvent.change(screen.getByDisplayValue('Architettura'), { target: { value: 'network' } })
    fireEvent.click(screen.getByText('Rendi Radice'))
    await waitFor(() => expect(sent(m, 'POST', '/api/roots/s1')).toBeTruthy())
    expect(JSON.parse(sent(m, 'POST', '/api/roots/s1')![1]!.body as string)).toEqual({ category: 'network' })
  })
})

describe('MemoryPanel: Rendi Radice', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('un ricordo normale si promuove dal suo dettaglio', async () => {
    const node = { id: 'm1', title: 'Policy dei segreti', kind: 'reference', tags: [], author: A, authorName: 'alice', ts: 0 } as unknown as GraphNode
    const m = mockFetch({ 'GET /api/memories/m1': hit('m1', 'Policy dei segreti'), 'POST /api/roots/m1': root('m1', 'Policy dei segreti', 'policy', 'ok') })
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><MemoryPanel node={node} onClose={() => {}} /></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByText(/Rendilo una/)).toBeTruthy()
    fireEvent.change(screen.getByDisplayValue('Architettura'), { target: { value: 'policy' } })
    fireEvent.click(screen.getByText('Rendi Radice'))
    await waitFor(() => expect(sent(m, 'POST', '/api/roots/m1')).toBeTruthy())
    expect(JSON.parse(sent(m, 'POST', '/api/roots/m1')![1]!.body as string)).toEqual({ category: 'policy' })
  })
})
