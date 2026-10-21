/**
 * Più team sullo stesso PC nella UI (B3): il team scelto viaggia nell'intestazione di ogni
 * richiesta, il selettore cambia team e lo ricorda, la pagina Team mostra i team del PC,
 * l'identità e la stessa persona negli altri team, il modulo "Aggiungi un team" usa il nome
 * dell'identità.
 * fetch è finto: rispondiamo in base a metodo + URL (+ team) e controlliamo cosa viene inviato.
 *
 * EN: Multiple teams on the same PC in the UI (B3): the chosen team travels in the header of every request,
 * the selector switches team and remembers it, the Team page shows the PC's teams, the identity and the
 * same person in the other teams, the "Add a team" form uses the identity's name. fetch is fake: we
 * reply based on method + URL (+ team) and check what gets sent.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setTokenForTests } from '../api/auth'
import { api, type MemberRecord, type TeamsInfo } from '../api/client'
import { currentTeam, setCurrentTeam, TEAM_HEADER } from '../api/team'
import { TeamSwitch } from '../components/TeamSwitch'
import { Onboarding } from '../pages/Onboarding'
import { Team } from '../pages/Team'

const P1 = '1'.repeat(64)
const P2 = '2'.repeat(64)
const teams: TeamsInfo = {
  teams: [
    { id: 'aaaa1111', name: 'Alfa', nodeName: 'ada', role: 'admin', members: 2, memories: 10, peers: 1, isDefault: true },
    { id: 'bbbb2222', name: 'Beta', nodeName: 'ada', role: 'member', members: 3, memories: 4, peers: 0, isDefault: false }
  ],
  identity: { name: 'ada', publicKey: P1 }
}
const member = (key: string, name: string, person?: string, extra: Partial<MemberRecord> = {}): MemberRecord =>
  ({ key: key.repeat(64), name, role: 'member', invitedBy: null, removed: false, joinedAt: 0, person, ...extra })

/** Intestazione del team di una richiesta finta (undefined se assente). / EN: Team header of a fake request (undefined if missing). */
const teamOf = (init?: RequestInit) => (init?.headers as Record<string, string> | undefined)?.[TEAM_HEADER]

/**
 * fetch finto: "METODO /percorso" → risposta; con "METODO /percorso @team" si risponde in modo
 * diverso a seconda del team indicato nell'intestazione.
 *
 * EN: Fake fetch: "METHOD /path" → response; with "METHOD /path @team" the reply differs depending on the
 * team given in the header.
 */
function mockFetch (routes: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const base = `${init?.method ?? 'GET'} ${String(url)}`
    const team = teamOf(init)
    const key = team && `${base} @${team}` in routes ? `${base} @${team}` : base
    return new Response(JSON.stringify(routes[key] ?? { error: `non previsto: ${key}` }), { status: key in routes ? 200 : 404 })
  })
}
const wrap = (node: JSX.Element) => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>
)

describe('più team', () => {
  beforeEach(() => { setTokenForTests('tok'); setCurrentTeam(null) })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

  it('il team scelto viaggia in ogni richiesta; senza scelta nessuna intestazione', async () => {
    const m = mockFetch({ 'GET /api/status': { configured: true } })
    await api.status()
    expect(teamOf(m.mock.calls[0][1])).toBeUndefined()
    setCurrentTeam('bbbb2222')
    await api.status()
    expect(teamOf(m.mock.calls[1][1])).toBe('bbbb2222')
    expect(localStorage.getItem('micelio.team')).toBe('bbbb2222')
    // una richiesta può indicare un altro team (membri degli altri team nella pagina Team)
    // EN: a request can name another team (members of the other teams in the Team page)
    await api.membersOf('aaaa1111').catch(() => {})
    expect(teamOf(m.mock.calls[2][1])).toBe('aaaa1111')
  })

  it('il selettore mostra i team, cambia team e torna al predefinito se quello scelto sparisce', async () => {
    mockFetch({ 'GET /api/teams': teams })
    wrap(<TeamSwitch />)
    const select = await screen.findByRole('combobox') as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('aaaa1111')) // nessuna scelta: il predefinito / EN: no choice: the default one
    expect(screen.getByText('Alfa · predefinito')).toBeTruthy()
    fireEvent.change(select, { target: { value: 'bbbb2222' } })
    expect(currentTeam()).toBe('bbbb2222')
    cleanup()
    // il team scelto non c'è più (tolto da un'altra finestra): si torna al predefinito
    // EN: the chosen team no longer exists (removed from another window): back to the default
    setCurrentTeam('cccc3333')
    wrap(<TeamSwitch />)
    await waitFor(() => expect(currentTeam()).toBeNull())
  })

  it('pagina Team: i tuoi team, l\'identità e la stessa persona negli altri team', async () => {
    const m = mockFetch({
      'GET /api/teams': teams,
      'GET /api/status': { configured: true, role: 'member', nodeKey: 'a'.repeat(64), team: { name: 'Alfa' }, members: 2 },
      'GET /api/members': [member('a', 'ada', P1), member('c', 'carla', P2)],
      'GET /api/members @bbbb2222': [member('d', 'ada', P1), member('e', 'carla', P2), member('f', 'dario')],
      'GET /api/invites': [],
      'POST /api/teams/bbbb2222/default': teams.teams
    })
    wrap(<Team />)
    expect(await screen.findByText('I tuoi team su questo PC')).toBeTruthy()
    expect(await screen.findByText(/Tu: ada · identità 111111111111/)).toBeTruthy()
    // carla è anche in Beta: lo si riconosce dalla chiave della persona, non dal nome
    // EN: carla is also in Beta: she is recognized by the person's key, not by the name
    await waitFor(() => expect(screen.getAllByText('stessa persona anche in: Beta')).toHaveLength(2))
    fireEvent.click(screen.getByText('Rendi predefinito'))
    await waitFor(() => expect(m.mock.calls.some(([u, i]) => u === '/api/teams/bbbb2222/default' && i?.method === 'POST')).toBe(true))
  })

  it('"Aggiungi un team": il nome viene dall\'identità, e si passa subito al nuovo team', async () => {
    const m = mockFetch({
      'GET /api/teams': teams,
      'POST /api/team/init': { configured: true, teamId: 'cccc3333' }
    })
    const onDone = vi.fn()
    wrap(<Onboarding adding onDone={onDone} />)
    expect(await screen.findByText('Aggiungi un team')).toBeTruthy()
    fireEvent.click(screen.getByText('Crea un nuovo team'))
    await screen.findByText(/vuoto = «ada»/)
    fireEvent.change(screen.getByPlaceholderText('Team Dev'), { target: { value: 'Gamma' } })
    fireEvent.click(screen.getByText('Crea il team'))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const [, init] = m.mock.calls.find(([u]) => u === '/api/team/init')!
    expect(JSON.parse(String(init?.body))).toEqual({ team: 'Gamma' }) // nessun nome: quello dell'identità / EN: no name: the identity's one
    expect(currentTeam()).toBe('cccc3333')
  })
})
