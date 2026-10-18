/**
 * @file Stato del nodo: tutto a colpo d'occhio (attività 3.4).
 * Nodo e team, rete, sapere, LLM e budget, coda di ingestione, inbox, cartelle abilitate,
 * spazio occupato (totale e quota di ciascun membro).
 * Tutti i dati si aggiornano da soli grazie agli eventi SSE (api/live.ts).
 */
import { useQuery } from '@tanstack/react-query'
import { Fragment, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { api, type StorageReport } from '../api/client'
import { Card, ErrorBox, Meter, PageHeader } from '../components/ui'
import { bytes, percent, short } from '../format'
import { authorColor, registerAuthors } from './colors'

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

          {/* Occupa tutta la riga: la ripartizione per membro ha bisogno di spazio */}
          <div style={{ gridColumn: '1 / -1' }}><StorageCard /></div>
        </div>
      )}
    </>
  )
}

/** Etichette dei componenti su disco, nell'ordine in cui si mostrano. */
const DISK_PARTS: { key: keyof StorageReport['disk'], label: string, hint: string }[] = [
  { key: 'log', label: 'Log del team', hint: 'feed replicati di tutti i membri, cifrati' },
  { key: 'index', label: 'Indice di ricerca', hint: 'parole chiave e vettori; si ricostruisce dal log' },
  { key: 'private', label: 'Archivio privato', hint: 'inbox, registro, coda: non lascia mai il PC' },
  { key: 'cache', label: 'Documenti scaricati', hint: 'originali chiesti ai colleghi, tenuti 30 giorni' },
  { key: 'export', label: 'Export Markdown', hint: 'copia in sola lettura' }
]

/**
 * Spazio occupato dal sapere: totale su questo disco, ripartizione per componente e, soprattutto,
 * quanto del log del team viene da ciascun membro. Ogni nodo replica tutto, quindi la
 * ripartizione per membro è la stessa su ogni PC del team.
 */
export function StorageCard () {
  const storage = useQuery({ queryKey: ['storage'], queryFn: api.storage })
  const r = storage.data
  // Stessi colori di Nucleo e Mappa: lì il registro contiene gli autori di almeno un ricordo.
  useMemo(() => { if (r) registerAuthors(r.members.filter((m) => m.memories > 0).map((m) => m.key)) }, [r])
  if (!r) return <Card title='Spazio occupato'><ErrorBox error={storage.error} /></Card>
  const shown = r.members.filter((m) => m.bytes > 0)

  return (
    <Card title='Spazio occupato'>
      <div className='row' style={{ alignItems: 'baseline' }}>
        <span className='stat'>{bytes(r.disk.total)}</span>
        <span className='muted'>su questo disco · log del team {bytes(r.teamLogBytes)}</span>
      </div>

      <h4 style={{ margin: '14px 0 6px' }}>Provenienza del sapere per membro</h4>
      {shown.length === 0
        ? <p className='muted small'>Nessun dato ancora: il log del team è vuoto.</p>
        : (
          <>
            {/* Barra a segmenti: larghezza = quota del log del team */}
            <div className='storage-bar' role='img' aria-label='Quota del log del team per membro'>
              {shown.map((m) => (
                <div key={m.key} title={`${m.name}: ${percent(m.share)}`} style={{ width: `${m.share * 100}%`, background: authorColor(m.key) }} />
              ))}
            </div>
            <table className='small' style={{ marginTop: 8 }}>
              <thead>
                <tr><th>Membro</th><th className='num'>Quota</th><th className='num'>Log</th><th className='num'>Ricordi attivi</th><th className='num'>Testo dei ricordi</th></tr>
              </thead>
              <tbody>
                {r.members.map((m) => (
                  <tr key={m.key} className={m.removed ? 'muted' : ''}>
                    <td><span className='dot' style={{ background: authorColor(m.key), marginRight: 6 }} />{m.name}{m.removed && ' (uscito)'}</td>
                    <td className='num'><strong>{percent(m.share)}</strong></td>
                    <td className='num'>{bytes(m.bytes)}</td>
                    <td className='num'>{m.memories}</td>
                    <td className='num'>{bytes(m.memoryBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className='muted small' style={{ marginBottom: 0 }}>
              La quota è la parte del log del team scritta da ciascun membro: ricordi, ma anche voti, uso e sogni.
              È uguale su ogni PC, perché ogni nodo conserva tutto.
            </p>
          </>
          )}

      <h4 style={{ margin: '14px 0 6px' }}>Su questo disco</h4>
      <dl className='kv small' style={{ margin: 0 }}>
        {DISK_PARTS.map((p) => (
          <Fragment key={p.key}>
            <dt>{p.label}</dt>
            <dd>{bytes(r.disk[p.key])} <span className='muted'>· {p.hint}</span></dd>
          </Fragment>
        ))}
      </dl>
    </Card>
  )
}
