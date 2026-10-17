/**
 * @file Componenti di base riusati da tutte le schermate.
 * Volutamente semplici: niente libreria di componenti, solo classi di styles.css.
 */
import { type ReactNode, useState } from 'react'
import ReactMarkdown from 'react-markdown'

/** Intestazione di pagina con titolo e sottotitolo. */
export function PageHeader ({ title, subtitle, actions }: { title: string, subtitle?: ReactNode, actions?: ReactNode }) {
  return (
    <div className='page-header row'>
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className='spacer' />
      {actions}
    </div>
  )
}

/** Riquadro con titolo opzionale. */
export function Card ({ title, children, actions }: { title?: string, children: ReactNode, actions?: ReactNode }) {
  return (
    <section className='card'>
      {(title || actions) && (
        <div className='row' style={{ marginBottom: 10 }}>
          {title && <h2 style={{ margin: 0 }}>{title}</h2>}
          <div className='spacer' />
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

/**
 * Markdown dei ricordi. IMPORTANTE: react-markdown NON esegue HTML grezzo per impostazione
 * predefinita. I ricordi arrivano da altri nodi del team: rendere HTML arbitrario permetterebbe
 * a un nodo malevolo di eseguire script nella UI (dove c'è il token dell'API locale).
 */
export function Markdown ({ text }: { text: string }) {
  return (
    <div className='markdown'>
      <ReactMarkdown
        components={{
          // Link aperti fuori dall'app, mai dentro la finestra della UI.
          a: ({ href, children }) => <a href={href} target='_blank' rel='noreferrer noopener'>{children}</a>
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

/** Messaggio d'errore leggibile (gli errori dell'API hanno già un testo per l'utente). */
export function ErrorBox ({ error }: { error: unknown }) {
  if (!error) return null
  return <div className='notice error'>{(error as Error).message ?? String(error)}</div>
}

/** Stato vuoto: testo centrato e smorzato. */
export function Empty ({ children }: { children: ReactNode }) {
  return <div className='muted' style={{ padding: '18px 4px' }}>{children}</div>
}

/**
 * Pulsante che chiede conferma prima di un'azione irreversibile o "pubblica" (espulsioni,
 * modifiche alla configurazione dell'utente). Al primo clic mostra Conferma/Annulla.
 */
export function ConfirmButton ({ label, confirmLabel = 'Conferma', onConfirm, danger, disabled }: {
  label: string, confirmLabel?: string, onConfirm: () => void, danger?: boolean, disabled?: boolean
}) {
  const [asking, setAsking] = useState(false)
  if (!asking) return <button className={`btn small ${danger ? 'danger' : ''}`} disabled={disabled} onClick={() => setAsking(true)}>{label}</button>
  return (
    <span className='row'>
      <button className={`btn small ${danger ? 'danger' : 'primary'}`} onClick={() => { setAsking(false); onConfirm() }}>{confirmLabel}</button>
      <button className='btn small' onClick={() => setAsking(false)}>Annulla</button>
    </span>
  )
}

/** Barra di avanzamento (es. budget LLM). Diventa gialla oltre il 90%. */
export function Meter ({ value, max }: { value: number, max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 100
  return <div className={`meter ${pct >= 90 ? 'warn' : ''}`}><div style={{ width: `${pct}%` }} /></div>
}
