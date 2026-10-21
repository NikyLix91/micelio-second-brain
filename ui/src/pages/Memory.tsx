/**
 * @file Memoria: ricerca nel sapere del team e dettaglio dei ricordi (attività 3.5).
 *
 * EN: Memory: search in the team's knowledge and memory detail (task 3.5).
 *
 * Senza ricerca mostra gli ultimi ricordi arrivati. La ricerca parte mentre si scrive, con un
 * piccolo ritardo (debounce) per non interrogare il daemon a ogni tasto.
 * C'è anche un modulo per proporre un nuovo ricordo: passa dal filtro privacy come da CLI/MCP.
 *
 * EN: Without a search it shows the latest memories. The search starts while typing, with a
 * small delay (debounce) so the daemon is not queried on every keystroke.
 * There is also a form to propose a new memory: it goes through the privacy filter as from CLI/MCP.
 *
 * B4: filtri «Personali» (ricordi che restano su questo PC) e «Codice cambiato» (il codice citato è
 * cambiato dopo il ricordo); il modulo può salvare un ricordo solo per sé.
 *
 * EN: B4: «Personal» filters (memories that stay on this PC) and «Code changed» (the cited code
 * changed after the memory); the form can save a memory just for yourself.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type ExplicitOutcome, type RecallHit } from '../api/client'
import { Card, Empty, ErrorBox, PageHeader } from '../components/ui'
import { MemoryPanel } from '../components/MemoryPanel'
import { dateTime, KIND_LABEL, short } from '../format'
import { HelpButton } from '../help'
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
    filters: { all: 'Tutti', personal: '🔒 Personali', stale: '⚠ Codice cambiato' },
    personalBadge: 'personale',
    staleBadge: 'codice cambiato',
    noPersonal: 'Nessun ricordo personale. Salvane uno con «Nuovo ricordo» → «Solo per me».',
    noStale: 'Nessun ricordo con il codice cambiato (o nessun repository su questo PC).',
    recheck: 'Ricontrolla i repository',
    rechecked: (n: number, st: number) => `Controllati ${n} ricordi con riferimenti al codice: ${st} con codice cambiato.`,
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
      propose: 'Proponi',
      scopeTeam: 'Per il team',
      scopePersonal: 'Solo per me (resta su questo PC)',
      savePersonal: 'Salva per me',
      savedPersonal: 'Salvato come ricordo personale: lo trovi nelle tue ricerche, il team non lo vede.',
      updated: 'Ha aggiornato un ricordo esistente del team: ora c\'è una sola versione.'
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
    filters: { all: 'All', personal: '🔒 Personal', stale: '⚠ Code changed' },
    personalBadge: 'personal',
    staleBadge: 'code changed',
    noPersonal: 'No personal memory. Save one with "New memory" → "Just for me".',
    noStale: 'No memory with changed code (or no repository on this PC).',
    recheck: 'Check the repositories again',
    rechecked: (n: number, st: number) => `Checked ${n} memories with code references: ${st} with changed code.`,
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
      propose: 'Propose',
      scopeTeam: 'For the team',
      scopePersonal: 'Just for me (stays on this PC)',
      savePersonal: 'Save for me',
      savedPersonal: 'Saved as a personal memory: you find it in your searches, the team does not see it.',
      updated: 'It updated an existing team memory: there is now a single version.'
    }
  }
})

/** Restituisce `value` solo dopo che è rimasto fermo per `ms` millisecondi. / EN: Returns `value` only after it has stayed unchanged for `ms` milliseconds. */
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
  // `#/memoria?id=<id>` apre direttamente quel ricordo (anche con l'id abbreviato): link da altre
  // pagine e da fuori. Il dettaglio carica il ricordo completo da solo (MemoryPanel).
  // EN: `#/memoria?id=<id>` opens that memory directly (even with the short id): links from other
  //     pages and from outside. The detail loads the full memory on its own (MemoryPanel).
  const [params] = useSearchParams()
  const linked = params.get('id')
  useEffect(() => {
    if (linked) setSelected({ id: linked, title: '', body: '', kind: 'fact', tags: [], author: '', authorName: null, ts: 0, score: 0 } as RecallHit)
  }, [linked])
  const [filter, setFilter] = useState<'all' | 'personal' | 'stale'>('all')
  const q = useDebounced(query.trim())

  // Una sola query con chiave ['memories', …]: gli eventi "memories" invalidano tutte le varianti.
  // EN: A single query with key ['memories', …]: "memories" events invalidate all variants.
  const list = useQuery({
    queryKey: ['memories', filter, q],
    queryFn: async () => {
      if (filter === 'personal') return api.personal()
      if (filter === 'stale') return api.staleMemories()
      return q.length >= 2 ? api.search(q) : api.recent()
    }
  })
  const recheck = useMutation({ mutationFn: api.checkStale, onSuccess: () => { void list.refetch() } })
  const emptyText = filter === 'personal' ? s.noPersonal : filter === 'stale' ? s.noStale : q ? s.noResults : s.empty

  return (
    <>
      <PageHeader help='memory'
        title={s.title}
        subtitle={s.subtitle}
        actions={<button className='btn primary' onClick={() => setComposing(!composing)}>{composing ? s.close : s.newMemory}</button>}
      />
      {composing && <Compose onDone={() => setComposing(false)} />}
      <div className='split' style={{ marginTop: composing ? 16 : 0 }}>
        <div className='stack'>
          <input autoFocus placeholder={s.searchPlaceholder} value={query} disabled={filter !== 'all'} onChange={(e) => setQuery(e.target.value)} />
          <div className='row'>
            {(['all', 'personal', 'stale'] as const).map((f) => (
              <button key={f} className={`btn small ${filter === f ? 'primary' : ''}`} onClick={() => { setFilter(f); setSelected(null) }}>{s.filters[f]}</button>
            ))}
            <span className='spacer' />
            {filter === 'stale' && <button className='btn small' disabled={recheck.isPending} onClick={() => recheck.mutate()}>{s.recheck}</button>}
          </div>
          {recheck.data && filter === 'stale' && <div className='notice small'>{s.rechecked(recheck.data.checked, recheck.data.stale)}</div>}
          <ErrorBox error={list.error ?? recheck.error} />
          <div className='card' style={{ padding: 6 }}>
            {list.data?.length === 0 && <Empty>{emptyText}</Empty>}
            <div className='list'>
              {list.data?.map((h) => (
                <div key={h.id} className={`list-item clickable ${selected?.id === h.id ? 'selected' : ''}`} onClick={() => setSelected(h)}>
                  <div style={{ fontWeight: 600 }}>{h.root && <span className={`root-mark ${h.root.status}`} title={s.root}>◆ </span>}{h.title}</div>
                  <div className='row small muted'>
                    <span className='badge'>{KIND_LABEL[h.kind] ?? h.kind}</span>
                    <span>{h.authorName ?? short(h.author)}</span>
                    <span>· {dateTime(h.ts)}</span>
                    {h.personal && <span className='badge'>🔒 {s.personalBadge}</span>}
                    {h.stale && <span className='badge warn'>⚠ {s.staleBadge}</span>}
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

/** Modulo per proporre un ricordo. Mostra l'esito: pubblicato, in inbox o privato (D6). / EN: Form to propose a memory. Shows the outcome: published, in the Inbox or private (D6). */
function Compose ({ onDone }: { onDone: () => void }) {
  const s = useStrings(S)
  const c = s.compose
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState('fact')
  const [tags, setTags] = useState('')
  const [personal, setPersonal] = useState(false)
  const input = () => ({ title, body, kind, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })
  const save = useMutation({ mutationFn: () => api.remember(input()) })
  const savePersonal = useMutation({ mutationFn: () => api.rememberPersonal(input()) })
  const r: ExplicitOutcome | undefined = save.data
  const busy = save.isPending || savePersonal.isPending

  return (
    <Card title={c.title}>
      <div className='stack'>
        <div className='row'>
          <label className='row' style={{ margin: 0 }}><input type='radio' checked={!personal} onChange={() => setPersonal(false)} /> {c.scopeTeam}</label>
          <label className='row' style={{ margin: 0 }}><input type='radio' checked={personal} onChange={() => setPersonal(true)} /> {c.scopePersonal}</label>
          <HelpButton topic='solo#personal' />
        </div>
        {!personal && <div className='notice small'>{c.intro}</div>}
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
        <ErrorBox error={save.error ?? savePersonal.error} />
        {r?.outcome === 'team' && <div className='notice ok'>{r.duplicate ? c.duplicate : r.updated ? c.updated : c.published}</div>}
        {savePersonal.data && <div className='notice ok'>{savePersonal.data.duplicate ? c.duplicate : c.savedPersonal}</div>}
        {r?.outcome === 'inbox' && <div className='notice warn'>{c.inbox(r.reason)}</div>}
        {r?.outcome === 'private' && <div className='notice warn'>{c.private(r.reason)}</div>}
        <div className='row'>
          <button className='btn primary' disabled={busy || title.trim().length < 3 || !body.trim()} onClick={() => (personal ? savePersonal.mutate() : save.mutate())}>
            {busy ? c.checking : personal ? c.savePersonal : c.propose}
          </button>
          <button className='btn' onClick={onDone}>{s.close}</button>
        </div>
      </div>
    </Card>
  )
}
