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
 * - Galassie (team grandi, vedi ./galaxies.ts): si parte da un cerchio per galassia, con nome e
 *   numero di ricordi; clic per entrarci, "◀ Tutte le galassie" per tornare. Ricerca e filtri con
 *   pochi risultati mostrano solo quelli; con tanti accendono le galassie che li contengono.
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
import { HelpButton } from '../help'
import { defineStrings, useStrings } from '../i18n'
import { authorColor, DIM, KIND_COLOR, registerAuthors, ROOT_STAR, rootRing } from './colors'
import { buildView, isGalaxyNode, usesGalaxies } from './galaxies'

type ColorMode = 'author' | 'kind'

const S = defineStrings({
  it: {
    title: 'Mappa 2D',
    counts: (n: number, l: number) => `${n} ricordi · ${l} collegamenti`,
    highlight: 'Accendi un argomento: es. build, orm…',
    byAuthor: 'Colora per autore',
    byKind: 'Colora per tipo',
    isolate: 'Clic per isolare',
    rootsOnly: 'Mostra solo le Radici: il sapere fondante del team',
    roots: (n: number) => `◆ Radici · ${n}`,
    relevant: (n: number, q: string) => `${n} pertinenti a «${q}»`,
    empty: 'La costellazione si accenderà con i primi ricordi del team.',
    galaxyCounts: (g: number, n: number) => `${g} galassie · ${n} ricordi`,
    allGalaxies: '◀ Tutte le galassie',
    galaxyHint: 'Ogni cerchio è una galassia: ricordi dello stesso argomento. Clic per entrarci.',
    other: 'senza collegamenti',
    hidden: (n: number) => `+${n} ricordi meno vivi non disegnati`,
    inGalaxies: (n: number) => `in ${n} galassie`
  },
  en: {
    title: '2D map',
    counts: (n: number, l: number) => `${n} memories · ${l} links`,
    highlight: 'Light up a topic: e.g. build, orm…',
    byAuthor: 'Colour by author',
    byKind: 'Colour by kind',
    isolate: 'Click to isolate',
    rootsOnly: 'Show only the Roots: the foundational knowledge of the team',
    roots: (n: number) => `◆ Roots · ${n}`,
    relevant: (n: number, q: string) => `${n} relevant to “${q}”`,
    empty: 'The constellation will light up with the first memories of the team.',
    galaxyCounts: (g: number, n: number) => `${g} galaxies · ${n} memories`,
    allGalaxies: '◀ All galaxies',
    galaxyHint: 'Each circle is a galaxy: memories on the same topic. Click to enter.',
    other: 'unlinked',
    hidden: (n: number) => `+${n} less active memories not drawn`,
    inGalaxies: (n: number) => `in ${n} galaxies`
  }
})

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
  const s = useStrings(S)
  const graph = useQuery({ queryKey: ['graph'], queryFn: api.graph })
  const [mode, setMode] = useState<ColorMode>('author')
  const [focus, setFocus] = useState<string | null>(null) // voce della legenda selezionata
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [rootsOnly, setRootsOnly] = useState(false)
  /** Galassia aperta, ricordata tramite un suo ricordo: gli id delle galassie cambiano a ogni ricalcolo. */
  const [anchor, setAnchor] = useState<string | null>(null)
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
  /** Un ricordo passa i filtri se passa sia la legenda sia la ricerca (e "solo Radici"). */
  const passes = (n: GraphNode) => (!focus || (mode === 'author' ? n.author : n.kind) === focus) && (!hits || hits.has(n.id)) && (!rootsOnly || !!n.root)
  const rootCount = (graph.data?.nodes ?? []).filter((n) => n.root).length

  // ── Cosa disegnare (./galaxies.ts): tutto, le galassie, una galassia o solo i risultati ──
  const filtering = !!focus || !!hits || rootsOnly
  const lit = useMemo(() => (filtering ? new Set((graph.data?.nodes ?? []).filter(passes).map((n) => n.id)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph.data, focus, mode, hits, rootsOnly])
  const big = usesGalaxies(graph.data)
  const galaxy = useMemo(() => (big && anchor ? graph.data!.nodes.find((n) => n.id === anchor)?.galaxy ?? null : null), [big, anchor, graph.data])
  const view = useMemo(() => buildView(graph.data, galaxy, lit), [graph.data, galaxy, lit])
  /** Un nodo della vista (ricordo o galassia) è acceso se nessun filtro lo esclude. */
  const isLit = (n: { id: string }) => !view.lit || view.lit.has(n.id)

  // Il grafo va passato come oggetto stabile: la libreria lo modifica (aggiunge x, y, vx…).
  // Lo ricreiamo solo quando cambia la STRUTTURA della vista o arrivano dati nuovi dal daemon.
  const data = useMemo(() => ({
    nodes: view.nodes.map((n) => ({ ...n })),
    links: view.links.map((l) => ({ ...l }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [graph.data, view.key])

  // Più repulsione del default: i ricordi si distanziano e le etichette si leggono meglio. Fra le
  // galassie molta di più: sono cerchi grandi, con il nome sotto.
  useEffect(() => {
    fgRef.current?.d3Force('charge')?.strength(view.level === 'overview' ? -900 : -140)
    fgRef.current?.d3Force('link')?.distance(view.level === 'overview' ? 120 : 30)
  }, [data, view.level])
  /** Raggio del cerchio di una galassia. */
  const galaxyRadius = (size: number) => 6 + 1.4 * Math.sqrt(size)
  const galaxyName = (id: number, label: string, tags: string[]) => (id < 0 ? s.other : label || tags[0] || '·')

  // Inquadra tutta la mappa quando arrivano i dati (oltre che a simulazione ferma, vedi onEngineStop):
  // senza, la mappa resta un piccolo gomitolo al centro.
  useEffect(() => {
    const t = setTimeout(() => fgRef.current?.zoomToFit(600, 60), 1500)
    return () => clearTimeout(t)
  }, [data])

  return (
    // Una sola colonna: il dettaglio si apre SOPRA la mappa (in alto a destra). Con una seconda
    // colonna la mappa, larga in pixel, sbordava e spingeva il dettaglio fuori dallo schermo.
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, height: 'calc(100vh - 64px)' }}>
      <div className='stack' style={{ minHeight: 0 }}>
        <div className='row'>
          <h1 style={{ margin: 0 }}>{s.title} <HelpButton topic='views#map' /></h1>
          <span className='muted'>{view.level === 'overview' ? s.galaxyCounts(view.nodes.length, graph.data?.nodes.length ?? 0) : s.counts(data.nodes.length + view.hidden, data.links.length)}</span>
          <span className='spacer' />
          <input style={{ width: 280 }} placeholder={s.highlight} value={query} onChange={(e) => setQuery(e.target.value)} />
          <select style={{ width: 170 }} value={mode} onChange={(e) => { setMode(e.target.value as ColorMode); setFocus(null) }}>
            <option value='author'>{s.byAuthor}</option>
            <option value='kind'>{s.byKind}</option>
          </select>
        </div>
        <ErrorBox error={graph.error} />
        <div className='row small'>
          {legend.map((l) => (
            <button
              key={l.key}
              className={`btn small ${focus === l.key ? 'primary' : ''}`}
              onClick={() => setFocus(focus === l.key ? null : l.key)}
              title={s.isolate}
            >
              <span className='dot' style={{ background: l.color, marginRight: 6 }} />{l.label} · {l.count}
            </button>
          ))}
          <button className={`btn small ${rootsOnly ? 'primary' : ''}`} disabled={rootCount === 0} onClick={() => setRootsOnly(!rootsOnly)} title={s.rootsOnly}>
            {s.roots(rootCount)}
          </button>
          {hits && <span className='badge accent'>{s.relevant(hits.size, q)}</span>}
          {view.level === 'overview' && view.lit && <span className='badge'>{s.inGalaxies(view.lit.size)}</span>}
        </div>
        {(view.galaxy || view.level === 'overview') && (
          <div className='row small'>
            {view.galaxy
              ? <>
                <button className='btn small' onClick={() => { setAnchor(null); setSelected(null) }}>{s.allGalaxies}</button>
                <strong>✦ {galaxyName(view.galaxy.id, view.galaxy.label, view.galaxy.tags)}</strong>
                {view.hidden > 0 && <span className='muted'>{s.hidden(view.hidden)}</span>}
              </>
              : <span className='muted'>{s.galaxyHint}</span>}
          </div>
        )}
        <div ref={boxRef} style={{ flex: 1, minHeight: 300, borderRadius: 12, overflow: 'hidden', background: '#0b100d', position: 'relative' }}>
          {data.nodes.length === 0 && !graph.isLoading && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#9aa696' }}>
              {s.empty}
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
            onNodeClick={(n: any) => {
              // Galassia: ci si entra (ancorandola al suo ricordo più vivo)
              if (isGalaxyNode(n)) { setSelected(null); setAnchor(n.galaxyInfo.top[0] ?? null); return }
              setSelected(n)
            }}
            onBackgroundClick={() => setSelected(null)}
            nodeCanvasObject={(n: any, ctx, scale) => {
              const lit = isLit(n)
              // (n.galaxyInfo e non isGalaxyNode: il controllo di tipo toglierebbe x e y, aggiunte dalla libreria)
              if (n.galaxyInfo) {
                // Galassia: cerchio con alone, anello ciano se contiene Radici, nome e numero sotto
                const g = n.galaxyInfo
                const r = galaxyRadius(g.size)
                ctx.beginPath()
                ctx.arc(n.x, n.y, r, 0, 2 * Math.PI)
                ctx.fillStyle = lit ? 'rgba(150, 220, 170, 0.55)' : 'rgba(120,130,120,0.15)'
                ctx.shadowColor = lit ? 'rgba(150, 220, 170, 0.9)' : 'transparent'
                ctx.shadowBlur = lit ? 18 : 0
                ctx.fill()
                ctx.shadowBlur = 0
                if (g.roots > 0) {
                  ctx.lineWidth = 2 / scale
                  ctx.strokeStyle = lit ? ROOT_STAR : DIM
                  ctx.stroke()
                }
                ctx.font = `${12 / scale}px system-ui`
                ctx.textAlign = 'center'
                ctx.fillStyle = lit ? 'rgba(230, 240, 230, 0.95)' : 'rgba(150, 160, 150, 0.5)'
                ctx.fillText(`${galaxyName(g.id, g.label, g.tags)} · ${g.matches ?? g.size}`, n.x, n.y + r + 12 / scale)
                ctx.textAlign = 'start'
                return
              }
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
              ctx.arc(n.x, n.y, n.galaxyInfo ? galaxyRadius(n.galaxyInfo.size) : 8, 0, 2 * Math.PI)
              ctx.fill()
            }}
          />
          {selected && (
            <div className='map-detail'>
              <MemoryPanel node={selected} onClose={() => setSelected(null)} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
