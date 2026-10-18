/**
 * @file Pannello di dettaglio di un ricordo, condiviso dalle viste a grafo (Nucleo 3D, Mappa 2D).
 * Il corpo si carica al momento dell'apertura (il grafo contiene solo titolo e metadati).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CodeRefs, type GraphNode } from '../api/client'
import { dateTime, KIND_LABEL, ROOT_CATEGORY_LABEL, ROOT_CATEGORY_ORDER, short } from '../format'
import { defineStrings, useStrings } from '../i18n'
import { authorColor } from '../pages/colors'
import { Card, Empty, ErrorBox, Markdown, Meter } from './ui'

const S = defineStrings({
  it: {
    fromDocument: 'Da documento:',
    downloading: 'Download…',
    download: 'Scarica l’originale',
    show: 'Mostra',
    rootAsk: 'È sapere fondante (architettura, rete, interfacce, best practice, policy…)? Rendilo una',
    rootWord: 'Radice',
    rootNever: ': non verrà mai dimenticato.',
    makeRoot: 'Rendi Radice',
    rootTitle: (cat: string) => `Radice · ${cat}`,
    toReview: 'da rivedere',
    reviewed: (d: string) => `rivista il ${d}`,
    stillValid: 'Rivista: è ancora valida',
    changeCategory: 'Cambia categoria',
    notRoot: 'Non è più una Radice',
    fromCode: 'Dal codice:',
    project: 'progetto',
    repository: 'repository',
    files: 'File',
    symbols: 'Simboli',
    commits: 'Commit',
    activation: 'Attivazione',
    usage: (uses: number, votes: string) => `${uses} usi · voti ${votes}`,
    useful: 'Utile',
    misleading: 'Fuorviante o obsoleto',
    unpin: 'Sblocca',
    pin: 'Fissa: non decade e non viene archiviato',
    close: 'Chiudi',
    loading: 'Caricamento…',
    author: 'Autore',
    written: 'Scritto il',
    document: 'documento',
    openInSearch: 'Apri nella ricerca →'
  },
  en: {
    fromDocument: 'From document:',
    downloading: 'Downloading…',
    download: 'Download the original',
    show: 'Show',
    rootAsk: 'Is this foundational knowledge (architecture, network, interfaces, best practices, policies…)? Make it a',
    rootWord: 'Root',
    rootNever: ': it will never be forgotten.',
    makeRoot: 'Make it a Root',
    rootTitle: (cat: string) => `Root · ${cat}`,
    toReview: 'to review',
    reviewed: (d: string) => `reviewed on ${d}`,
    stillValid: 'Reviewed: still valid',
    changeCategory: 'Change category',
    notRoot: 'No longer a Root',
    fromCode: 'From code:',
    project: 'project',
    repository: 'repository',
    files: 'Files',
    symbols: 'Symbols',
    commits: 'Commits',
    activation: 'Activation',
    usage: (uses: number, votes: string) => `${uses} uses · votes ${votes}`,
    useful: 'Useful',
    misleading: 'Misleading or outdated',
    unpin: 'Unpin',
    pin: 'Pin: it never decays and is never archived',
    close: 'Close',
    loading: 'Loading…',
    author: 'Author',
    written: 'Written on',
    document: 'document',
    openInSearch: 'Open in search →'
  }
})

/**
 * Riquadro "documento originale" (Fase 4): il ricordo è stato distillato da un documento, che si
 * può scaricare dal collega che lo possiede (deve essere online e condividere quella cartella).
 */
function SourceBox ({ id, name, size }: { id: string, name: string, size?: number }) {
  const s = useStrings(S)
  const fetchIt = useMutation({ mutationFn: () => api.fetchSource(id) })
  return (
    <div className='notice small' style={{ marginTop: 12 }}>
      <div className='row'>
        <span>📄 {s.fromDocument} <strong>{name}</strong>{size ? ` · ${Math.max(1, Math.round(size / 1024))} KB` : ''}</span>
        <span className='spacer' />
        <button className='btn small' disabled={fetchIt.isPending} onClick={() => fetchIt.mutate()}>{fetchIt.isPending ? s.downloading : s.download}</button>
      </div>
      <ErrorBox error={fetchIt.error} />
      {fetchIt.data && (
        <div className='row' style={{ marginTop: 6 }}>
          <span className='mono' style={{ overflowWrap: 'anywhere' }}>{fetchIt.data.path}</span>
          {window.micelio?.showInFolder && <button className='btn small' onClick={() => void window.micelio!.showInFolder!(fetchIt.data!.path)}>{s.show}</button>}
        </div>
      )}
    </div>
  )
}

