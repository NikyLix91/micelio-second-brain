/**
 * Colore di ogni team (preferenza personale, solo nel browser): assegnazione automatica di colori
 * diversi, il predefinito tiene il verde, i colori dei team tolti tornano liberi; il selettore
 * colora l'app solo con più team; nella pagina Team si cambia il colore.
 *
 * EN: Color of each team (personal preference, browser only): automatic assignment of different
 * colors, the default keeps green, colors of removed teams become free again; the switcher themes
 * the app only with several teams; the Team page changes the color.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setTokenForTests } from '../api/auth'
import { type TeamsInfo } from '../api/client'
import { setCurrentTeam } from '../api/team'
import { assignColors, setTeamColor, TEAM_COLORS } from '../api/teamColors'
import { TeamSwitch } from '../components/TeamSwitch'
import { Team } from '../pages/Team'

const team = (id: string, isDefault = false) =>
  ({ id, name: id, nodeName: 'ada', role: 'member' as const, members: 1, memories: 0, peers: 0, isDefault })
const teams: TeamsInfo = { teams: [team('alfa', true), team('beta')], identity: null }

function mockFetch (info: TeamsInfo) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const ok = String(url) === '/api/teams'
    return new Response(JSON.stringify(ok ? info : { error: 'non previsto' }), { status: ok ? 200 : 404 })
  })
}
const wrap = (node: JSX.Element) => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>
)
const themeColor = () => document.documentElement.dataset.teamColor

describe('assegnazione dei colori', () => {
  it('il predefinito tiene il verde, gli altri prendono colori liberi diversi', () => {
    const c = assignColors([team('a'), team('b', true), team('c')], {})
    expect(c.b).toBe('green')
    expect(new Set(Object.values(c)).size).toBe(3)
  })

  it('i colori scelti restano; quelli dei team tolti tornano liberi', () => {
    const c = assignColors([team('a', true), team('c')], { a: 'green', b: 'blue', c: 'violet' })
    expect(c).toEqual({ a: 'green', c: 'violet' })
    expect(assignColors([team('a', true), team('c'), team('d')], c).d).toBe('blue')
  })

  it('con più team che colori, i colori si ripetono', () => {
    const many = TEAM_COLORS.map((_c, i) => team(`t${i}`)).concat(team('extra'))
    const c = assignColors(many, {})
    expect(Object.keys(c)).toHaveLength(TEAM_COLORS.length + 1)
    expect(TEAM_COLORS).toContain(c.extra)
  })

  it('un colore salvato non valido viene riassegnato', () => {
    expect(assignColors([team('a', true)], { a: 'fucsia' as never }).a).toBe('green')
  })
})

describe('tema del team nell\'app', () => {
  beforeEach(() => { setTokenForTests('tok'); setCurrentTeam(null) })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); delete document.documentElement.dataset.teamColor })

  it('con un solo team l\'app non cambia aspetto', async () => {
    mockFetch({ teams: [team('alfa', true)], identity: null })
    wrap(<TeamSwitch />)
    await screen.findByRole('option', { name: /alfa/ })
    expect(themeColor()).toBeUndefined()
  })

  it('con più team l\'app prende il colore del team mostrato e lo ricorda', async () => {
    mockFetch(teams)
    wrap(<TeamSwitch />)
    await waitFor(() => expect(themeColor()).toBe('green'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'beta' } })
    await waitFor(() => expect(themeColor()).toBe('blue'))
    expect(JSON.parse(localStorage.getItem('micelio.teamColors') ?? '{}')).toEqual({ alfa: 'green', beta: 'blue' })
  })

  it('un colore cambiato si applica subito', async () => {
    mockFetch(teams)
    wrap(<TeamSwitch />)
    await waitFor(() => expect(themeColor()).toBe('green'))
    setTeamColor('alfa', 'teal')
    await waitFor(() => expect(themeColor()).toBe('teal'))
  })

  it('nella pagina Team si sceglie il colore dalla tavolozza', async () => {
    mockFetch(teams)
    wrap(<Team />)
    fireEvent.click(await screen.findByRole('button', { name: /colore del team «beta»/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Viola' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('micelio.teamColors') ?? '{}').beta).toBe('violet'))
    expect(screen.queryByRole('button', { name: 'Viola' })).toBeNull() // la tavolozza si chiude / EN: the palette closes
  })
})
