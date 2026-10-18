/**
 * @file Radici (Fase 8): il sapere fondante del team, che non viene mai dimenticato.
 *
 * - Elenco per categoria (architettura, rete, interfacce, dominio, best practice, policy…),
 *   con filtro per progetto e ricerca; le Radici "da rivedere" sono evidenziate con i motivi.
 * - "Rivedi le Radici" lancia la revisione manuale (codice o documento d'origine cambiati,
 *   ricordi recenti che le contraddicono) e mostra il resoconto.
 * - Suggerite da Micelio: ricordi che il distillatore ritiene fondanti; si promuovono con un clic
 *   (scegliendo la categoria) o si ignorano. Sono suggerimenti di QUESTO PC.
 * Clic su una Radice: il dettaglio del ricordo nel pannello a destra (stesso pannello di Memoria),
 * dove si conferma, si cambia categoria o si toglie.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api, type RecallHit, type RootView } from '../api/client'
import { MemoryPanel } from '../components/MemoryPanel'
import { Card, Empty, ErrorBox, PageHeader } from '../components/ui'
import { dateTime, ROOT_CATEGORY_LABEL, ROOT_CATEGORY_ORDER } from '../format'

export function Roots () {
  const client = useQueryClient()
  const roots = useQuery({ queryKey: ['roots'], queryFn: () => api.roots() })
  const [project, setProject] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<RecallHit | null>(null)
  const review = useMutation({ mutationFn: () => api.rootReview(), onSuccess: () => void client.invalidateQueries({ queryKey: ['roots'] }) })

  const all = roots.data ?? []
  // Progetti presenti fra le Radici (da source.code.project)
  const projects = useMemo(() => [...new Set(all.map((r) => r.memory.source?.code?.project).filter((p): p is string => !!p))].sort(), [all])
  const q = query.trim().toLowerCase()
  const shown = all.filter((r) =>
    (!project || r.memory.source?.code?.project === project) &&
    (!q || `${r.memory.title} ${r.memory.body} ${r.memory.tags.join(' ')}`.toLowerCase().includes(q)))
  const toReview = all.filter((r) => r.status === 'review').length

  return (
    <>
      <PageHeader
        title='Radici'
        subtitle='Il sapere fondante del team: architettura, rete, interfacce, dominio, best practice, policy. Non viene mai dimenticato e arriva agli agenti quando serve.'
        actions={<button className='btn primary' disabled={review.isPending || all.length === 0} onClick={() => review.mutate()}>{review.isPending ? 'Revisione in corso…' : 'Rivedi le Radici'}</button>}
      />
      <ErrorBox error={roots.error ?? review.error} />
      {review.data && <ReviewReport result={review.data} onClose={() => review.reset()} />}
      <Suggestions />

      <div className='split' style={{ marginTop: 16 }}>
        <div className='stack'>
          <div className='row'>
            <input style={{ flex: 1 }} placeholder='Filtra: es. gateway, sicurezza…' value={query} onChange={(e) => setQuery(e.target.value)} />
            {projects.length > 0 && (
              <select style={{ width: 200 }} value={project} onChange={(e) => setProject(e.target.value)}>
                <option value=''>Tutti i progetti</option>
                {projects.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </div>
          <div className='row small'>
            <span className='badge'>{all.length} Radici</span>
            {toReview > 0 && <span className='badge danger'>{toReview} da rivedere</span>}
          </div>
          {all.length === 0 && !roots.isLoading && (
            <Empty>
              Nessuna Radice ancora. Apri un ricordo fondante (in Memoria, nel Nucleo o nella Mappa) e scegli «Rendi Radice»,
              oppure marca una cartella di documenti come «di Radici» nelle Impostazioni.
            </Empty>
          )}
          {ROOT_CATEGORY_ORDER.map((cat) => {
            const list = shown.filter((r) => r.category === cat)
            if (!list.length) return null
            return (
              <div key={cat}>
                <h3 style={{ margin: '8px 0 6px' }}>{ROOT_CATEGORY_LABEL[cat]}</h3>
                <div className='card' style={{ padding: 6 }}>
                  <div className='list'>
                    {list.map((r) => <RootItem key={r.id} root={r} selected={selected?.id === r.id} onSelect={() => setSelected(r.memory)} />)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div>
          {selected
            ? <MemoryPanel node={selected} onClose={() => setSelected(null)} />
            : <Empty>Seleziona una Radice per leggerla.</Empty>}
        </div>
      </div>
    </>
  )
}

/** Una Radice nell'elenco: titolo, progetto, stato di revisione e motivi delle segnalazioni. */
function RootItem ({ root, selected, onSelect }: { root: RootView, selected: boolean, onSelect: () => void }) {
  const code = root.memory.source?.code
  return (
    <div className={`list-item clickable ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className='row' style={{ fontWeight: 600 }}>
        <span className={`root-mark ${root.status}`} aria-hidden>◆</span>
        <span>{root.memory.title}</span>
      </div>
      <div className='row small muted'>
        {code?.project && <span className='badge'>{code.project}</span>}
        {root.memory.source?.type === 'document' && <span className='badge'>📄 {root.memory.source.name}</span>}
        <span>rivista il {dateTime(root.reviewedAt)}{root.reviewedByName ? ` da ${root.reviewedByName}` : ''}</span>
        {root.status === 'review' && <span className='badge danger'>da rivedere</span>}
      </div>
      {root.status === 'review' && (
        <ul className='small' style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {root.flags.map((f, i) => <li key={i}>{f.reason}</li>)}
        </ul>
      )}
    </div>
  )
}

/** Resoconto dell'ultima revisione manuale. */
function ReviewReport ({ result, onClose }: { result: Awaited<ReturnType<typeof api.rootReview>>, onClose: () => void }) {
  return (
    <div className={`notice ${result.flagged.length ? 'warn' : 'ok'}`} style={{ marginBottom: 12 }}>
      <div className='row'>
        <strong>Revisione: {result.checked} Radici esaminate, {result.flagged.length} da rivedere.</strong>
        <span className='spacer' />
        <button className='btn small' onClick={onClose}>Chiudi</button>
      </div>
      {result.flagged.map((f) => (
        <div key={f.id} style={{ marginTop: 6 }}>
          ◆ {f.title}
          <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>{f.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      ))}
      {result.notes.map((n, i) => <p key={i} className='small' style={{ margin: '6px 0 0' }}>Nota: {n}</p>)}
    </div>
  )
}

/** Radici suggerite dal distillatore su questo PC: promuovi (con categoria) o ignora. */
function Suggestions () {
  const client = useQueryClient()
  const sugg = useQuery({ queryKey: ['rootSuggestions'], queryFn: api.rootSuggestions })
  const [cats, setCats] = useState<Record<string, string>>({})
  const refresh = () => { void client.invalidateQueries({ queryKey: ['rootSuggestions'] }); void client.invalidateQueries({ queryKey: ['roots'] }) }
  const promote = useMutation({ mutationFn: (s: { id: string, category: string }) => api.rootSet(s.id, s.category), onSuccess: refresh })
  const dismiss = useMutation({ mutationFn: (id: string) => api.dismissRootSuggestion(id), onSuccess: refresh })
  if (!sugg.data?.length) return null
  return (
    <Card title={`Suggerite da Micelio (${sugg.data.length})`}>
      <p className='muted small' style={{ marginTop: 0 }}>Ricordi che sembrano sapere fondante. Diventano Radici solo se lo decidi tu.</p>
      <div className='list'>
        {sugg.data.map((s) => (
          <div key={s.id} className='list-item row'>
            <span style={{ flex: 1 }}>{s.title}</span>
            <select style={{ width: 190 }} value={cats[s.id] ?? s.category} onChange={(e) => setCats({ ...cats, [s.id]: e.target.value })}>
              {ROOT_CATEGORY_ORDER.map((c) => <option key={c} value={c}>{ROOT_CATEGORY_LABEL[c]}</option>)}
            </select>
            <button className='btn small primary' disabled={promote.isPending} onClick={() => promote.mutate({ id: s.id, category: cats[s.id] ?? s.category })}>Rendi Radice</button>
            <button className='btn small' disabled={dismiss.isPending} onClick={() => dismiss.mutate(s.id)}>Ignora</button>
          </div>
        ))}
      </div>
      <ErrorBox error={promote.error ?? dismiss.error} />
    </Card>
  )
}