/**
 * Riquadro "Radice" (Fase 8). Per una Radice: categoria, stato di revisione con i motivi, e le
 * azioni (confermare dopo averla rivista, cambiare categoria, togliere). Per un ricordo normale:
 * "Rendi Radice" con la scelta della categoria. Qualunque membro può farlo.
 */
function RootBox ({ id, root }: { id: string, root?: { category: string, status: 'ok' | 'review' } }) {
  const s = useStrings(S)
  const client = useQueryClient()
  const [category, setCategory] = useState<string>(root?.category ?? 'architecture')
  const refresh = () => {
    for (const k of [['memories'], ['roots'], ['graph'], ['rootSuggestions']]) void client.invalidateQueries({ queryKey: k })
  }
  const detail = useQuery({ queryKey: ['roots', 'one', id], queryFn: async () => (await api.roots()).find((r) => r.id === id) ?? null, enabled: !!root })
  const set = useMutation({ mutationFn: (c: string) => api.rootSet(id, c), onSuccess: refresh })
  const unset = useMutation({ mutationFn: () => api.rootUnset(id), onSuccess: refresh })
  const confirm = useMutation({ mutationFn: () => api.rootConfirm(id), onSuccess: refresh })
  const select = (
    <select style={{ width: 200 }} value={category} onChange={(e) => setCategory(e.target.value)}>
      {ROOT_CATEGORY_ORDER.map((c) => <option key={c} value={c}>{ROOT_CATEGORY_LABEL[c]}</option>)}
    </select>
  )

  if (!root) {
    return (
      <div className='notice small' style={{ marginTop: 12 }}>
        <div style={{ marginBottom: 6 }}>◆ {s.rootAsk} <strong>{s.rootWord}</strong>{s.rootNever}</div>
        <div className='row'>
          {select}
          <button className='btn small primary' disabled={set.isPending} onClick={() => set.mutate(category)}>{s.makeRoot}</button>
        </div>
        <ErrorBox error={set.error} />
      </div>
    )
  }
  const flags = detail.data?.flags ?? []
  return (
    <div className={`notice small ${root.status === 'review' ? 'warn' : ''}`} style={{ marginTop: 12 }}>
      <div className='row'>
        <span className={`root-mark ${root.status}`} aria-hidden>◆</span>
        <strong>{s.rootTitle(ROOT_CATEGORY_LABEL[root.category] ?? root.category)}</strong>
        {root.status === 'review' && <span className='badge danger'>{s.toReview}</span>}
        {detail.data && <span className='muted'>{s.reviewed(dateTime(detail.data.reviewedAt))}</span>}
      </div>
      {flags.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{flags.map((f, i) => <li key={i}>{f.reason}{f.refs.length ? <span className='muted mono'> ({f.refs.slice(0, 4).join(', ')})</span> : null}</li>)}</ul>}
      <div className='row' style={{ marginTop: 8 }}>
        {root.status === 'review' && <button className='btn small primary' disabled={confirm.isPending} onClick={() => confirm.mutate()}>{s.stillValid}</button>}
        {select}
        <button className='btn small' disabled={set.isPending || category === root.category} onClick={() => set.mutate(category)}>{s.changeCategory}</button>
        <button className='btn small' disabled={unset.isPending} onClick={() => unset.mutate()}>{s.notRoot}</button>
      </div>
      <ErrorBox error={set.error ?? unset.error ?? confirm.error} />
    </div>
  )
}

/**
 * Indirizzo web di un commit, se il remote è un URL https (GitHub, GitLab, Azure DevOps e Bitbucket
 * accettano tutti la forma `<repo>/commit/<hash>`); null per remote ssh o sconosciuti.
 */
