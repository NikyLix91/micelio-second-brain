/**
 * @file Ossatura della UI: barra laterale di navigazione + schermata corrente.
 *
 * EN: UI skeleton: navigation sidebar + current screen.
 *
 * Routing con HashRouter (URL del tipo /ui/#/inbox): funziona identico nel browser servito dal
 * daemon e nell'app Electron, senza configurare il server per le "rotte" della SPA.
 *
 * EN: Routing with HashRouter (URLs like /ui/#/inbox): it works the same in the browser served by
 * the daemon and in the Electron app, without configuring the server for the SPA "routes".
 *
 * Se il nodo non appartiene ancora a un team, al posto delle schermate mostra l'Onboarding.
 * Con più team (B3) il selettore nella barra laterale sceglie su quale team lavorano le schermate
 * (vedi api/team.ts); /team/nuovo aggiunge un team.
 *
 * EN: If the node does not belong to a team yet, it shows the Onboarding instead of the screens.
 * With several teams (B3) the selector in the sidebar picks which team the screens work on
 * (see api/team.ts); /team/nuovo adds a team.
 *
 * Home = Nucleo 3D (vista "wow" e navigazione guidata). Le viste 2D servono a scopi specifici
 * (es. Mappa 2D con filtri per autore e tipo).
 *
 * EN: Home = 3D Nucleus ("wow" view and guided navigation). The 2D views serve specific purposes
 * (e.g. 2D Map with filters by author and type).
 */
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api } from './api/client'
import { useLiveEvents } from './api/live'
import { useCurrentTeam } from './api/team'
import { TeamSwitch } from './components/TeamSwitch'
import { ErrorBox } from './components/ui'
import { HelpProvider, useHelp } from './help'
import { defineStrings, LangSwitch, useStrings } from './i18n'
import { FirstSteps, firstStepsState, stepsDone } from './pages/FirstSteps'
import { Guide } from './pages/Guide'
import { Constellation } from './pages/Constellation'
import { Dashboard } from './pages/Dashboard'
import { Inbox } from './pages/Inbox'
import { Memory } from './pages/Memory'
import { Roots } from './pages/Roots'
import { Security } from './pages/Security'
import { Onboarding } from './pages/Onboarding'
import { Private } from './pages/Private'
import { Settings } from './pages/Settings'
import { Team } from './pages/Team'
import { Dreams } from './pages/Dreams'
import { Digest } from './pages/Digest'
import { Efficacy } from './pages/Efficacy'
import { Ask } from './pages/Ask'

/** Testi dell'ossatura (menu, stati di connessione) nelle due lingue. / EN: Skeleton texts (menu, connection states) in both languages. */
const S = defineStrings({
  it: {
    connecting: 'Connessione al nodo…',
    nucleusLoading: 'Accensione del nucleo…',
    firstSteps: (n: number) => `Primi passi · ${n}/4`,
    nav: { nucleus: 'Nucleo', map: 'Mappa 2D', ask: 'Chiedi', memory: 'Memoria', roots: 'Radici', inbox: 'Inbox', team: 'Team', digest: 'Riepilogo', efficacy: 'Efficacia', dreams: 'Sogni', status: 'Stato', private: 'Registro privato', security: 'Sicurezza', settings: 'Impostazioni', guide: 'Guida' },
    live: 'Aggiornamenti in tempo reale',
    reconnecting: 'Riconnessione…'
  },
  en: {
    connecting: 'Connecting to the node…',
    nucleusLoading: 'Powering up the nucleus…',
    firstSteps: (n: number) => `First steps · ${n}/4`,
    nav: { nucleus: 'Nucleus', map: '2D map', ask: 'Ask', memory: 'Memory', roots: 'Roots', inbox: 'Inbox', team: 'Team', digest: 'Digest', efficacy: 'Efficacy', dreams: 'Dreams', status: 'Status', private: 'Private log', security: 'Security', settings: 'Settings', guide: 'Guide' },
    live: 'Live updates',
    reconnecting: 'Reconnecting…'
  }
})

