/**
 * @file Pannello di dettaglio di un ricordo, condiviso dalle viste a grafo (Nucleo 3D, Mappa 2D).
 * Il corpo si carica al momento dell'apertura (il grafo contiene solo titolo e metadati).
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type GraphNode } from '../api/client'
import { dateTime, KIND_LABEL, short } from '../format'
import { authorColor } from '../pages/colors'
import { Card, Empty, Markdown } from './ui'

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
      <p className='small' style={{ marginBottom: 0 }}><Link to='/memoria'>Apri nella ricerca →</Link></p>
    </Card>
  )
}
