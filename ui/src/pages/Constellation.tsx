/**
 * @file Mappa 2D: vista bidimensionale per analisi mirate (la home è il Nucleo 3D).
 *
 * - Ogni ricordo è una stella; i collegamenti uniscono ricordi correlati (oggi: tag in comune;
 *   dalla Fase 5 anche affinità di significato, dalla Fase 6 i legami creati dal dreaming).
 * - Navigabile: rotella per lo zoom, trascinamento dello sfondo per spostarsi, trascinamento
 *   di una stella per riordinare, clic per leggere il ricordo nel pannello laterale.
 * - Colori: per AUTORE (ogni collega ha il suo colore stabile) o per TIPO di ricordo.
 *   Cliccando una voce della legenda si spengono tutte le altre (filtro).
 * - Ricerca: le stelle pertinenti si accendono, le altre si spengono.
 *
 * - Radici (Fase 8): disegnate come ROMBI con contorno bianco (rosso se "da rivedere");
 *   "◆ Radici" isola solo le Radici.
 *
 * Il disegno usa react-force-graph-2d (simulazione a forze su canvas). Le stelle sono disegnate
 * a mano (nodeCanvasObject) per avere l'alone luminoso.
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { api, type GraphNode } from '../api/client'
import { MemoryPanel } from '../components/MemoryPanel'
import { ErrorBox } from '../components/ui'
import { KIND_LABEL, short } from '../format'
import { authorColor, DIM, KIND_COLOR, registerAuthors, rootRing } from './colors'

type ColorMode = 'author' | 'kind'

/** Dimensioni del contenitore, aggiornate al ridimensionamento della finestra. */
function useSize (ref: React.RefObject<HTMLDivElement | null>): { width: number, height: number } {
  const [size, setSize] = useState({ width: 800, height: 600 })
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ref])
  return size
}

