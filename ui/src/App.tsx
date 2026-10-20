/**
 * @file Ossatura della UI: barra laterale di navigazione + schermata corrente.
 *
 * Routing con HashRouter (URL del tipo /ui/#/inbox): funziona identico nel browser servito dal
 * daemon e nell'app Electron, senza configurare il server per le "rotte" della SPA.
 *
 * Se il nodo non appartiene ancora a un team, al posto delle schermate mostra l'Onboarding.
 * Con più team (B3) il selettore nella barra laterale sceglie su quale team lavorano le schermate
 * (vedi api/team.ts); /team/nuovo aggiunge un team.
 *
 * Home = Nucleo 3D (vista "wow" e navigazione guidata). Le viste 2D servono a scopi specifici
 * (es. Mappa 2D con filtri per autore e tipo).
 */
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api } from './api/client'
import { useLiveEvents } from './api/live'
import { TeamSwitch } from './components/TeamSwitch'
import { ErrorBox } from './components/ui'
import { HelpProvider, useHelp } from './help'
import { defineStrings, LangSwitch, useStrings } from './i18n'
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

/** Testi dell'ossatura (menu, stati di connessione) nelle due lingue. */
const S = defineStrings({
  it: {
    connecting: 'Connessione al nodo…',
    nucleusLoading: 'Accensione del nucleo…',
    nav: { nucleus: 'Nucleo', map: 'Mappa 2D', ask: 'Chiedi', memory: 'Memoria', roots: 'Radici', inbox: 'Inbox', team: 'Team', digest: 'Riepilogo', efficacy: 'Efficacia', dreams: 'Sogni', status: 'Stato', private: 'Registro privato', security: 'Sicurezza', settings: 'Impostazioni', guide: 'Guida' },
    live: 'Aggiornamenti in tempo reale',
    reconnecting: 'Riconnessione…'
  },
  en: {
    connecting: 'Connecting to the node…',
    nucleusLoading: 'Powering up the nucleus…',
    nav: { nucleus: 'Nucleus', map: '2D map', ask: 'Ask', memory: 'Memory', roots: 'Roots', inbox: 'Inbox', team: 'Team', digest: 'Digest', efficacy: 'Efficacy', dreams: 'Dreams', status: 'Status', private: 'Private log', security: 'Security', settings: 'Settings', guide: 'Guide' },
    live: 'Live updates',
    reconnecting: 'Reconnecting…'
  }
})

// Il Nucleo 3D porta con sé three.js: caricato solo quando serve (bundle separato).
const Nucleus = lazy(() => import('./pages/nucleus/Nucleus'))

export function App () {
  const live = useLiveEvents()
  const status = useQuery({ queryKey: ['status'], queryFn: api.status })
  const s = useStrings(S)

  if (status.error) return <div className='centered'><ErrorBox error={status.error} /></div>
  if (!status.data) return <div className='centered muted'>{s.connecting}</div>
  // Primo avvio: la guida serve anche qui (pulsante «?» del modulo)
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
          </Routes>
        </Shell>
      </HelpProvider>
    </HashRouter>
  )
}

/** Argomento della guida per ogni pagina (F1). */
export const PAGE_TOPIC: Record<string, string> = {
  '/': 'views#nucleus', '/mappa': 'views#map', '/memoria': 'memory', '/radici': 'roots', '/inbox': 'inbox',
  '/team': 'team', '/sogni': 'dreams', '/stato': 'status', '/privato': 'private', '/sicurezza': 'security',
  '/impostazioni': 'settings', '/guida': 'overview', '/team/nuovo': 'teams', '/riepilogo': 'digest', '/efficacia': 'efficacy', '/chiedi': 'ask'
}

/** Pagina "Aggiungi un team": a ingresso riuscito si torna alla home, già sul nuovo team. */
function AddTeam () {
  const navigate = useNavigate()
  return <Onboarding adding onDone={() => navigate('/')} />
}

/**
 * Guscio: barra laterale + area principale. Sul Nucleo l'area è a tutto schermo (senza
 * margini) e tutta l'app passa al tema "olografico" scuro, per non spezzare l'effetto.
 */
function Shell ({ children, live, team, node }: { children: React.ReactNode, live: boolean, team: string, node: string }) {
  const { pathname } = useLocation()
  const holo = pathname === '/'
  // F1: guida sull'argomento della pagina corrente
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

/** Barra laterale: marchio, voci di navigazione (con il contatore dell'inbox), stato della connessione. */
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
        <div className='row'><span>{node}</span><span className='spacer' /><LangSwitch /></div>
      </div>
    </nav>
  )
}
