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
import { Card, Empty, ErrorBox, PageHeader } from '../components/ui'
import { MemoryPanel } from '../components/MemoryPanel'
import { dateTime, KIND_LABEL, short } from '../format'
import { defineStrings, useStrings } from '../i18n'

const S = defineStrings({
  it: {
    title: 'Memoria del team',
    subtitle: 'Soluzioni, decisioni, gotcha e procedure condivise da tutti i nodi.',
    close: 'Chiudi',
    newMemory: 'Nuovo ricordo',
    searchPlaceholder: 'Cerca: es. build out of memory angular',
    noResults: 'Nessun ricordo trovato.',
    empty: 'Il team non ha ancora ricordi.',
    root: 'Radice',
    selectOne: 'Seleziona un ricordo per leggerlo.',
    compose: {
      title: 'Proponi un ricordo al team',
      intro: 'Il ricordo passa dal filtro privacy prima di arrivare ai colleghi: può essere pubblicato, finire in inbox per una tua verifica o restare privato.',
      titleLabel: 'Titolo',
      titlePlaceholder: 'Una riga autoesplicativa',
      body: 'Contenuto (Markdown)',
      bodyPlaceholder: 'Il cosa e soprattutto il perché',
      kind: 'Tipo',
      tags: 'Tag (separati da virgola)',
      duplicate: 'Già presente nella memoria del team.',
      published: 'Pubblicato nel team.',
      inbox: (r: string) => `Messo in inbox per una verifica: ${r}`,
      private: (r: string) => `Non pubblicato, trattenuto come privato: ${r}`,
      checking: 'Verifica in corso…',
      propose: 'Proponi'
    }
  },
  en: {
    title: 'Team memory',
    subtitle: 'Solutions, decisions, gotchas and procedures shared by every node.',
    close: 'Close',
    newMemory: 'New memory',
    searchPlaceholder: 'Search: e.g. angular build out of memory',
    noResults: 'No memory found.',
    empty: 'The team has no memories yet.',
    root: 'Root',
    selectOne: 'Select a memory to read it.',
    compose: {
      title: 'Propose a memory to the team',
      intro: 'The memory goes through the privacy filter before reaching your colleagues: it may be published, go to your inbox for a check, or stay private.',
      titleLabel: 'Title',
      titlePlaceholder: 'A self-explanatory line',
      body: 'Content (Markdown)',
      bodyPlaceholder: 'The what and, above all, the why',
      kind: 'Kind',
      tags: 'Tags (comma separated)',
      duplicate: 'Already in the team memory.',
      published: 'Published to the team.',
      inbox: (r: string) => `Sent to the inbox for a check: ${r}`,
      private: (r: string) => `Not published, kept private: ${r}`,
      checking: 'Checking…',
      propose: 'Propose'
    }
  }
})

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
  const s = useStrings(S)
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
        title={s.title}
        subtitle={s.subtitle}
        actions={<button className='btn primary' onClick={() => setComposing(!composing)}>{composing ? s.close : s.newMemory}</button>}
      />
      {composing && <Compose onDone={() => setComposing(false)} />}
      <div className='split' style={{ marginTop: composing ? 16 : 0 }}>
        <div className='stack'>
          <input autoFocus placeholder={s.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
          <ErrorBox error={list.error} />
          <div className='card' style={{ padding: 6 }}>
            {list.data?.length === 0 && <Empty>{q ? s.noResults : s.empty}</Empty>}
            <div className='list'>
              {list.data?.map((h) => (
                <div key={h.id} className={`list-item clickable ${selected?.id === h.id ? 'selected' : ''}`} onClick={() => setSelected(h)}>
                  <div style={{ fontWeight: 600 }}>{h.root && <span className={`root-mark ${h.root.status}`} title={s.root}>◆ </span>}{h.title}</div>
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
            : <Empty>{s.selectOne}</Empty>}
        </div>
      </div>
    </>
  )
}

/** Modulo per proporre un ricordo. Mostra l'esito: pubblicato, in inbox o privato (D6). */
function Compose ({ onDone }: { onDone: () => void }) {
  const s = useStrings(S)
  const c = s.compose
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState('fact')
  const [tags, setTags] = useState('')
  const save = useMutation({
    mutationFn: () => api.remember({ title, body, kind, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })
  })
  const r: ExplicitOutcome | undefined = save.data

  return (
    <Card title={c.title}>
      <div className='stack'>
        <div className='notice small'>{c.intro}</div>
        <div><label>{c.titleLabel}</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={c.titlePlaceholder} /></div>
        <div><label>{c.body}</label><textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={c.bodyPlaceholder} /></div>
        <div className='row'>
          <div style={{ width: 180 }}>
            <label>{c.kind}</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className='spacer'><label>{c.tags}</label><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder='angular, ci' /></div>
        </div>
        <ErrorBox error={save.error} />
        {r?.outcome === 'team' && <div className='notice ok'>{r.duplicate ? c.duplicate : c.published}</div>}
        {r?.outcome === 'inbox' && <div className='notice warn'>{c.inbox(r.reason)}</div>}
        {r?.outcome === 'private' && <div className='notice warn'>{c.private(r.reason)}</div>}
        <div className='row'>
          <button className='btn primary' disabled={save.isPending || title.trim().length < 3 || !body.trim()} onClick={() => save.mutate()}>
            {save.isPending ? c.checking : c.propose}
          </button>
          <button className='btn' onClick={onDone}>{s.close}</button>
        </div>
      </div>
    </Card>
  )
}
