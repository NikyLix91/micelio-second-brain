/**
 * @file Ossatura della UI: barra laterale di navigazione + schermata corrente.
 *
 * Routing con HashRouter (URL del tipo /ui/#/inbox): funziona identico nel browser servito dal
 * daemon e nell'app Electron, senza configurare il server per le "rotte" della SPA.
 *
 * Se il nodo non appartiene ancora a un team, al posto delle schermate mostra l'Onboarding.
 *
 * Home = Nucleo 3D (vista "wow" e navigazione guidata). Le viste 2D servono a scopi specifici
 * (es. Mappa 2D con filtri per autore e tipo).
 */
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { api } from './api/client'
import { useLiveEvents } from './api/live'
import { ErrorBox } from './components/ui'
import { Constellation } from './pages/Constellation'
import { Dashboard } from './pages/Dashboard'
import { Inbox } from './pages/Inbox'
import { Memory } from './pages/Memory'
import { Onboarding } from './pages/Onboarding'
import { Private } from './pages/Private'
import { Settings } from './pages/Settings'
import { Team } from './pages/Team'
import { Dreams } from './pages/Dreams'

// Il Nucleo 3D porta con sé three.js: caricato solo quando serve (bundle separato).
const Nucleus = lazy(() => import('./pages/nucleus/Nucleus'))

export function App () {
  const live = useLiveEvents()
  const status = useQuery({ queryKey: ['status'], queryFn: api.status })

  if (status.error) return <div className='centered'><ErrorBox error={status.error} /></div>
  if (!status.data) return <div className='centered muted'>Connessione al nodo…</div>
  if (!status.data.configured) return <Onboarding />

  return (
    <HashRouter>
        <Shell live={live} team={status.data.team?.name ?? ''} node={status.data.nodeName ?? ''}>
          <Routes>
            <Route path='/' element={<Suspense fallback={<div className='hud hud-center'>Accensione del nucleo…</div>}><Nucleus /></Suspense>} />
            <Route path='/mappa' element={<Constellation />} />
            <Route path='/stato' element={<Dashboard />} />
            <Route path='/memoria' element={<Memory />} />
            <Route path='/inbox' element={<Inbox />} />
            <Route path='/team' element={<Team />} />
            <Route path='/sogni' element={<Dreams />} />
            <Route path='/privato' element={<Private />} />
            <Route path='/impostazioni' element={<Settings />} />
          </Routes>
        </Shell>
    </HashRouter>
  )
}

/**
 * Guscio: barra laterale + area principale. Sul Nucleo l'area è a tutto schermo (senza
 * margini) e tutta l'app passa al tema "olografico" scuro, per non spezzare l'effetto.
 */
function Shell ({ children, live, team, node }: { children: React.ReactNode, live: boolean, team: string, node: string }) {
  const { pathname } = useLocation()
  const holo = pathname === '/'
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
  return (
    <nav className='sidebar'>
      <div className='brand'>
        <span aria-hidden>🍄</span>
        <div>Micelio<small>{team}</small></div>
      </div>
      <NavLink to='/' end className={link}>Nucleo</NavLink>
      <NavLink to='/mappa' className={link}>Mappa 2D</NavLink>
      <NavLink to='/memoria' className={link}>Memoria</NavLink>
      <NavLink to='/inbox' className={link}>Inbox {inbox > 0 && <span className='count'>{inbox}</span>}</NavLink>
      <NavLink to='/team' className={link}>Team</NavLink>
      <NavLink to='/sogni' className={link}>Sogni</NavLink>
      <NavLink to='/stato' className={link}>Stato</NavLink>
      <NavLink to='/privato' className={link}>Registro privato</NavLink>
      <NavLink to='/impostazioni' className={link}>Impostazioni</NavLink>
      <div className='sidebar-footer'>
        <div className='row'><span className={`dot ${live ? 'on' : ''}`} />{live ? 'Aggiornamenti in tempo reale' : 'Riconnessione…'}</div>
        <div>{node}</div>
      </div>
    </nav>
  )
}
