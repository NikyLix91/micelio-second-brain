/**
 * Impostazioni → Rete (scelta DHT pubblica/privata) e Stato del nodo → Spazio occupato.
 * fetch è finto: rispondiamo in base all'URL e controlliamo cosa la UI invia al daemon.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTokenForTests } from '../api/auth'
import type { NetworkSettings, StorageReport } from '../api/client'
import { StorageCard } from '../pages/Dashboard'
import { NetworkCard } from '../pages/Settings'

const wrap = (Comp: () => JSX.Element | null) => render(<QueryClientProvider client={new QueryClient()}><Comp /></QueryClientProvider>)

/** fetch finto: `routes` associa "METODO /percorso" alla risposta JSON. */
function mockFetch (routes: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`
    return new Response(JSON.stringify(routes[key] ?? { error: `non previsto: ${key}` }), { status: key in routes ? 200 : 404 })
  })
}

const PUBLIC: NetworkSettings = { mode: 'public', bootstrap: [], active: [], fixedByEnv: null }

describe('NetworkCard', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('passa alla DHT privata: verifica e poi applica (con conferma) i nodi scritti', async () => {
    setTokenForTests('tok')
    const fetchMock = mockFetch({
      'GET /api/network': PUBLIC,
      'POST /api/network/check': { dht: '203.0.113.10:49737', reachable: true, nodes: 1, publicHost: '84.1.2.3', randomizedPort: null, ms: 40 },
      'PUT /api/network': { mode: 'private', bootstrap: ['203.0.113.10:49737'], active: ['203.0.113.10:49737'], fixedByEnv: null }
    })
    wrap(NetworkCard)
    expect(await screen.findByText(/In uso adesso/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/DHT privata del team/))
    fireEvent.change(screen.getByPlaceholderText('203.0.113.10:49737'), { target: { value: '203.0.113.10:49737' } })

    fireEvent.click(screen.getByText('Verifica'))
    expect(await screen.findByText(/IP pubblico 84\.1\.2\.3/)).toBeTruthy()
    const checkCall = fetchMock.mock.calls.find(([u]) => u === '/api/network/check')!
    expect(JSON.parse(checkCall[1]!.body as string)).toEqual({ mode: 'private', bootstrap: ['203.0.113.10:49737'] })

    fireEvent.click(screen.getByText('Applica'))
    fireEvent.click(screen.getByText(/Sì, cambia rete/))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/network' && i?.method === 'PUT')).toBe(true))
    const put = fetchMock.mock.calls.find(([u, i]) => u === '/api/network' && i?.method === 'PUT')!
    expect(JSON.parse(put[1]!.body as string)).toEqual({ mode: 'private', bootstrap: ['203.0.113.10:49737'] })
  })

  it('rete fissata da MICELIO_DHT_BOOTSTRAP: solo un avviso, niente scelta', async () => {
    mockFetch({ 'GET /api/network': { ...PUBLIC, fixedByEnv: '127.0.0.1:49737' } })
    wrap(NetworkCard)
    expect(await screen.findByText(/fissata dalla variabile/)).toBeTruthy()
    expect(screen.queryByText('Applica')).toBeNull()
  })
})

describe('StorageCard', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('mostra il totale su disco e la quota di ciascun membro', async () => {
    const report: StorageReport = {
      disk: { log: 3 * 1024 * 1024, index: 1024 * 1024, private: 200 * 1024, cache: 0, export: 50 * 1024, total: 4 * 1024 * 1024 + 250 * 1024 },
      teamLogBytes: 3 * 1024 * 1024,
      members: [
        { key: 'a'.repeat(64), name: 'alice', removed: false, bytes: 2.25 * 1024 * 1024, share: 0.75, memories: 30, memoryBytes: 40_000 },
        { key: 'b'.repeat(64), name: 'bruno', removed: false, bytes: 0.75 * 1024 * 1024, share: 0.25, memories: 10, memoryBytes: 12_000 }
      ]
    }
    mockFetch({ 'GET /api/storage': report })
    wrap(StorageCard)
    expect(await screen.findByText('4,2 MB')).toBeTruthy()
    expect(screen.getByText('75%')).toBeTruthy()
    expect(screen.getByText('25%')).toBeTruthy()
    expect(screen.getByText('alice')).toBeTruthy()
    // un segmento della barra per membro, largo quanto la sua quota
    const bar = screen.getByRole('img', { name: /Quota del log/ })
    expect([...bar.children].map((d) => (d as HTMLElement).style.width)).toEqual(['75%', '25%'])
  })
})
