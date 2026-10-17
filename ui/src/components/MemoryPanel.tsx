/**
 * @file Pannello di dettaglio di un ricordo, condiviso dalle viste a grafo (Nucleo 3D, Mappa 2D).
 * Il corpo si carica al momento dell'apertura (il grafo contiene solo titolo e metadati).
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type GraphNode } from '../api/client'
import { dateTime, KIND_LABEL, short } from '../format'
import { authorColor } from '../pages/colors'
import { Card, Empty, ErrorBox, Markdown } from './ui'

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
      {full.data?.source?.type === 'document' && <SourceBox id={node.id} name={full.data.source.name ?? 'documento'} size={full.data.source.size} />}
      <p className='small' style={{ marginBottom: 0 }}><Link to='/memoria'>Apri nella ricerca →</Link></p>
    </Card>
  )
}
