/**
 * Schermata Sicurezza (Fase 9): banco di prova, regole del team (modificabili solo dall'admin),
 * scansione con "ripulisci", registro. fetch è finto: rispondiamo per metodo + URL.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTokenForTests } from '../api/auth'
import type { SecurityRules } from '../api/client'
import { Security } from '../pages/Security'

const RULES: SecurityRules = {
  builtin: [{ type: 'secret:jwt', label: 'Token JWT' }],
  defaultSensitiveFiles: ['**/.env'],
  team: { secretPatterns: [{ name: 'Codice cliente', regex: 'CLI-\\d{6}' }], allow: [], sensitiveFiles: [] }
}

function mockFetch (role: 'admin' | 'member', extra: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    'GET /api/status': { role },
    'GET /api/security/rules': RULES,
    'GET /api/security/log?limit=100': [{ id: 1, ts: 0, source: { type: 'claude-code', ref: 's1' }, label: 'Configura il database', kinds: { 'secret:url-credentials': 1 }, omitted: ['.env'] }],
    ...extra
  }
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`
    return new Response(JSON.stringify(routes[key] ?? { error: `non previsto: ${key}` }), { status: key in routes ? 200 : 404 })
  })
}
const renderPage = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><Security /></MemoryRouter></QueryClientProvider>)
const sent = (m: ReturnType<typeof mockFetch>, method: string, url: string) => m.mock.calls.find(([u, i]) => u === url && (i?.method ?? 'GET') === method)

describe('Security', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('banco di prova: mostra testo redatto, tipi trovati e file sensibile', async () => {
    setTokenForTests('tok')
    const m = mockFetch('member', {
      'POST /api/security/test': { text: 'DB=[REDACTED:url-credentials]', redactions: { 'secret:url-credentials': 1 }, blockedBy: [], sensitiveFile: '**/.env' }
    })
    renderPage()
    fireEvent.change(await screen.findByPlaceholderText(/DATABASE_URL/), { target: { value: 'DB=postgres://a:b@h/x' } })
    fireEvent.change(screen.getByPlaceholderText(/Nome di file/), { target: { value: '.env' } })
    fireEvent.click(screen.getByText('Prova'))
    expect(await screen.findByText('DB=[REDACTED:url-credentials]')).toBeTruthy()
    expect(screen.getByText(/file sensibile/)).toBeTruthy()
    expect(JSON.parse(sent(m, 'POST', '/api/security/test')![1]!.body as string)).toEqual({ text: 'DB=postgres://a:b@h/x', file: '.env' })
  })

  it('registro: tipi e file omessi, mai valori', async () => {
    mockFetch('member')
    renderPage()
    expect(await screen.findByText('Configura il database')).toBeTruthy()
    expect(screen.getByText('url-credentials')).toBeTruthy()
    expect(screen.getByText('.env')).toBeTruthy()
  })

  it('admin: aggiunge un\'eccezione e salva per tutto il team', async () => {
    const m = mockFetch('admin', { 'PUT /api/security/rules': RULES })
    renderPage()
    fireEvent.change(await screen.findByPlaceholderText('demo-key-pubblica'), { target: { value: 'demo-key-pubblica\n/^test_/' } })
    await waitFor(() => expect((screen.getByText('Salva per tutto il team') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByText('Salva per tutto il team'))
    await waitFor(() => expect(sent(m, 'PUT', '/api/security/rules')).toBeTruthy())
    expect(JSON.parse(sent(m, 'PUT', '/api/security/rules')![1]!.body as string)).toEqual({ allow: ['demo-key-pubblica', '/^test_/'] })
  })

  it('membro non admin: regole in sola lettura, niente "Salva"', async () => {
    mockFetch('member')
    renderPage()
    expect(await screen.findByDisplayValue('Codice cliente')).toBeTruthy()
    expect((screen.getByDisplayValue('Codice cliente') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByText('Salva per tutto il team')).toBeNull()
  })
})