function commitUrl (repo: string | undefined, hash: string): string | null {
  if (!repo || !/^https?:\/\//.test(repo)) return null
  return `${repo.replace(/\.git$/, '').replace(/\/+$/, '')}/commit/${hash}`
}

/**
 * Riquadro "riferimenti al codice": il ricordo è stato distillato da una sessione di sviluppo e dice
 * dove approfondire (progetto, branch, file, simboli, commit). I commit, se il repository è su un
 * server web, sono link alla pagina del commit.
 */
function CodeBox ({ code }: { code: CodeRefs }) {
  const s = useStrings(S)
  const repoUrl = code.repo && /^https?:\/\//.test(code.repo) ? code.repo : null
  return (
    <div className='notice small' style={{ marginTop: 12 }}>
      <div style={{ marginBottom: 4 }}>
        🧩 {s.fromCode} <strong>{code.project ?? s.project}</strong>
        {code.branch && <span className='muted'> · branch <span className='mono'>{code.branch}</span></span>}
        {code.repo && (repoUrl
          ? <> · <a href={repoUrl} target='_blank' rel='noreferrer'>{s.repository}</a></>
          : <span className='muted mono'> · {code.repo}</span>)}
      </div>
      <dl className='kv' style={{ margin: 0 }}>
        {code.files.length > 0 && <><dt>{s.files}</dt><dd>{code.files.map((f) => <div key={f} className='mono' style={{ overflowWrap: 'anywhere' }}>{f}</div>)}</dd></>}
        {code.symbols.length > 0 && <><dt>{s.symbols}</dt><dd>{code.symbols.map((sym) => <span key={sym} className='badge mono' style={{ marginRight: 4 }}>{sym}</span>)}</dd></>}
        {code.commits.length > 0 && (
          <><dt>{s.commits}</dt><dd>{code.commits.map((c) => {
            const url = commitUrl(code.repo, c)
            return <span key={c} className='mono' style={{ marginRight: 8 }} title={`git show ${c}`}>{url ? <a href={url} target='_blank' rel='noreferrer'>{c.slice(0, 8)}</a> : c.slice(0, 8)}</span>
          })}</dd></>
        )}
      </dl>
    </div>
  )
}

/**
 * Priorità del ricordo (Fase 5): attivazione, usi, voti e pin. I voti e il pin sono segnali per
 * tutto il team: i ricordi utili salgono nelle ricerche, quelli fissati non decadono mai.
 */
function Signals ({ id, activation, votes, uses, pinned }: { id: string, activation: number, votes: number, uses: number, pinned: boolean }) {
  const s = useStrings(S)
  const client = useQueryClient()
  const refresh = () => { void client.invalidateQueries({ queryKey: ['memories'] }); void client.invalidateQueries({ queryKey: ['graph'] }) }
  const vote = useMutation({ mutationFn: (d: -1 | 0 | 1) => api.vote(id, d), onSuccess: refresh })
  const pin = useMutation({ mutationFn: () => api.pin(id, !pinned), onSuccess: refresh })
  return (
    <div style={{ marginTop: 12 }}>
      <div className='row small'><span>{s.activation}</span><span className='spacer' /><span>{Math.round(activation * 100)}%</span></div>
      <Meter value={activation} max={1} />
      <div className='row small' style={{ marginTop: 8 }}>
        <span className='muted'>{s.usage(uses, `${votes > 0 ? '+' : ''}${votes}`)}</span>
        <span className='spacer' />
        <button className='btn small' title={s.useful} onClick={() => vote.mutate(1)}>👍</button>
        <button className='btn small' title={s.misleading} onClick={() => vote.mutate(-1)}>👎</button>
        <button className={`btn small ${pinned ? 'primary' : ''}`} title={pinned ? s.unpin : s.pin} onClick={() => pin.mutate()}>📌</button>
      </div>
      <ErrorBox error={vote.error ?? pin.error} />
    </div>
  )
}

export function MemoryPanel ({ node, onClose }: { node: GraphNode, onClose: () => void }) {
  const s = useStrings(S)
  const full = useQuery({ queryKey: ['memories', 'one', node.id], queryFn: () => api.memory(node.id) })
  return (
    <Card title={node.title} actions={<button className='btn small' onClick={onClose} aria-label={s.close}>✕</button>}>
      <div className='row small' style={{ marginBottom: 10 }}>
        <span className='badge accent'>{KIND_LABEL[node.kind] ?? node.kind}</span>
        {node.tags.map((t) => <span key={t} className='badge'>#{t}</span>)}
      </div>
      {full.data ? <Markdown text={full.data.body} /> : <Empty>{s.loading}</Empty>}
      <dl className='kv small' style={{ marginTop: 12 }}>
        <dt>{s.author}</dt><dd><span className='dot' style={{ background: authorColor(node.author), marginRight: 6 }} />{node.authorName ?? short(node.author)}</dd>
        <dt>{s.written}</dt><dd>{dateTime(node.ts)}</dd>
      </dl>
      {full.data && <Signals id={node.id} activation={full.data.activation ?? 0} votes={full.data.votes ?? 0} uses={full.data.uses ?? 0} pinned={!!full.data.pinned} />}
      {full.data && <RootBox key={`${node.id}-${full.data.root?.category ?? ''}`} id={node.id} root={full.data.root} />}
      {full.data?.source?.code && <CodeBox code={full.data.source.code} />}
      {full.data?.source?.type === 'document' && <SourceBox id={node.id} name={full.data.source.name ?? s.document} size={full.data.source.size} />}
      <p className='small' style={{ marginBottom: 0 }}><Link to='/memoria'>{s.openInSearch}</Link></p>
    </Card>
  )
}
