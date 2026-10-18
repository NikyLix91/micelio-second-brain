/**
 * Limite di ricordi distillati (Fase 10): la scheda "Qualità della distillazione" mostra fasce,
 * saturazione e indicazione; l'admin cambia il limite dalla pagina Team.
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
  advice: { action: 'raise', reason: 'Le ultime posizioni valgono quasi quanto le prime.' }
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
    expect(screen.getByText('4ª–5ª')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy() // distillazioni al limite
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
