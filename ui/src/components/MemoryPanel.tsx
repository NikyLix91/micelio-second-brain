/**
 * @file Pannello di dettaglio di un ricordo, condiviso dalle viste a grafo (Nucleo 3D, Mappa 2D).
 * Il corpo si carica al momento dell'apertura (il grafo contiene solo titolo e metadati).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type CodeRefs, type GraphNode } from '../api/client'
import { dateTime, KIND_LABEL, short } from '../format'
import { authorColor } from '../pages/colors'
import { Card, Empty, ErrorBox, Markdown, Meter } from './ui'

/**
 * Riquadro "documento originale" (Fase 4): il ricordo è stato distillato da un documento, che si
 * può scaricare dal collega che lo possiede (deve essere online e condividere quella cartella).
 */
function SourceBox ({ id, name, size }: { id: string, name: string, size?: number }) {
  const fetchIt = useMutation({ mutationFn: () => api.fetchSource(id) })
  return (
    <div className='notice small' style={{ marginTop: 12 }}>
      <div className='row'>
        <span>📄 Da documento: <strong>{name}</strong>{size ? ` · ${Math.max(1, Math.round(size / 1024))} KB` : ''}</span>
        <span className='spacer' />
        <button className='btn small' disabled={fetchIt.isPending} onClick={() => fetchIt.mutate()}>{fetchIt.isPending ? 'Download…' : 'Scarica l’originale'}</button>
      </div>
      <ErrorBox error={fetchIt.error} />
      {fetchIt.data && (
        <div className='row' style={{ marginTop: 6 }}>
          <span className='mono' style={{ overflowWrap: 'anywhere' }}>{fetchIt.data.path}</span>
          {window.micelio?.showInFolder && <button className='btn small' onClick={() => void window.micelio!.showInFolder!(fetchIt.data!.path)}>Mostra</button>}
        </div>
      )}
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
  const repoUrl = code.repo && /^https?:\/\//.test(code.repo) ? code.repo : null
  return (
    <div className='notice small' style={{ marginTop: 12 }}>
      <div style={{ marginBottom: 4 }}>
        🧩 Dal codice: <strong>{code.project ?? 'progetto'}</strong>
        {code.branch && <span className='muted'> · branch <span className='mono'>{code.branch}</span></span>}
        {code.repo && (repoUrl
          ? <> · <a href={repoUrl} target='_blank' rel='noreferrer'>repository</a></>
          : <span className='muted mono'> · {code.repo}</span>)}
      </div>
      <dl className='kv' style={{ margin: 0 }}>
        {code.files.length > 0 && <><dt>File</dt><dd>{code.files.map((f) => <div key={f} className='mono' style={{ overflowWrap: 'anywhere' }}>{f}</div>)}</dd></>}
        {code.symbols.length > 0 && <><dt>Simboli</dt><dd>{code.symbols.map((s) => <span key={s} className='badge mono' style={{ marginRight: 4 }}>{s}</span>)}</dd></>}
        {code.commits.length > 0 && (
          <><dt>Commit</dt><dd>{code.commits.map((c) => {
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
  const client = useQueryClient()
  const refresh = () => { void client.invalidateQueries({ queryKey: ['memories'] }); void client.invalidateQueries({ queryKey: ['graph'] }) }
  const vote = useMutation({ mutationFn: (d: -1 | 0 | 1) => api.vote(id, d), onSuccess: refresh })
  const pin = useMutation({ mutationFn: () => api.pin(id, !pinned), onSuccess: refresh })
  return (
    <div style={{ marginTop: 12 }}>
      <div className='row small'><span>Attivazione</span><span className='spacer' /><span>{Math.round(activation * 100)}%</span></div>
      <Meter value={activation} max={1} />
      <div className='row small' style={{ marginTop: 8 }}>
        <span className='muted'>{uses} usi · voti {votes > 0 ? '+' : ''}{votes}</span>
        <span className='spacer' />
        <button className='btn small' title='Utile' onClick={() => vote.mutate(1)}>👍</button>
        <button className='btn small' title='Fuorviante o obsoleto' onClick={() => vote.mutate(-1)}>👎</button>
        <button className={`btn small ${pinned ? 'primary' : ''}`} title={pinned ? 'Sblocca' : 'Fissa: non decade e non viene archiviato'} onClick={() => pin.mutate()}>📌</button>
      </div>
      <ErrorBox error={vote.error ?? pin.error} />
    </div>
  )
}

export function MemoryPanel ({ node, onClose }: { node: GraphNode, onClose: () => void }) {
  const full = useQuery({ queryKey: ['memories', 'one', node.id], queryFn: () => api.memory(node.id) })
  return (
    <Card title={node.title} actions={<button className='btn small' onClick={onClose} aria-label='Chiudi'>✕</button>}>
      <div className='row small' style={{ marginBottom: 10 }}>
        <span className='badge accent'>{KIND_LABEL[node.kind] ?? node.kind}</span>
        {node.tags.map((t) => <span key={t} className='badge'>#{t}</span>)}
      </div>
      {full.data ? <Markdown text={full.data.body} /> : <Empty>Caricamento…</Empty>}
      <dl className='kv small' style={{ marginTop: 12 }}>
        <dt>Autore</dt><dd><span className='dot' style={{ background: authorColor(node.author), marginRight: 6 }} />{node.authorName ?? short(node.author)}</dd>
        <dt>Scritto il</dt><dd>{dateTime(node.ts)}</dd>
      </dl>
      {full.data && <Signals id={node.id} activation={full.data.activation ?? 0} votes={full.data.votes ?? 0} uses={full.data.uses ?? 0} pinned={!!full.data.pinned} />}
      {full.data?.source?.code && <CodeBox code={full.data.source.code} />}
      {full.data?.source?.type === 'document' && <SourceBox id={node.id} name={full.data.source.name ?? 'documento'} size={full.data.source.size} />}
      <p className='small' style={{ marginBottom: 0 }}><Link to='/memoria'>Apri nella ricerca →</Link></p>
    </Card>
  )
}
