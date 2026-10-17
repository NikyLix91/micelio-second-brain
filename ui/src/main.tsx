/**
 * @file Punto d'ingresso della UI: ottiene il token (api/auth.ts), poi monta l'app.
 * Se il token manca (pagina aperta senza `micelio ui` e fuori dall'app desktop) mostra come entrare.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initAuth } from './api/auth'
import { App } from './App'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

// Le query non si ricaricano "da sole" a intervalli: ci pensano gli eventi SSE (api/live.ts).
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: true, retry: 1 } }
})

function Message ({ title, text }: { title: string, text: string }) {
  return (
    <div className='centered'>
      <h1>{title}</h1>
      <p className='muted'>{text}</p>
    </div>
  )
}

initAuth().then(
  (token) => {
    root.render(
      <StrictMode>
        {token
          ? <QueryClientProvider client={queryClient}><App /></QueryClientProvider>
          : <Message title='Micelio' text='Apri l’interfaccia con il comando `micelio ui` (oppure usa l’app desktop): così la pagina riceve l’accesso al tuo nodo.' />}
      </StrictMode>
    )
  },
  (err: Error) => root.render(<Message title='Accesso non riuscito' text={err.message} />)
)