export function Constellation () {
  const graph = useQuery({ queryKey: ['graph'], queryFn: api.graph })
  const [mode, setMode] = useState<ColorMode>('author')
  const [focus, setFocus] = useState<string | null>(null) // voce della legenda selezionata
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [rootsOnly, setRootsOnly] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<any>(null)
  const { width, height } = useSize(boxRef)

  // Ricerca: usiamo lo stesso motore della schermata Memoria; i risultati diventano un insieme di id.
  const q = query.trim()
  const search = useQuery({ queryKey: ['memories', 'graph-search', q], queryFn: () => api.search(q, 200), enabled: q.length >= 2 })
  const hits = useMemo(() => (q.length >= 2 && search.data ? new Set(search.data.map((h) => h.id)) : null), [q, search.data])

  // Stessi colori degli autori del Nucleo (palette distinta, ordine stabile).
  useMemo(() => registerAuthors((graph.data?.nodes ?? []).map((n) => n.author)), [graph.data])

  // Legenda: autori o tipi presenti, con il loro colore.
  const legend = useMemo(() => {
    const nodes = graph.data?.nodes ?? []
    if (mode === 'kind') {
      return [...new Set(nodes.map((n) => n.kind))].map((k) => ({ key: k, label: KIND_LABEL[k] ?? k, color: KIND_COLOR[k] ?? '#ccc', count: nodes.filter((n) => n.kind === k).length }))
    }
    const authors = new Map<string, { label: string, count: number }>()
    for (const n of nodes) authors.set(n.author, { label: n.authorName ?? short(n.author), count: (authors.get(n.author)?.count ?? 0) + 1 })
    return [...authors].map(([key, a]) => ({ key, label: a.label, color: authorColor(key), count: a.count }))
  }, [graph.data, mode])

  /** Colore "acceso" del nodo secondo la modalità corrente. */
  const baseColor = (n: GraphNode) => (mode === 'author' ? authorColor(n.author) : KIND_COLOR[n.kind] ?? '#ccc')
  /** Un nodo è acceso se passa sia il filtro della legenda sia la ricerca. */
  const isLit = (n: GraphNode) => (!focus || (mode === 'author' ? n.author : n.kind) === focus) && (!hits || hits.has(n.id)) && (!rootsOnly || !!n.root)
  const rootCount = (graph.data?.nodes ?? []).filter((n) => n.root).length

  // Il grafo va passato come oggetto stabile: la libreria lo modifica (aggiunge x, y, vx…).
  // Lo ricreiamo solo quando cambiano i dati dal daemon.
  const data = useMemo(() => ({
    nodes: (graph.data?.nodes ?? []).map((n) => ({ ...n })),
    links: (graph.data?.links ?? []).map((l) => ({ ...l }))
  }), [graph.data])

  // Più repulsione del default: i ricordi si distanziano e le etichette si leggono meglio.
  useEffect(() => { fgRef.current?.d3Force('charge')?.strength(-140) }, [data])

  // Inquadra tutta la mappa quando arrivano i dati (oltre che a simulazione ferma, vedi onEngineStop):
  // senza, la mappa resta un piccolo gomitolo al centro.
  useEffect(() => {
    const t = setTimeout(() => fgRef.current?.zoomToFit(600, 60), 1500)
    return () => clearTimeout(t)
  }, [data])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 360px' : '1fr', gap: 16, height: 'calc(100vh - 64px)' }}>
      <div className='stack' style={{ minHeight: 0 }}>
        <div className='row'>
          <h1 style={{ margin: 0 }}>Mappa 2D</h1>
          <span className='muted'>{data.nodes.length} ricordi · {data.links.length} collegamenti</span>
          <span className='spacer' />
          <input style={{ width: 280 }} placeholder='Accendi un argomento: es. build, orm…' value={query} onChange={(e) => setQuery(e.target.value)} />
          <select style={{ width: 170 }} value={mode} onChange={(e) => { setMode(e.target.value as ColorMode); setFocus(null) }}>
            <option value='author'>Colora per autore</option>
            <option value='kind'>Colora per tipo</option>
          </select>
        </div>
        <ErrorBox error={graph.error} />
        <div className='row small'>
          {legend.map((l) => (
            <button
              key={l.key}
              className={`btn small ${focus === l.key ? 'primary' : ''}`}
              onClick={() => setFocus(focus === l.key ? null : l.key)}
              title='Clic per isolare'
            >
              <span className='dot' style={{ background: l.color, marginRight: 6 }} />{l.label} · {l.count}
            </button>
          ))}
          <button className={`btn small ${rootsOnly ? 'primary' : ''}`} disabled={rootCount === 0} onClick={() => setRootsOnly(!rootsOnly)} title='Mostra solo le Radici: il sapere fondante del team'>
            ◆ Radici · {rootCount}
          </button>
          {hits && <span className='badge accent'>{hits.size} pertinenti a «{q}»</span>}
        </div>
        <div ref={boxRef} style={{ flex: 1, minHeight: 300, borderRadius: 12, overflow: 'hidden', background: '#0b100d', position: 'relative' }}>
          {data.nodes.length === 0 && !graph.isLoading && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#9aa696' }}>
              La costellazione si accenderà con i primi ricordi del team.
            </div>
          )}
          <ForceGraph2D
            ref={fgRef}
            // A simulazione assestata, inquadra tutta la mappa (altrimenti resta un puntino al centro).
            onEngineStop={() => fgRef.current?.zoomToFit(400, 50)}
            d3VelocityDecay={0.3}
            width={width}
            height={height}
            graphData={data}
            backgroundColor='#0b100d'
            nodeId='id'
            nodeLabel={(n: any) => n.title}
            // Collegamenti: più forti = più visibili. Spenti se uno dei due estremi è spento.
            linkColor={(l: any) => (isLit(l.source) && isLit(l.target) ? `rgba(170, 220, 180, ${0.12 + 0.5 * l.weight})` : 'rgba(120,130,120,0.05)')}
            linkWidth={(l: any) => 0.4 + 2 * l.weight}
            cooldownTicks={120}
            onNodeClick={(n: any) => setSelected(n)}
            onBackgroundClick={() => setSelected(null)}
            nodeCanvasObject={(n: any, ctx, scale) => {
              const lit = isLit(n)
              const r = n.id === selected?.id ? 7 : 4.5
              ctx.beginPath()
              if (n.root) {
                // Radice: rombo un po' più grande, con contorno (disegnato dopo il riempimento)
                const d = r * 1.5
                ctx.moveTo(n.x, n.y - d); ctx.lineTo(n.x + d, n.y); ctx.lineTo(n.x, n.y + d); ctx.lineTo(n.x - d, n.y); ctx.closePath()
              } else {
                ctx.arc(n.x, n.y, r, 0, 2 * Math.PI)
              }
              ctx.fillStyle = lit ? baseColor(n) : DIM
              // Alone luminoso: solo per i nodi accesi.
              ctx.shadowColor = lit ? baseColor(n) : 'transparent'
              ctx.shadowBlur = lit ? 14 : 0
              ctx.fill()
              ctx.shadowBlur = 0
              if (n.root) {
                ctx.lineWidth = 1.6
                ctx.strokeStyle = lit ? rootRing(n.root.status) : DIM
                ctx.stroke()
              }
              // Etichette solo quando si è abbastanza vicini, per non coprire la mappa.
              if (lit && scale > 3.2) {
                ctx.font = `${11 / scale}px system-ui`
                ctx.fillStyle = 'rgba(230, 240, 230, 0.85)'
                ctx.fillText(n.title.slice(0, 40), n.x + r + 2, n.y + 3 / scale)
              }
            }}
            nodePointerAreaPaint={(n: any, color, ctx) => {
              // Area cliccabile un po' più grande della stella.
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(n.x, n.y, 8, 0, 2 * Math.PI)
              ctx.fill()
            }}
          />
        </div>
      </div>
      {selected && <div style={{ overflowY: 'auto' }}><MemoryPanel node={selected} onClose={() => setSelected(null)} /></div>}
    </div>
  )
}
