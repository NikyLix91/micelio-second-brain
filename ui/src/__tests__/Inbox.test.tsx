/**
 * Schermata Inbox: approvazione con correzione e rifiuto chiamano le API giuste.
 * fetch è finto: controlliamo le richieste che la UI invia al daemon.
 *
 * EN: Inbox screen: approve with correction and reject call the right APIs.
 * fetch is mocked: we check the requests the UI sends to the daemon.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTokenForTests } from '../api/auth'
import type { InboxItem } from '../api/client'
import { InboxCard } from '../pages/Inbox'

const item: InboxItem = {
  id: 'abc123',
  created: 0,
  expires: Date.now() + 1e9,
  reason: 'da verificare: contenuto misto',
  source: { type: 'claude-code', ref: 's1' },
  memory: { kind: 'gotcha', title: 'Proxy aziendale', body: 'Serve HTTPS_PROXY.', tags: [], source: { type: 'claude-code' } }
}

function renderCard () {
  const client = new QueryClient()
  return render(<QueryClientProvider client={client}><InboxCard item={item} /></QueryClientProvider>)
}

describe('InboxCard', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('approva con il titolo corretto', async () => {
    setTokenForTests('tok')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'x', memory: item.memory })))
    renderCard()
    fireEvent.click(screen.getByText('Correggi'))
    fireEvent.change(screen.getByDisplayValue('Proxy aziendale'), { target: { value: 'Proxy aziendale in pipeline' } })
    fireEvent.click(screen.getByText('Pubblica la versione corretta'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/inbox/abc123/approve')
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Proxy aziendale in pipeline', body: 'Serve HTTPS_PROXY.' })
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok')
  })

  it('salvataggio trattenuto dal controllo del team (0.6.1): problema, soluzione e «Pubblica in…»', async () => {
    const held: InboxItem = { ...item, teamCheck: { problem: 'not-enabled', cwd: 'C:/repo/app', session: { id: 'aaaa1111', name: 'Team B' } } }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url) === '/api/teams') {
        return new Response(JSON.stringify({ teams: [{ id: 'aaaa1111', name: 'Team B', role: 'admin', isDefault: true }, { id: 'bbbb2222', name: 'Team A', role: 'member', isDefault: false }], identity: null }))
      }
      return new Response(JSON.stringify({ team: 'bbbb2222' }))
    })
    render(<QueryClientProvider client={new QueryClient()}><InboxCard item={held} /></QueryClientProvider>)
    expect(screen.getByText(/non è abilitata in nessun team/)).toBeTruthy()
    expect(screen.getByText(/abilita la cartella nel team giusto/)).toBeTruthy()
    // Il pulsante principale dice in quale team pubblica / EN: The main button says which team it publishes to
    await waitFor(() => expect(screen.getByText('Pubblica in «Team B»')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Pubblica in…'), { target: { value: 'bbbb2222' } })
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/inbox/abc123/move')).toBe(true))
    const [, init] = fetchMock.mock.calls.find(([u]) => u === '/api/inbox/abc123/move') as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ team: 'bbbb2222', publish: true })
  })

  it('scarta', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}'))
    renderCard()
    fireEvent.click(screen.getByText('Scarta'))
    await waitFor(() => expect(fetchMock.mock.calls[0][0]).toBe('/api/inbox/abc123/reject'))
  })
})
