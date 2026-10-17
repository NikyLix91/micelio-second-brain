/**
 * @file Sogni: il diario del dreaming e l'archivio (Fase 6, DESIGN §10).
 *
 * - Diario: ogni sogno del team (chi l'ha fatto, quando, cosa ha fuso/archiviato/collegato).
 * - "Sogna ora": avvia un consolidamento su questo nodo (usa il LLM e il suo budget).
 * - Archivio: ricordi sostituiti da una fusione o archiviati (decaduti, superati). Niente è
 *   perso: ogni ricordo si può ripristinare.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { call } from '../api/client'
import { Card, Empty, ErrorBox, PageHeader } from '../components/ui'
import { dateTime, short } from '../format'

interface DreamLog { epoch: string, by: string, ts: number, summary: string, stats: Record<string, number> }
interface Archived { id: string, title: string, status: 'superseded' | 'archived', statusReason?: string, ts: number }

const dreamsApi = {
  log: () => call<DreamLog[]>('GET', '/api/dreams'),
  run: () => call<{ summary: string, merged: number, obsolete: number, linked: number, decayed: number }>('POST', '/api/dreams/run'),
  archive: () => call<Archived[]>('GET', '/api/archive'),
  restore: (id: string) => call<{ ok: true }>('POST', `/api/archive/${encodeURIComponent(id)}/restore`)
}

export function Dreams () {
  const client = useQueryClient()
  const log = useQuery({ queryKey: ['dreams'], queryFn: dreamsApi.log })
  const archive = useQuery({ queryKey: ['archive'], queryFn: dreamsApi.archive })
  const refresh = () => ['dreams', 'archive', 'memories', 'graph'].forEach((k) => void client.invalidateQueries({ queryKey: [k] }))
  const run = useMutation({ mutationFn: dreamsApi.run, onSuccess: refresh })
  const restore = useMutation({ mutationFn: dreamsApi.restore, onSuccess: refresh })

  return (
    <>
      <PageHeader
        title='Sogni'
        subtitle='Il consolidamento periodico del sapere: duplicati fusi, ricordi superati o non più usati archiviati, collegamenti nuovi. Un nodo al giorno sogna per tutto il team.'
        actions={<button className='btn primary' disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? 'Sogno in corso…' : 'Sogna ora'}</button>}
      />
      <div className='stack'>
        <ErrorBox error={run.error} />
        {run.data && <div className='notice ok'>Sogno completato: {run.data.merged} fusi, {run.data.obsolete} superati, {run.data.linked} collegati, {run.data.decayed} decaduti.</div>}

        <Card title='Diario'>
          <ErrorBox error={log.error} />
          {log.data?.length === 0 && <Empty>Nessun sogno ancora. Il primo avverrà oggi dalle 13, o subito con «Sogna ora».</Empty>}
          <div className='list'>
            {log.data?.map((d) => (
              <div key={d.epoch} className='list-item'>
                <div className='row'>
                  <strong>{d.epoch}</strong>
                  <span className='muted small'>{dateTime(d.ts)} · da <span className='mono'>{short(d.by)}</span></span>
                  <span className='spacer' />
                  {Object.entries(d.stats).filter(([k, v]) => v > 0 && k !== 'examined' && k !== 'calls').map(([k, v]) => (
                    <span key={k} className='badge accent'>{({ merged: 'fusi', obsolete: 'superati', linked: 'collegati', decayed: 'decaduti' } as Record<string, string>)[k] ?? k}: {v}</span>
                  ))}
                </div>
                <div className='small' style={{ whiteSpace: 'pre-line', marginTop: 4 }}>{d.summary}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title='Archivio'>
          <p className='muted' style={{ marginTop: 0 }}>Ricordi usciti dalla ricerca. Restano consultabili e si possono ripristinare.</p>
          <ErrorBox error={archive.error ?? restore.error} />
          {archive.data?.length === 0 && <Empty>Archivio vuoto.</Empty>}
          <div className='list'>
            {archive.data?.map((m) => (
              <div key={m.id} className='list-item row'>
                <span className={`badge ${m.status === 'superseded' ? 'accent' : 'warn'}`}>{m.status === 'superseded' ? 'sostituito' : 'archiviato'}</span>
                <div style={{ flex: 1 }}>
                  <div>{m.title}</div>
                  <div className='small muted'>{m.statusReason}</div>
                </div>
                <button className='btn small' onClick={() => restore.mutate(m.id)}>Ripristina</button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  )
}
