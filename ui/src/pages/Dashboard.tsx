/**
 * @file Stato del nodo: tutto a colpo d'occhio (attività 3.4).
 * Nodo e team, rete, sapere, LLM e budget, coda di ingestione, inbox, cartelle abilitate.
 * Tutti i dati si aggiornano da soli grazie agli eventi SSE (api/live.ts).
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Card, ErrorBox, Meter, PageHeader } from '../components/ui'
import { short } from '../format'

export function Dashboard () {
  const status = useQuery({ queryKey: ['status'], queryFn: api.status })
  const ingest = useQuery({ queryKey: ['ingest'], queryFn: api.ingestStatus })
  const s = status.data
  const i = ingest.data

  return (
    <>
      <PageHeader title='Stato del nodo' subtitle={s?.team ? `Team «${s.team.name}»` : undefined} />
      <ErrorBox error={status.error ?? ingest.error} />
      {s && (
        <div className='grid'>
          <Card title='Questo nodo'>
            <dl className='kv'>
              <dt>Nome</dt><dd>{s.nodeName}</dd>
              <dt>Chiave</dt><dd className='mono'>{short(s.nodeKey)}</dd>
              <dt>Ruolo</dt>
              <dd>
                <span className={`badge ${s.role === 'admin' ? 'accent' : ''}`}>{s.role ?? '–'}</span>{' '}
                {s.indexer && <span className='badge'>indexer</span>}{' '}
                {!s.writable && <span className='badge danger'>non writer</span>}
              </dd>
            </dl>
          </Card>

          <Card title='Rete'>
            <div className='row'>
              <span className={`dot ${s.peers > 0 ? 'on' : ''}`} />
              <span className='stat'>{s.peers}</span>
              <span className='muted'>peer connessi</span>
            </div>
            <p className='muted small' style={{ marginBottom: 0 }}>
              {s.peers === 0 ? 'Nessun altro membro online: il nodo riprova da solo ogni pochi secondi.' : 'Sincronizzazione attiva.'}
            </p>
            <p style={{ marginBottom: 0 }}><Link to='/team'>{s.members} membri attivi →</Link></p>
          </Card>

          <Card title='Sapere del team'>
            <div className='stat'>{s.memories}</div>
            <div className='muted'>ricordi su questo nodo</div>
            <p style={{ marginBottom: 0 }}><Link to='/memoria'>Cerca →</Link></p>
          </Card>

          <Card title='Intelligenza (LLM)'>
            {i?.llm
              ? (
                <div className='stack'>
                  <div className='row'>
                    <span className={`dot ${i.llm.available ? 'on' : ''}`} />
                    <span>{i.llm.adapter}</span>
                    <span className='muted'>{i.llm.available ? 'disponibile' : 'NON disponibile'}</span>
                  </div>
                  <div>
                    <div className='row small'><span>Chiamate di oggi</span><span className='spacer' /><span>{i.llm.budget.used} / {i.llm.budget.limit}</span></div>
                    <Meter value={i.llm.budget.used} max={i.llm.budget.limit} />
                  </div>
                </div>
                )
              : <p className='muted'>Nessun LLM configurato: i casi dubbi vanno tutti in inbox.</p>}
          </Card>

          <Card title='Raccolta automatica'>
            <div className='row'>
              <span className='badge'>in coda: {i?.jobs.pending ?? 0}</span>
              <span className='badge accent'>completati: {i?.jobs.done ?? 0}</span>
              {(i?.jobs.failed ?? 0) > 0 && <span className='badge danger'>falliti: {i?.jobs.failed}</span>}
            </div>
            <p className='muted small'>
              {i?.watched.length ? `${i.watched.length} cartelle abilitate.` : 'Nessuna cartella abilitata.'}{' '}
              <Link to='/impostazioni'>Gestisci →</Link>
            </p>
          </Card>

          <Card title='Inbox'>
            <div className='stat'>{i?.inbox ?? 0}</div>
            <div className='muted'>ricordi in attesa di una tua decisione</div>
            {(i?.inbox ?? 0) > 0 && <p style={{ marginBottom: 0 }}><Link to='/inbox'>Decidi →</Link></p>}
          </Card>
        </div>
      )}
    </>
  )
}
