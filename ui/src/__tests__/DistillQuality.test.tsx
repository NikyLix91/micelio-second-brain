/**
 * Limite di ricordi distillati (Fase 10): la scheda "Qualità della distillazione" mostra fasce,
 * saturazione e indicazione; l'admin cambia il limite dalla pagina Team.
 *
 * EN: Limit on distilled memories (Phase 10): the "Distillation quality" card shows bands,
 * saturation and advice; the admin changes the limit from the Team page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTokenForTests } from '../api/auth'
import type { DistillQuality } from '../api/client'
import { DistillQualityCard, Team } from '../pages/Team'

const Q: DistillQuality = {
  maxMemories: 5,
  total: 60,
  buckets: [
    { label: '1ª', from: 1, to: 1, n: 20, young: 1, useful: 0.8, notUseful: 0.05, removed: 0.05, unused: 0.1, score: 0.7 },
    { label: '4ª–5ª', from: 4, to: 5, n: 15, young: 0, useful: 0.7, notUseful: 0.05, removed: 0.05, unused: 0.2, score: 0.6 }
  ],
  saturation: { batches: 20, atLimit: 12, rate: 0.6 },
  advice: { action: 'raise', code: 'raise', params: { mature: 35, minSample: 30, minAgeDays: 3, minTail: 10, saturationRate: 0.6, tailN: 15, headScore: 0.7, tailScore: 0.6, badShare: 0.1 }, reason: 'testo italiano per la CLI' }
}

function mockFetch (routes: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`
    return new Response(JSON.stringify(routes[key] ?? { error: `non previsto: ${key}` }), { status: key in routes ? 200 : 404 })
  })
}
const wrap = (Comp: () => JSX.Element | null) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><Comp /></MemoryRouter></QueryClientProvider>)

describe('Qualità della distillazione', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('mostra fasce, saturazione e indicazione', async () => {
    setTokenForTests('tok')
    mockFetch({ 'GET /api/distill/quality': Q })
    wrap(DistillQualityCard)
    expect(await screen.findByText('Conviene alzare il limite.')).toBeTruthy()
    expect(screen.getByText('0.70')).toBeTruthy()
    expect(screen.getByText('4ª–5ª')).toBeTruthy() // fascia composta dalla UI (from/to) / EN: band composed by the UI (from/to)
    expect(screen.getByText(/limite raggiunto in 12 distillazioni su 20/)).toBeTruthy()
    // L'indicazione è composta nella lingua dell'utente a partire dai valori (non dal testo della CLI)
    // EN: The advice is composed in the user's language from the values (not from the CLI text)
    expect(screen.getByText(/punteggio 0\.60 contro 0\.70/)).toBeTruthy()
  })

  it('l\'admin cambia il limite per tutto il team', async () => {
    const m = mockFetch({
      'GET /api/status': { role: 'admin', team: { name: 'T' }, members: 1 },
      'GET /api/members': [],
      'GET /api/invites': [],
      'GET /api/team/config': { language: 'it', blockKeywords: [], maxMemories: 5 },
      'GET /api/distill/quality': Q,
      'POST /api/team/config': { ok: true }
    })
    wrap(Team)
    fireEvent.change(await screen.findByDisplayValue('5'), { target: { value: '8' } })
    fireEvent.click(screen.getByText('Salva per tutto il team'))
    await waitFor(() => expect(m.mock.calls.some(([u, i]) => u === '/api/team/config' && i?.method === 'POST')).toBe(true))
    const call = m.mock.calls.find(([u, i]) => u === '/api/team/config' && i?.method === 'POST')!
    expect(JSON.parse(call[1]!.body as string)).toEqual({ key: 'distill.maxMemories', value: 8 })
  })
})
