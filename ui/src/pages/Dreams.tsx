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
import { defineStrings, useStrings } from '../i18n'

interface DreamLog { epoch: string, by: string, ts: number, summary: string, stats: Record<string, number> }
interface Archived { id: string, title: string, status: 'superseded' | 'archived', statusReason?: string, ts: number }

const dreamsApi = {
  log: () => call<DreamLog[]>('GET', '/api/dreams'),
  run: () => call<{ summary: string, merged: number, obsolete: number, linked: number, decayed: number }>('POST', '/api/dreams/run'),
  archive: () => call<Archived[]>('GET', '/api/archive'),
  restore: (id: string) => call<{ ok: true }>('POST', `/api/archive/${encodeURIComponent(id)}/restore`)
}

const S = defineStrings({
  it: {
    title: 'Sogni',
    subtitle: 'Il consolidamento periodico del sapere: duplicati fusi, ricordi superati o non più usati archiviati, collegamenti nuovi. Un nodo al giorno sogna per tutto il team.',
    running: 'Sogno in corso…',
    run: 'Sogna ora',
    done: (m: number, o: number, l: number, d: number) => `Sogno completato: ${m} fusi, ${o} superati, ${l} collegati, ${d} decaduti.`,
    diary: 'Diario',
    noDreams: 'Nessun sogno ancora. Il primo avverrà oggi dalle 13, o subito con «Sogna ora».',
    by: 'da',
    stat: { merged: 'fusi', obsolete: 'superati', linked: 'collegati', decayed: 'decaduti' } as Record<string, string>,
    archive: 'Archivio',
    archiveIntro: 'Ricordi usciti dalla ricerca. Restano consultabili e si possono ripristinare.',
    archiveEmpty: 'Archivio vuoto.',
    superseded: 'sostituito',
    archived: 'archiviato',
    restore: 'Ripristina'
  },
  en: {
    title: 'Dreams',
    subtitle: 'The periodic consolidation of knowledge: duplicates merged, outdated or unused memories archived, new links. One node a day dreams for the whole team.',
    running: 'Dreaming…',
    run: 'Dream now',
    done: (m: number, o: number, l: number, d: number) => `Dream completed: ${m} merged, ${o} superseded, ${l} linked, ${d} decayed.`,
    diary: 'Diary',
    noDreams: 'No dreams yet. The first one will happen today from 1 pm, or right away with “Dream now”.',
    by: 'by',
    stat: { merged: 'merged', obsolete: 'superseded', linked: 'linked', decayed: 'decayed' } as Record<string, string>,
    archive: 'Archive',
    archiveIntro: 'Memories removed from search. They can still be read and restored.',
    archiveEmpty: 'The archive is empty.',
    superseded: 'superseded',
    archived: 'archived',
    restore: 'Restore'
  }
})

export function Dreams () {
  const client = useQueryClient()
  const s = useStrings(S)
  const log = useQuery({ queryKey: ['dreams'], queryFn: dreamsApi.log })
  const archive = useQuery({ queryKey: ['archive'], queryFn: dreamsApi.archive })
  const refresh = () => ['dreams', 'archive', 'memories', 'graph'].forEach((k) => void client.invalidateQueries({ queryKey: [k] }))
  const run = useMutation({ mutationFn: dreamsApi.run, onSuccess: refresh })
  const restore = useMutation({ mutationFn: dreamsApi.restore, onSuccess: refresh })

  return (
    <>
      <PageHeader help='dreams'
        title={s.title}
        subtitle={s.subtitle}
        actions={<button className='btn primary' disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? s.running : s.run}</button>}
      />
      <div className='stack'>
        <ErrorBox error={run.error} />
        {run.data && <div className='notice ok'>{s.done(run.data.merged, run.data.obsolete, run.data.linked, run.data.decayed)}</div>}

        <Card help='dreams#phases' title={s.diary}>
          <ErrorBox error={log.error} />
          {log.data?.length === 0 && <Empty>{s.noDreams}</Empty>}
          <div className='list'>
            {log.data?.map((d) => (
              <div key={d.epoch} className='list-item'>
                <div className='row'>
                  <strong>{d.epoch}</strong>
                  <span className='muted small'>{dateTime(d.ts)} · {s.by} <span className='mono'>{short(d.by)}</span></span>
                  <span className='spacer' />
                  {Object.entries(d.stats).filter(([k, v]) => v > 0 && k !== 'examined' && k !== 'calls').map(([k, v]) => (
                    <span key={k} className='badge accent'>{s.stat[k] ?? k}: {v}</span>
                  ))}
                </div>
                <div className='small' style={{ whiteSpace: 'pre-line', marginTop: 4 }}>{d.summary}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card help='dreams#archive' title={s.archive}>
          <p className='muted' style={{ marginTop: 0 }}>{s.archiveIntro}</p>
          <ErrorBox error={archive.error ?? restore.error} />
          {archive.data?.length === 0 && <Empty>{s.archiveEmpty}</Empty>}
          <div className='list'>
            {archive.data?.map((m) => (
              <div key={m.id} className='list-item row'>
                <span className={`badge ${m.status === 'superseded' ? 'accent' : 'warn'}`}>{m.status === 'superseded' ? s.superseded : s.archived}</span>
                <div style={{ flex: 1 }}>
                  <div>{m.title}</div>
                  <div className='small muted'>{m.statusReason}</div>
                </div>
                <button className='btn small' onClick={() => restore.mutate(m.id)}>{s.restore}</button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  )
}
