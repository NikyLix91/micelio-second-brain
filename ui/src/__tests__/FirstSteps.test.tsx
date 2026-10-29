/**
 * Primi passi: i passi si spuntano dallo stato del daemon, «Collega» e le cartelle chiamano le API
 * giuste, una chiamata di Claude Code dalla cartella sbagliata viene spiegata.
 * fetch è finto: controlliamo cosa la UI manda al daemon.
 *
 * EN: First steps: the steps tick from the daemon's state, "Connect" and the folders call the
 * right APIs, a Claude Code call from the wrong folder is explained.
 * fetch is fake: we check what the UI sends to the daemon.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FirstStepsStatus } from '../api/client'
import { FirstSteps, firstStepsState, stepsDone } from '../pages/FirstSteps'

const base: FirstStepsStatus = {
  claude: { found: true, file: 'C:\\Users\\a\\.local\\bin\\claude.exe', usedByThisUser: true },
  registration: 'missing',
  folders: [],
  agent: null,
  lastAgent: null
}

function mock (d: FirstStepsStatus) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url)
    if (u === '/api/setup/claude-code' && init?.method === 'POST') return new Response(JSON.stringify({ mcpUrl: 'x', hookFile: 'y', via: 'cli', claude: 'claude', user: 'a', otherUser: false }))
    if (u === '/api/watch' && init?.method === 'POST') return new Response(JSON.stringify(['C:\\progetto']))
    return new Response(JSON.stringify(d))
  })
}

const show = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><FirstSteps /></MemoryRouter></QueryClientProvider>)

describe('FirstSteps', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

  it('conta i passi fatti', () => {
    expect(stepsDone(base)).toEqual([true, false, false, false])
    expect(stepsDone({ ...base, registration: 'shim', folders: ['C:\\p'], agent: { at: 1, cwd: 'C:\\p' } })).toEqual([true, true, true, true])
    expect(stepsDone({ ...base, claude: { ...base.claude, usedByThisUser: false } })[0]).toBe(false)
  })

  it('Claude Code mai aperto da questo utente: lo spiega', async () => {
    mock({ ...base, claude: { ...base.claude, usedByThisUser: false } })
    show()
    expect(await screen.findByText(/questo utente del PC non l'ha mai aperto/)).toBeTruthy()
  })

  it('collega Claude Code e abilita una cartella con le API giuste', async () => {
    const f = mock(base)
    show()
    fireEvent.click(await screen.findByText('Collega Claude Code'))
    await waitFor(() => expect(f.mock.calls.some(([u, i]) => u === '/api/setup/claude-code' && i?.method === 'POST')).toBe(true))
    expect(await screen.findByText(/Chiudi e riapri le sessioni/)).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/percorso della cartella/), { target: { value: 'C:\\progetto' } })
    fireEvent.click(screen.getByText('Aggiungi'))
    await waitFor(() => expect(f.mock.calls.some(([u, i]) => u === '/api/watch' && i?.method === 'POST' && String(i.body).includes('progetto'))).toBe(true))
  })

  it('chiamata da una cartella in nessun team: dice quale e cosa fare', async () => {
    mock({ ...base, registration: 'shim', folders: ['C:\\progetto'], lastAgent: { at: 1, cwd: 'C:\\altro', sameTeam: false, inSomeTeam: false } })
    show()
    expect(await screen.findByText(/dalla cartella C:\\altro, che non è abilitata in nessun team/)).toBeTruthy()
  })

  it('chiamata arrivata dalla cartella giusta: passo fatto', async () => {
    mock({ ...base, registration: 'shim', folders: ['C:\\progetto'], agent: { at: Date.now(), cwd: 'C:\\progetto' }, lastAgent: { at: Date.now(), cwd: 'C:\\progetto', sameTeam: true, inSomeTeam: true } })
    show()
    expect(await screen.findByText(/Claude Code ha parlato con Micelio alle/)).toBeTruthy()
    expect(await screen.findByText('4 di 4 fatti')).toBeTruthy()
  })

  it('«Ho finito» chiude il percorso', async () => {
    mock(base)
    show()
    fireEvent.click(await screen.findByText('Ho finito'))
    expect(firstStepsState()).toBe('done')
  })
})
