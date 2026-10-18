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
import { api, type RecallHit, type RootReviewResult, type RootView } from '../api/client'
import { MemoryPanel } from '../components/MemoryPanel'
import { Card, Empty, ErrorBox, PageHeader } from '../components/ui'
import { dateTime, ROOT_CATEGORY_LABEL, ROOT_CATEGORY_ORDER } from '../format'
import { defineStrings, useStrings } from '../i18n'

type Note = RootReviewResult['notes'][number]

const S = defineStrings({
  it: {
    title: 'Radici',
    subtitle: 'Il sapere fondante del team: architettura, rete, interfacce, dominio, best practice, policy. Non viene mai dimenticato e arriva agli agenti quando serve.',
    reviewing: 'Revisione in corso…',
    review: 'Rivedi le Radici',
    filter: 'Filtra: es. gateway, sicurezza…',
    allProjects: 'Tutti i progetti',
    count: (n: number) => `${n} Radici`,
    toReviewCount: (n: number) => `${n} da rivedere`,
    empty: 'Nessuna Radice ancora. Apri un ricordo fondante (in Memoria, nel Nucleo o nella Mappa) e scegli «Rendi Radice», oppure marca una cartella di documenti come «di Radici» nelle Impostazioni.',
    selectOne: 'Seleziona una Radice per leggerla.',
    reviewed: (d: string, by: string | null) => `rivista il ${d}${by ? ` da ${by}` : ''}`,
    toReview: 'da rivedere',
    report: (checked: number, flagged: number) => `Revisione: ${checked} Radici esaminate, ${flagged} da rivedere.`,
    close: 'Chiudi',
    note: 'Nota:',
    noteText: (n: Note): string => {
      if (n.code === 'missing-projects') return `Codice non verificato per i progetti assenti da questo PC: ${(n.params.projects ?? []).join(', ')}. Abilita la cartella del progetto o lancia la revisione dal PC di un collega che ce l'ha.`
      if (n.code === 'no-vectors') return 'Ricerca semantica non disponibile: contraddizioni cercate solo fra i collegamenti del dreaming.'
      if (n.code === 'llm-skipped') return `${n.params.count ?? 0} Radici non confrontate con i ricordi recenti (LLM assente, budget esaurito o limite di ${n.params.max ?? 30} confronti per revisione).`
      return n.text
    },
    suggested: (n: number) => `Suggerite da Micelio (${n})`,
    suggestedIntro: 'Ricordi che sembrano sapere fondante. Diventano Radici solo se lo decidi tu.',
    makeRoot: 'Rendi Radice',
    dismiss: 'Ignora'
  },
  en: {
    title: 'Roots',
    subtitle: 'The foundational knowledge of the team: architecture, network, interfaces, domain, best practices, policies. It is never forgotten and reaches the agents when needed.',
    reviewing: 'Reviewing…',
    review: 'Review the Roots',
    filter: 'Filter: e.g. gateway, security…',
    allProjects: 'All projects',
    count: (n: number) => `${n} Roots`,
    toReviewCount: (n: number) => `${n} to review`,
    empty: 'No Roots yet. Open a foundational memory (in Memory, the Nucleus or the Map) and choose “Make it a Root”, or mark a document folder as “Roots” in Settings.',
    selectOne: 'Select a Root to read it.',
    reviewed: (d: string, by: string | null) => `reviewed on ${d}${by ? ` by ${by}` : ''}`,
    toReview: 'to review',
    report: (checked: number, flagged: number) => `Review: ${checked} Roots checked, ${flagged} to review.`,
    close: 'Close',
    note: 'Note:',
    noteText: (n: Note): string => {
      if (n.code === 'missing-projects') return `Code not checked for the projects missing from this PC: ${(n.params.projects ?? []).join(', ')}. Enable the project folder or run the review from the PC of a colleague who has it.`
      if (n.code === 'no-vectors') return 'Semantic search not available: contradictions searched only among the dreaming links.'
      if (n.code === 'llm-skipped') return `${n.params.count ?? 0} Roots not compared with recent memories (no LLM, budget exhausted or limit of ${n.params.max ?? 30} comparisons per review).`
      return n.text
    },
    suggested: (n: number) => `Suggested by Micelio (${n})`,
    suggestedIntro: 'Memories that look like foundational knowledge. They become Roots only if you decide so.',
    makeRoot: 'Make it a Root',
    dismiss: 'Dismiss'
  }
})