// Il Nucleo 3D porta con sé three.js: caricato solo quando serve (bundle separato).
// EN: The 3D Nucleus brings three.js along: loaded only when needed (separate bundle).
const Nucleus = lazy(() => import('./pages/nucleus/Nucleus'))

export function App () {
  const live = useLiveEvents()
  const status = useQuery({ queryKey: ['status'], queryFn: api.status })
  const s = useStrings(S)

  if (status.error) return <div className='centered'><ErrorBox error={status.error} /></div>
  if (!status.data) return <div className='centered muted'>{s.connecting}</div>
  // Primo avvio: la guida serve anche qui (pulsante «?» del modulo)
  // EN: First start: the help is needed here too (the form's «?» button)
  if (!status.data.configured) return <HelpProvider><Onboarding /></HelpProvider>

  return (
    <HashRouter>
      <HelpProvider>
        <Shell live={live} team={status.data.team?.name ?? ''} node={status.data.nodeName ?? ''}>
          <Routes>
            <Route path='/' element={<Suspense fallback={<div className='hud hud-center'>{s.nucleusLoading}</div>}><Nucleus /></Suspense>} />
            <Route path='/mappa' element={<Constellation />} />
            <Route path='/stato' element={<Dashboard />} />
            <Route path='/memoria' element={<Memory />} />
            <Route path='/radici' element={<Roots />} />
            <Route path='/inbox' element={<Inbox />} />
            <Route path='/team' element={<Team />} />
            <Route path='/team/nuovo' element={<AddTeam />} />
            <Route path='/sogni' element={<Dreams />} />
            <Route path='/riepilogo' element={<Digest />} />
            <Route path='/efficacia' element={<Efficacy />} />
            <Route path='/chiedi' element={<Ask />} />
            <Route path='/privato' element={<Private />} />
            <Route path='/sicurezza' element={<Security />} />
            <Route path='/impostazioni' element={<Settings />} />
            <Route path='/guida' element={<Guide />} />
            <Route path='/primi-passi' element={<FirstSteps />} />
          </Routes>
        </Shell>
      </HelpProvider>
    </HashRouter>
  )
}

/** Argomento della guida per ogni pagina (F1). / EN: Help topic for each page (F1). */
export const PAGE_TOPIC: Record<string, string> = {
  '/': 'views#nucleus', '/mappa': 'views#map', '/memoria': 'memory', '/radici': 'roots', '/inbox': 'inbox',
  '/team': 'team', '/sogni': 'dreams', '/stato': 'status', '/privato': 'private', '/sicurezza': 'security',
  '/impostazioni': 'settings', '/guida': 'overview', '/team/nuovo': 'teams', '/riepilogo': 'digest', '/efficacia': 'efficacy', '/chiedi': 'ask', '/primi-passi': 'first-steps'
}

/** Pagina "Aggiungi un team": a ingresso riuscito si torna alla home, già sul nuovo team. / EN: "Add a team" page: after a successful join it goes back home, already on the new team. */
function AddTeam () {
  const navigate = useNavigate()
  // Anche un team in più ha le sue cartelle: si passa dai Primi passi
  // EN: An extra team has its own folders too: go through the First steps
  return <Onboarding adding onDone={() => navigate('/primi-passi')} />
}

/**
 * Guscio: barra laterale + area principale. Sul Nucleo l'area è a tutto schermo (senza
 * margini) e tutta l'app passa al tema "olografico" scuro, per non spezzare l'effetto.
 *
 * EN: Shell: sidebar + main area. On the Nucleus the area is full screen (no
 * margins) and the whole app switches to the dark "holographic" theme, so the effect is not broken.
 */
