/**
 * @file Punto d'ingresso della UI: ottiene il token (api/auth.ts), poi monta l'app.
 * Se il token manca (pagina aperta senza `micelio ui` e fuori dall'app desktop) mostra come entrare.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initAuth } from './api/auth'
import { App } from './App'
import { defineStrings, detectLang, I18nProvider } from './i18n'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

// Le query non si ricaricano "da sole" a intervalli: ci pensano gli eventi SSE (api/live.ts).
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: true, retry: 1 } }
})

/** Messaggi mostrati prima dell'app (accesso). La lingua è quella salvata o del sistema. */
const S = defineStrings({
  it: { noToken: 'Apri l’interfaccia con il comando `micelio ui` (oppure usa l’app desktop): così la pagina riceve l’accesso al tuo nodo.', authFailed: 'Accesso non riuscito' },
  en: { noToken: 'Open the interface with the `micelio ui` command (or use the desktop app): this gives the page access to your node.', authFailed: 'Access failed' }
})

function Message ({ title, text }: { title: string, text: string }) {
  return (
    <div className='centered'>
      <h1>{title}</h1>
      <p className='muted'>{text}</p>
    </div>
  )
}

// Lingua decisa una volta all'avvio (salvata o del sistema); poi la gestisce I18nProvider.
const lang = detectLang()
initAuth().then(
  (token) => {
    root.render(
      <StrictMode>
        <I18nProvider initial={lang}>
          {token
            ? <QueryClientProvider client={queryClient}><App /></QueryClientProvider>
            : <Message title='Micelio' text={S[lang].noToken} />}
        </I18nProvider>
      </StrictMode>
    )
  },
  (err: Error) => root.render(<Message title={S[lang].authFailed} text={err.message} />)
)
