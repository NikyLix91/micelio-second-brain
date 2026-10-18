/**
 * @file Memoria: ricerca nel sapere del team e dettaglio dei ricordi (attività 3.5).
 *
 * Senza ricerca mostra gli ultimi ricordi arrivati. La ricerca parte mentre si scrive, con un
 * piccolo ritardo (debounce) per non interrogare il daemon a ogni tasto.
 * C'è anche un modulo per proporre un nuovo ricordo: passa dal filtro privacy come da CLI/MCP.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, type ExplicitOutcome, type RecallHit } from '../api/client'
import { Card, Empty, ErrorBox, Markdown, PageHeader } from '../components/ui'
import { MemoryPanel } from '../components/MemoryPanel'
import { dateTime, KIND_LABEL, short } from '../format'

/** Restituisce `value` solo dopo che è rimasto fermo per `ms` millisecondi. */
function useDebounced<T> (value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function Memory () {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<RecallHit | null>(null)
  const [composing, setComposing] = useState(false)
  const q = useDebounced(query.trim())

  // Una sola query con chiave ['memories', q]: gli eventi "memories" invalidano tutte le varianti.
  const list = useQuery({
    queryKey: ['memories', q],
    queryFn: () => (q.length >= 2 ? api.search(q) : api.recent())
  })

  return (
    <>
      <PageHeader
        title='Memoria del team'
        subtitle='Soluzioni, decisioni, gotcha e procedure condivise da tutti i nodi.'
        actions={<button className='btn primary' onClick={() => setComposing(!composing)}>{composing ? 'Chiudi' : 'Nuovo ricordo'}</button>}
      />
      {composing && <Compose onDone={() => setComposing(false)} />}
      <div className='split' style={{ marginTop: composing ? 16 : 0 }}>
        <div className='stack'>
          <input autoFocus placeholder='Cerca: es. build out of memory angular' value={query} onChange={(e) => setQuery(e.target.value)} />
          <ErrorBox error={list.error} />
          <div className='card' style={{ padding: 6 }}>
            {list.data?.length === 0 && <Empty>{q ? 'Nessun ricordo trovato.' : 'Il team non ha ancora ricordi.'}</Empty>}
            <div className='list'>
              {list.data?.map((h) => (
                <div key={h.id} className={`list-item clickable ${selected?.id === h.id ? 'selected' : ''}`} onClick={() => setSelected(h)}>
                  <div style={{ fontWeight: 600 }}>{h.root && <span className={`root-mark ${h.root.status}`} title='Radice'>◆ </span>}{h.title}</div>
                  <div className='row small muted'>
                    <span className='badge'>{KIND_LABEL[h.kind] ?? h.kind}</span>
                    <span>{h.authorName ?? short(h.author)}</span>
                    <span>· {dateTime(h.ts)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div>
          {selected
            ? <MemoryPanel node={selected} onClose={() => setSelected(null)} />
            : <Empty>Seleziona un ricordo per leggerlo.</Empty>}
        </div>
      </div>
    </>
  )
}

/** Modulo per proporre un ricordo. Mostra l'esito: pubblicato, in inbox o privato (D6). */
function Compose ({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState('fact')
  const [tags, setTags] = useState('')
  const save = useMutation({
    mutationFn: () => api.remember({ title, body, kind, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })
  })
  const r: ExplicitOutcome | undefined = save.data

  return (
    <Card title='Proponi un ricordo al team'>
      <div className='stack'>
        <div className='notice small'>
          Il ricordo passa dal filtro privacy prima di arrivare ai colleghi: può essere pubblicato, finire in inbox per una tua verifica o restare privato.
        </div>
        <div><label>Titolo</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder='Una riga autoesplicativa' /></div>
        <div><label>Contenuto (Markdown)</label><textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder='Il cosa e soprattutto il perché' /></div>
        <div className='row'>
          <div style={{ width: 180 }}>
            <label>Tipo</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className='spacer'><label>Tag (separati da virgola)</label><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder='angular, ci' /></div>
        </div>
        <ErrorBox error={save.error} />
        {r?.outcome === 'team' && <div className='notice ok'>{r.duplicate ? 'Già presente nella memoria del team.' : 'Pubblicato nel team.'}</div>}
        {r?.outcome === 'inbox' && <div className='notice warn'>Messo in inbox per una verifica: {r.reason}</div>}
        {r?.outcome === 'private' && <div className='notice warn'>Non pubblicato, trattenuto come privato: {r.reason}</div>}
        <div className='row'>
          <button className='btn primary' disabled={save.isPending || title.trim().length < 3 || !body.trim()} onClick={() => save.mutate()}>
            {save.isPending ? 'Verifica in corso…' : 'Proponi'}
          </button>
          <button className='btn' onClick={onDone}>Chiudi</button>
        </div>
      </div>
    </Card>
  )
}