function Shell ({ children, live, team, node }: { children: React.ReactNode, live: boolean, team: string, node: string }) {
  const { pathname } = useLocation()
  const holo = pathname === '/'
  // F1: guida sull'argomento della pagina corrente
  // EN: F1: help on the current page's topic
  const { open } = useHelp()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F1') return
      e.preventDefault()
      open(PAGE_TOPIC[pathname] ?? 'overview')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pathname])
  return (
    <div className={`app ${holo ? 'holo' : ''}`}>
      <Sidebar live={live} team={team} node={node} />
      <main className={`main ${holo ? 'full' : ''}`}>{children}</main>
    </div>
  )
}

/** Barra laterale: marchio, voci di navigazione (con il contatore dell'inbox), stato della connessione. / EN: Sidebar: brand, navigation items (with the Inbox counter), connection status. */
function Sidebar ({ live, team, node }: { live: boolean, team: string, node: string }) {
  const ingest = useQuery({ queryKey: ['ingest'], queryFn: api.ingestStatus })
  const inbox = ingest.data?.inbox ?? 0
  const link = ({ isActive }: { isActive: boolean }) => `nav-link ${isActive ? 'active' : ''}`
  const s = useStrings(S)
  const n = s.nav
  return (
    <nav className='sidebar'>
      <div className='brand'>
        <span aria-hidden>🍄</span>
        <div>Micelio<small>{team}</small></div>
      </div>
      <TeamSwitch />
      <FirstStepsLink />
      <NavLink to='/' end className={link}>{n.nucleus}</NavLink>
      <NavLink to='/mappa' className={link}>{n.map}</NavLink>
      <NavLink to='/chiedi' className={link}>{n.ask}</NavLink>
      <NavLink to='/memoria' className={link}>{n.memory}</NavLink>
      <NavLink to='/radici' className={link}>{n.roots}</NavLink>
      <NavLink to='/inbox' className={link}>{n.inbox} {inbox > 0 && <span className='count'>{inbox}</span>}</NavLink>
      <NavLink to='/team' end className={link}>{n.team}</NavLink>
      <NavLink to='/riepilogo' className={link}>{n.digest}</NavLink>
      <NavLink to='/efficacia' className={link}>{n.efficacy}</NavLink>
      <NavLink to='/sogni' className={link}>{n.dreams}</NavLink>
      <NavLink to='/stato' className={link}>{n.status}</NavLink>
      <NavLink to='/privato' className={link}>{n.private}</NavLink>
      <NavLink to='/sicurezza' className={link}>{n.security}</NavLink>
      <NavLink to='/impostazioni' className={link}>{n.settings}</NavLink>
      <NavLink to='/guida' className={link}>{n.guide}</NavLink>
      <div className='sidebar-footer'>
        <div className='row'><span className={`dot ${live ? 'on' : ''}`} />{live ? s.live : s.reconnecting}</div>
        <div className='row'><span className='node-name' title={node}>{node}</span><span className='spacer' /><LangSwitch /></div>
      </div>
    </nav>
  )
}

/**
 * Voce «Primi passi» in cima alla barra laterale (ui/src/pages/FirstSteps.tsx): c'è finché il
 * percorso è aperto (dopo la creazione del team) o mancano i passi necessari, cioè Claude Code
 * collegato e almeno una cartella. «Ho finito» nella pagina la toglie.
 *
 * EN: «First steps» item at the top of the sidebar (ui/src/pages/FirstSteps.tsx): it's there while
 * the path is open (after creating the team) or the required steps are missing, i.e. Claude Code
 * connected and at least one folder. "I'm done" in the page removes it.
 */
function FirstStepsLink () {
  const s = useStrings(S)
  useCurrentTeam()
  const q = useQuery({ queryKey: ['first-steps'], queryFn: api.firstSteps, staleTime: 30_000 })
  if (!q.data) return null
  const state = firstStepsState()
  const done = stepsDone(q.data)
  const required = done[1] && done[2]
  if (state === 'done' || (state !== 'open' && required)) return null
  return <NavLink to='/primi-passi' className={({ isActive }) => `nav-link first-steps ${isActive ? 'active' : ''}`}>{s.firstSteps(done.filter(Boolean).length)}</NavLink>
}
