/**
 * Scheda «Protezione completa» (0.7.0): spenta con membri non aggiornati (niente pulsante, chi
 * manca), accensione con conferma, accesa con il cambio di chiave.
 * fetch è finto: controlliamo cosa la UI manda al daemon.
 *
 * EN: "Full protection" card (0.7.0): off with members not updated (no button, who is missing),
 * turning it on with confirmation, on with the key change.
 * fetch is fake: we check what the UI sends to the daemon.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Protection } from '../api/client'
import { ProtectionCard } from '../components/Protection'

const member = (name: string, version: string | null, hasKey = false) => ({ key: name.padEnd(64, '0'), name, role: 'member', version, hasKey })

function mock (p: Protection) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url)
    if (u === '/api/team/keys/rotate') return new Response(JSON.stringify({ gen: p.gen + 1 }))
    if (u === '/api/team/protection' && init?.method === 'POST') return new Response(JSON.stringify({ ...p, strict: true, gen: 1 }))
    return new Response(JSON.stringify(p))
  })
}

const show = () => render(<QueryClientProvider client={new QueryClient()}><ProtectionCard isAdmin /></QueryClientProvider>)

describe('ProtectionCard', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('spenta e un membro ancora alla 0.6: dice chi manca, niente pulsante', async () => {
    mock({ strict: false, gen: 0, ready: false, canEnable: false, waitingFor: ['bruno'], members: [member('alice', '0.7.0'), member('bruno', null)] })
    show()
    expect(await screen.findByText(/Mancano: bruno/)).toBeTruthy()
    expect(screen.getByText('prima della 0.7.0')).toBeTruthy()
    expect(screen.queryByText('Accendi la protezione completa')).toBeNull()
  })

  it('tutti aggiornati: l\'admin la accende dopo la conferma', async () => {
    const f = mock({ strict: false, gen: 0, ready: false, canEnable: true, waitingFor: [], members: [member('alice', '0.7.0'), member('bruno', '0.7.0')] })
    show()
    fireEvent.click(await screen.findByText('Accendi la protezione completa'))
    fireEvent.click(screen.getByText('Sì, accendila (non si torna indietro)'))
    await waitFor(() => expect(f.mock.calls.some(([u, i]) => u === '/api/team/protection' && i?.method === 'POST')).toBe(true))
  })

  it('accesa: generazione, chi ha la chiave, e cambio di chiave', async () => {
    const f = mock({ strict: true, gen: 3, ready: true, canEnable: false, waitingFor: [], members: [member('alice', '0.7.0', true), member('dario', '0.7.0', false)] })
    show()
    expect(await screen.findByText(/generazione 3/)).toBeTruthy()
    expect(screen.getByText('non ancora')).toBeTruthy()
    fireEvent.click(screen.getByText('Cambia la chiave adesso'))
    fireEvent.click(screen.getByText('Sì, cambia la chiave'))
    await waitFor(() => expect(f.mock.calls.some(([u]) => u === '/api/team/keys/rotate')).toBe(true))
    expect(await screen.findByText('Chiave cambiata: generazione 4.')).toBeTruthy()
  })
})