export function Roots () {
  const s = useStrings(S)
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
      <PageHeader help='roots'
        title={s.title}
        subtitle={s.subtitle}
        actions={<button className='btn primary' disabled={review.isPending || all.length === 0} onClick={() => review.mutate()}>{review.isPending ? s.reviewing : s.review}</button>}
      />
      <ErrorBox error={roots.error ?? review.error} />
      {review.data && <ReviewReport result={review.data} onClose={() => review.reset()} />}
      <Suggestions />

      <div className='split' style={{ marginTop: 16 }}>
        <div className='stack'>
          <div className='row'>
            <input style={{ flex: 1 }} placeholder={s.filter} value={query} onChange={(e) => setQuery(e.target.value)} />
            {projects.length > 0 && (
              <select style={{ width: 200 }} value={project} onChange={(e) => setProject(e.target.value)}>
                <option value=''>{s.allProjects}</option>
                {projects.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </div>
          <div className='row small'>
            <span className='badge'>{s.count(all.length)}</span>
            {toReview > 0 && <span className='badge danger'>{s.toReviewCount(toReview)}</span>}
          </div>
          {all.length === 0 && !roots.isLoading && <Empty>{s.empty}</Empty>}
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
            : <Empty>{s.selectOne}</Empty>}
        </div>
      </div>
    </>
  )
}

/** Una Radice nell'elenco: titolo, progetto, stato di revisione e motivi delle segnalazioni. */
function RootItem ({ root, selected, onSelect }: { root: RootView, selected: boolean, onSelect: () => void }) {
  const s = useStrings(S)
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
        <span>{s.reviewed(dateTime(root.reviewedAt), root.reviewedByName)}</span>
        {root.status === 'review' && <span className='badge danger'>{s.toReview}</span>}
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
function ReviewReport ({ result, onClose }: { result: RootReviewResult, onClose: () => void }) {
  const s = useStrings(S)
  return (
    <div className={`notice ${result.flagged.length ? 'warn' : 'ok'}`} style={{ marginBottom: 12 }}>
      <div className='row'>
        <strong>{s.report(result.checked, result.flagged.length)}</strong>
        <span className='spacer' />
        <button className='btn small' onClick={onClose}>{s.close}</button>
      </div>
      {result.flagged.map((f) => (
        <div key={f.id} style={{ marginTop: 6 }}>
          ◆ {f.title}
          <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>{f.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      ))}
      {result.notes.map((n, i) => <p key={i} className='small' style={{ margin: '6px 0 0' }}>{s.note} {s.noteText(n)}</p>)}
    </div>
  )
}

/** Radici suggerite dal distillatore su questo PC: promuovi (con categoria) o ignora. */
function Suggestions () {
  const s = useStrings(S)
  const client = useQueryClient()
  const sugg = useQuery({ queryKey: ['rootSuggestions'], queryFn: api.rootSuggestions })
  const [cats, setCats] = useState<Record<string, string>>({})
  const refresh = () => { void client.invalidateQueries({ queryKey: ['rootSuggestions'] }); void client.invalidateQueries({ queryKey: ['roots'] }) }
  const promote = useMutation({ mutationFn: (x: { id: string, category: string }) => api.rootSet(x.id, x.category), onSuccess: refresh })
  const dismiss = useMutation({ mutationFn: (id: string) => api.dismissRootSuggestion(id), onSuccess: refresh })
  if (!sugg.data?.length) return null
  return (
    <Card help='roots#emerge' title={s.suggested(sugg.data.length)}>
      <p className='muted small' style={{ marginTop: 0 }}>{s.suggestedIntro}</p>
      <div className='list'>
        {sugg.data.map((x) => (
          <div key={x.id} className='list-item row'>
            <span style={{ flex: 1 }}>{x.title}</span>
            <select style={{ width: 190 }} value={cats[x.id] ?? x.category} onChange={(e) => setCats({ ...cats, [x.id]: e.target.value })}>
              {ROOT_CATEGORY_ORDER.map((c) => <option key={c} value={c}>{ROOT_CATEGORY_LABEL[c]}</option>)}
            </select>
            <button className='btn small primary' disabled={promote.isPending} onClick={() => promote.mutate({ id: x.id, category: cats[x.id] ?? x.category })}>{s.makeRoot}</button>
            <button className='btn small' disabled={dismiss.isPending} onClick={() => dismiss.mutate(x.id)}>{s.dismiss}</button>
          </div>
        ))}
      </div>
      <ErrorBox error={promote.error ?? dismiss.error} />
    </Card>
  )
}
