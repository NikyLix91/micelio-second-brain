/**
 * Impostazioni → Intelligenza (LLM): tendine dei modelli (Haiku, Sonnet, Opus, «Altro…» con
 * nome libero) e spiegazione dell'adapter (es. «fake» = LLM finto del team demo).
 *
 * EN: Settings → Intelligence (LLM): model dropdowns (Haiku, Sonnet, Opus, «Other…» with a
 * free name) and explanation of the adapter (e.g. «fake» = the demo team's fake LLM).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTokenForTests } from '../api/auth'
import { Settings } from '../pages/Settings'

const SETTINGS = (adapter: string) => ({
  llm: { adapter, command: 'claude', classifyModel: 'haiku', distillModel: 'sonnet', dailyBudget: 300 },
  watched: [], documents: [], port: 7337,
  network: { mode: 'public', bootstrap: [], active: [], fixedByEnv: null }
})

function mockFetch (adapter: string) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`
    const routes: Record<string, unknown> = {
      'GET /api/settings': SETTINGS(adapter),
      'PUT /api/settings/llm': SETTINGS(adapter),
      'GET /api/documents': { folders: [], stats: {} },
      'GET /api/network': SETTINGS(adapter).network
    }
    return new Response(JSON.stringify(routes[key] ?? { error: `non previsto: ${key}` }), { status: key in routes ? 200 : 404 })
  })
}
const renderPage = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><Settings /></MemoryRouter></QueryClientProvider>)
const putBody = (m: ReturnType<typeof mockFetch>) => JSON.parse(m.mock.calls.find(([u, i]) => u === '/api/settings/llm' && i?.method === 'PUT')![1]!.body as string)

describe('scelta dei modelli', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('tendina: si sceglie Opus per distillare', async () => {
    setTokenForTests('tok')
    const m = mockFetch('claude')
    renderPage()
    fireEvent.change(await screen.findByLabelText('Modello per distillare (più capace)'), { target: { value: 'opus' } })
    fireEvent.click(screen.getByText('Salva'))
    await waitFor(() => expect(m.mock.calls.some(([u, i]) => u === '/api/settings/llm' && i?.method === 'PUT')).toBe(true))
    expect(putBody(m)).toMatchObject({ distillModel: 'opus' })
  })

  it('«Altro…»: nome di modello libero', async () => {
    const m = mockFetch('claude')
    renderPage()
    fireEvent.change(await screen.findByLabelText('Modello per classificare (veloce)'), { target: { value: '__altro' } })
    fireEvent.change(screen.getByLabelText('Modello per classificare (veloce): nome del modello'), { target: { value: 'claude-haiku-5-5' } })
    fireEvent.click(screen.getByText('Salva'))
    await waitFor(() => expect(m.mock.calls.some(([u, i]) => u === '/api/settings/llm' && i?.method === 'PUT')).toBe(true))
    expect(putBody(m)).toMatchObject({ classifyModel: 'claude-haiku-5-5' })
  })

  it('adapter «fake» spiegato: LLM finto, non chiama Claude', async () => {
    mockFetch('fake')
    renderPage()
    expect(await screen.findByText(/FINTO, solo per demo e test: non chiama Claude/)).toBeTruthy()
  })
})
