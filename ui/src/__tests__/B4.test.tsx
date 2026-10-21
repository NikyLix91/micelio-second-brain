/**
 * Blocco B4 nella UI: ricordi personali (filtro, modulo, pannello), riepilogo e lacune, contesto
 * automatico nelle Impostazioni, file per gli agenti, team "solo per me".
 * fetch è finto: rispondiamo in base a metodo + URL e controlliamo cosa viene inviato al daemon.
 *
 * EN: Block B4 in the UI: personal memories (filter, form, panel), digest and knowledge gaps,
 * automatic context in Settings, agent files, "just for me" team.
 * fetch is fake: we respond based on method + URL and check what is sent to the daemon.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setTokenForTests } from '../api/auth'
import type { Digest, GapView, RecallHit } from '../api/client'
import { setCurrentTeam } from '../api/team'
import { MemoryPanel } from '../components/MemoryPanel'
import { RootsTools } from '../components/RootsTools'
import { Digest as DigestPage } from '../pages/Digest'
import { Memory } from '../pages/Memory'
import { Onboarding } from '../pages/Onboarding'
import { Settings } from '../pages/Settings'

const A = 'a'.repeat(64)
const hit = (id: string, title: string, extra: Partial<RecallHit> = {}): RecallHit =>
  ({ id, title, kind: 'fact', body: 'corpo', tags: [], author: A, authorName: 'ada', ts: 0, score: 0, activation: 0.5, votes: 0, uses: 0, pinned: false, ...extra }) as RecallHit

function mockFetch (routes: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`
    return new Response(JSON.stringify(routes[key] ?? { error: `non previsto: ${key}` }), { status: key in routes ? 200 : 404 })
  })
}
const wrap = (node: JSX.Element) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>)
const bodyOf = (m: ReturnType<typeof mockFetch>, method: string, url: string) => {
  const call = m.mock.calls.find(([u, i]) => u === url && (i?.method ?? 'GET') === method)
  return call ? JSON.parse(String(call[1]?.body ?? '{}')) : undefined
}

describe('B4 nella UI', () => {
  beforeEach(() => { setTokenForTests('tok'); setCurrentTeam(null) })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

  it('Memoria: filtro dei personali e salvataggio "solo per me"', async () => {
    const p = 'b'.repeat(64)
    const m = mockFetch({
      'GET /api/memories?limit=30': [hit(A, 'Del team')],
      'GET /api/personal': [hit(p, 'Solo mio', { personal: true })],
      'POST /api/memories': { id: 'c'.repeat(64), duplicate: false }
    })
    wrap(<Memory />)
    expect(await screen.findByText('Del team')).toBeTruthy()
    fireEvent.click(screen.getByText('🔒 Personali'))
    expect(await screen.findByText('Solo mio')).toBeTruthy()
    expect(screen.getByText('🔒 personale')).toBeTruthy()
    fireEvent.click(screen.getByText('Nuovo ricordo'))
    fireEvent.click(screen.getByLabelText(/Solo per me/))
    fireEvent.change(screen.getByPlaceholderText('Una riga autoesplicativa'), { target: { value: 'Mio alias' } })
    fireEvent.change(screen.getByPlaceholderText('Il cosa e soprattutto il perché'), { target: { value: 'alias gs=git status' } })
    fireEvent.click(screen.getByText('Salva per me'))
    await screen.findByText(/Salvato come ricordo personale/)
    expect(bodyOf(m, 'POST', '/api/memories')).toMatchObject({ title: 'Mio alias', personal: true })
  })

  it('pannello di un ricordo personale: condividi o cancella, niente voti; avviso di codice cambiato', async () => {
    const p = 'b'.repeat(64)
    const m = mockFetch({
      [`GET /api/memories/${p}`]: hit(p, 'Solo mio', { personal: true, stale: { commits: 3, missing: 1 } }),
      [`POST /api/personal/${p}/share`]: { outcome: 'team', id: p, duplicate: false, memory: {} }
    })
    wrap(<MemoryPanel node={{ id: p, title: 'Solo mio', kind: 'fact', tags: [], author: A, authorName: 'ada', ts: 0 }} onClose={() => {}} />)
    expect(await screen.findByText(/Il codice citato è cambiato dopo questo ricordo: 3 commit/)).toBeTruthy()
    expect(screen.queryByTitle('Utile')).toBeNull()
    fireEvent.click(screen.getByText('Condividi con il team'))
    fireEvent.click(screen.getByText('Sì, condividi (passa dal filtro)'))
    expect(await screen.findByText('Condiviso con il team.')).toBeTruthy()
    expect(m.mock.calls.some(([u, i]) => u === `/api/personal/${p}/share` && i?.method === 'POST')).toBe(true)
  })

  it('Riepilogo: la settimana, le lacune del team e le tue ricerche senza risposta', async () => {
    const digest: Digest = {
      from: 0, to: 1, memories: { added: 2, byKind: { gotcha: 2 }, byAuthor: [{ name: 'ada', count: 2 }], latest: [{ id: '1', title: 'Gotcha uno', detail: 'gotcha' }] },
      roots: { added: [], toReview: [{ id: '2', title: 'Radice vecchia', detail: 'policy' }] }, mostUsed: [], gaps: [], myMisses: 1, dreams: { count: 0, lastSummary: null }, stale: 0
    }
    const gap: GapView = { id: 'g'.repeat(64).replace(/g/g, 'e'), question: 'Come si fa il rollback?', by: A, ts: 0, askers: [A], askerNames: ['ada'], status: 'open', answer: { id: 'f'.repeat(64), title: 'Rollback del database' } }
    const m = mockFetch({
      'GET /api/digest?days=7': digest,
      'GET /api/gaps': [gap],
      'GET /api/gaps/mine': [{ key: 'chart helm', query: 'helm chart', count: 2, first: 0, last: 0, answer: null }],
      'POST /api/gaps/report': [gap],
      [`POST /api/gaps/${gap.id}/close`]: []
    })
    wrap(<DigestPage />)
    expect(await screen.findByText('2 ricordi nuovi')).toBeTruthy()
    expect(screen.getByText('Radice vecchia')).toBeTruthy()
    expect(await screen.findByText('Come si fa il rollback?')).toBeTruthy()
    fireEvent.click(screen.getByText('Chiudi con questo ricordo'))
    await waitFor(() => expect(bodyOf(m, 'POST', `/api/gaps/${gap.id}/close`)).toEqual({ memory: 'f'.repeat(64) }))
    fireEvent.click(await screen.findByText('Segnala al team'))
    await waitFor(() => expect(bodyOf(m, 'POST', '/api/gaps/report')).toEqual({ key: 'chart helm' }))
  })

  it('Radici: scrivi CLAUDE.md e tienilo aggiornato', async () => {
    const m = mockFetch({
      'GET /api/roots/agent-files': [],
      'POST /api/roots/agent-files': { file: 'C:\\progetti\\ordini\\CLAUDE.md', changed: true }
    })
    wrap(<RootsTools />)
    fireEvent.change(await screen.findByPlaceholderText('C:\\progetti\\ordini'), { target: { value: 'C:\\progetti\\ordini' } })
    fireEvent.click(screen.getByText('Scrivi e tieni aggiornato'))
    expect(await screen.findByText(/Scritto: C:\\progetti\\ordini\\CLAUDE.md/)).toBeTruthy()
    expect(bodyOf(m, 'POST', '/api/roots/agent-files')).toEqual({ dir: 'C:\\progetti\\ordini', format: 'claude', keep: true })
  })

  it('primo avvio: un team "solo per me" si crea senza rete', async () => {
    const m = mockFetch({ 'GET /api/teams': { teams: [], identity: null }, 'POST /api/team/init': { configured: true, teamId: 'aaaa1111' } })
    wrap(<Onboarding />)
    fireEvent.click(await screen.findByText('Crea un nuovo team'))
    fireEvent.change(screen.getByPlaceholderText('Team Dev'), { target: { value: 'Personale' } })
    fireEvent.change(screen.getByPlaceholderText('pc-mario'), { target: { value: 'ada' } })
    fireEvent.click(screen.getByLabelText(/Solo per me, senza rete/))
    fireEvent.click(screen.getByText('Crea il team'))
    await waitFor(() => expect(bodyOf(m, 'POST', '/api/team/init')).toEqual({ team: 'Personale', name: 'ada', network: 'local' }))
  })

  it('Impostazioni: "Configura" installa MCP e tutti gli hook, "Solo MCP" nessun hook', async () => {
    const m = mockFetch({ 'POST /api/setup/claude-code': { mcpUrl: 'http://127.0.0.1:7337/mcp', hookFile: null } })
    wrap(<Settings />)
    fireEvent.click(await screen.findByText('Solo MCP'))
    fireEvent.click(screen.getByText('Sì, registra MCP'))
    await waitFor(() => expect(bodyOf(m, 'POST', '/api/setup/claude-code')).toEqual({ hook: false, context: false }))
    m.mockClear()
    fireEvent.click(screen.getByText('Configura MCP + raccolta + contesto automatico'))
    fireEvent.click(screen.getByText('Sì, modifica la configurazione'))
    await waitFor(() => expect(bodyOf(m, 'POST', '/api/setup/claude-code')).toEqual({ hook: true, context: true }))
  })
})
