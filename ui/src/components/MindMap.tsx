/**
 * @file Mappa mentale del sapere (B10, pagina «Chiedi»): la domanda a sinistra, i temi, i ricordi.
 *
 * EN: Mind map of the knowledge (B10, «Ask» page): the question on the left, the themes, the memories.
 *
 * Disposizione ad albero orizzontale, calcolata qui (niente librerie): colonna della domanda, colonna
 * dei temi, colonna dei ricordi; i vicini aggiunti con «espandi» in una quarta colonna accanto al
 * ricordo da cui partono. Fra i ricordi, archi tratteggiati per i collegamenti della costellazione
 * (stesso tema, significato simile, dreaming: approfondisce, dipende da, contraddice).
 *
 * EN: Horizontal tree layout, computed here (no libraries): question column, themes column,
 * memories column; neighbors added with «expand» go in a fourth column next to the memory they
 * start from. Between memories, dashed arcs for the constellation links
 * (same theme, similar meaning, dreaming: refines, depends on, contradicts).
 *
 * Per restare leggibile: ogni tema mostra i suoi THEME_SHOWN ricordi più importanti (citati nella
 * risposta, trovati dalla ricerca, Radici) e «+N altri»; un clic sul tema lo apre tutto. Fra i
 * ricordi si vedono sempre i collegamenti del dreaming; gli altri solo per il ricordo sotto il mouse
 * o illuminato dalla risposta.
 *
 * EN: To stay readable: each theme shows its THEME_SHOWN most important memories (cited in the
 * answer, found by the search, Roots) and «+N more»; clicking the theme opens it all. Between
 * memories the dreaming links are always shown; the others only for the memory under the mouse
 * or highlighted by the answer.
 *
 * Interazione: trascina per spostarti, rotella per lo zoom; clic su un ricordo per aprirlo, «+» per
 * espanderlo. I ricordi citati nella risposta sono evidenziati; un clic su [n] nella risposta
 * illumina il ricordo corrispondente (prop `focus`).
 *
 * EN: Interaction: drag to pan, wheel to zoom; click a memory to open it, «+» to expand it.
 * Memories cited in the answer are highlighted; clicking [n] in the answer highlights the
 * matching memory (prop `focus`).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMap, ChatMapLink, ChatMapMemory } from '../api/client'
import { defineStrings, useStrings } from '../i18n'

const S = defineStrings({
  it: {
    other: 'Altro',
    expand: 'Mostra i ricordi collegati',
    open: 'Apri il ricordo',
    rel: { relates: 'collegato', refines: 'approfondisce', contradicts: 'contraddice', 'depends-on': 'dipende da' } as Record<string, string>,
    kind: { tags: 'stesso argomento', semantic: 'significato simile', dream: 'collegato dal dreaming', use: 'serve insieme' } as Record<string, string>,
    root: 'Radice',
    more: (n: number) => `+${n} altri`,
    less: 'mostra meno',
    hint: 'Trascina per spostarti · rotella per lo zoom · clic su un tema per aprirlo tutto'
  },
  en: {
    other: 'Other',
    expand: 'Show linked memories',
    open: 'Open the memory',
    rel: { relates: 'related', refines: 'refines', contradicts: 'contradicts', 'depends-on': 'depends on' } as Record<string, string>,
    kind: { tags: 'same topic', semantic: 'similar meaning', dream: 'linked by dreaming', use: 'used together' } as Record<string, string>,
    root: 'Root',
    more: (n: number) => `+${n} more`,
    less: 'show less',
    hint: 'Drag to move · wheel to zoom · click a theme to open it all'
  }
})

/** Geometria: colonne e misure dei riquadri (unità del disegno). / EN: Geometry: columns and box sizes (drawing units). */
/** Larghezze della domanda e dei temi. Compatte: la mappa sta in una colonna della pagina / EN: Widths of the question and the themes. Compact: the map fits in one column of the page */
const QW = 160
const TW = 140
const COL = { question: 0, theme: QW + 24, memory: QW + TW + 56, extra: QW + TW + 56 + 270 + 50 }
const CARD = { w: 270, h: 48, gap: 10 }
const THEME_GAP = 26
/** Ricordi mostrati per tema finché il tema non viene aperto. / EN: Memories shown per theme until the theme is opened. */
const THEME_SHOWN = 3

interface Placed { id: string, x: number, y: number, m: ChatMapMemory, extra: boolean }

/**
 * @param extra ricordi aggiunti con «espandi»: id del ricordo di partenza → vicini e collegamenti
 *              EN: memories added with «expand»: id of the starting memory → neighbors and links
 * @param cited id dei ricordi citati nell'ultima risposta (evidenziati)
 *              EN: ids of the memories cited in the last answer (highlighted)
 * @param focus ricordo da illuminare (clic su [n] nella risposta)
 *              EN: memory to highlight (click on [n] in the answer)
 */
export function MindMap ({ map, extra, cited, focus, onOpen, onExpand }: {
  map: ChatMap
  extra: Record<string, { memories: ChatMapMemory[], links: ChatMapLink[] }>
  cited: Set<string>
  focus: string | null
  onOpen: (m: ChatMapMemory) => void
  onExpand: (id: string) => void
}) {
  const s = useStrings(S)
  /** Temi aperti (tutti i ricordi visibili). / EN: Open themes (all memories visible). */
  const [openThemes, setOpenThemes] = useState<Set<number>>(new Set())
  /** Ricordo sotto il mouse: se ne vedono tutti i collegamenti. / EN: Memory under the mouse: all its links are shown. */
  const [hover, setHover] = useState<string | null>(null)
  useEffect(() => { setOpenThemes(new Set()) }, [map])
  // ── Disposizione ──
  // EN: ── Layout ──
  const layout = useMemo(() => {
    const placed = new Map<string, Placed>()
    const themes: { id: number, label: string, x: number, y: number, top: number, bottom: number, hidden: number }[] = []
    let y = 0
    const byId = new Map(map.memories.map((m) => [m.id, m]))
    // Importanza dentro un tema: citato nella risposta, trovato dalla ricerca, Radice, poi l'ordine dato
    // EN: Importance within a theme: cited in the answer, found by the search, Root, then the given order
    const weight = (id: string) => (cited.has(id) ? 4 : 0) + (byId.get(id)?.found ? 2 : 0) + (byId.get(id)?.root ? 1 : 0)
    for (const t of map.themes) {
      const top = y
      const sorted = [...t.memories].sort((a, b) => weight(b) - weight(a))
      const shownIds = openThemes.has(t.id) || sorted.length <= THEME_SHOWN + 1 ? sorted : sorted.slice(0, THEME_SHOWN)
      for (const id of shownIds) {
        const m = byId.get(id)
        if (!m) continue
        placed.set(id, { id, x: COL.memory, y, m, extra: false })
        // I vicini espansi stanno accanto, nella colonna a destra
        // EN: Expanded neighbors sit beside it, in the column on the right
        const ex = extra[id]
        if (ex) {
          let ey = y
          for (const n of ex.memories) {
            if (placed.has(n.id) || map.memories.some((x) => x.id === n.id)) continue
            placed.set(n.id, { id: n.id, x: COL.extra, y: ey, m: n, extra: true })
            ey += CARD.h + CARD.gap
          }
          y = Math.max(y + CARD.h + CARD.gap, ey)
        } else {
          y += CARD.h + CARD.gap
        }
      }
      const hidden = t.memories.length - shownIds.length
      // "+N altri" / "mostra meno" sotto i ricordi del tema
      // EN: "+N more" / "show less" below the theme's memories
      if (hidden > 0 || openThemes.has(t.id)) y += 24
      const bottom = y - CARD.gap
      themes.push({ id: t.id, label: t.label || s.other, x: COL.theme, y: (top + bottom) / 2, top, bottom, hidden })
      y += THEME_GAP
    }
    const height = Math.max(y - THEME_GAP, CARD.h)
    // Collegamenti fra ricordi (della mappa e delle espansioni), senza doppioni
    // EN: Links between memories (of the map and the expansions), without duplicates
    const links: ChatMapLink[] = []
    const seen = new Set<string>()
    for (const l of [...map.links, ...Object.values(extra).flatMap((e) => e.links)]) {
      const k = [l.source, l.target].sort().join('|')
      if (seen.has(k) || !placed.has(l.source) || !placed.has(l.target)) continue
      seen.add(k)
      links.push(l)
    }
    return { placed, themes, height, links }
  }, [map, extra, s.other, openThemes, cited])

  // ── Vista: spostamento e zoom (viewBox) ──
  // EN: ── View: pan and zoom (viewBox) ──
  // Larghezza del contenuto: la colonna delle espansioni conta solo se c'è
  // EN: Content width: the expansions column counts only if present
  const width = (Object.keys(extra).length ? COL.extra + CARD.w : COL.memory + CARD.w + 90) + 20
  const svgRef = useRef<SVGSVGElement>(null)
  const [aspect, setAspect] = useState(0.75)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => { if (e.contentRect.width) setAspect(e.contentRect.height / e.contentRect.width) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Inquadratura: tutta la larghezza, dall'alto, alla scala che ne deriva (si scorre per il resto)
  // EN: Framing: full width, from the top, at the resulting scale (scroll for the rest)
  const fit = () => ({ x: -30, y: -30, w: width + 60, h: (width + 60) * aspect })
  const [view, setView] = useState(fit)
  useEffect(() => { setView(fit()) }, [map, aspect, width])
  const drag = useRef<{ x: number, y: number, vx: number, vy: number } | null>(null)
  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const k = e.deltaY > 0 ? 1.12 : 1 / 1.12
    const px = view.x + ((e.clientX - r.left) / r.width) * view.w
    const py = view.y + ((e.clientY - r.top) / r.height) * view.h
    setView({ x: px - (px - view.x) * k, y: py - (py - view.y) * k, w: view.w * k, h: view.h * k })
  }
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y } }
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const r = svgRef.current!.getBoundingClientRect()
    setView((v) => ({ ...v, x: drag.current!.vx - ((e.clientX - drag.current!.x) / r.width) * v.w, y: drag.current!.vy - ((e.clientY - drag.current!.y) / r.height) * v.h }))
  }
  const onUp = () => { drag.current = null }

  const qy = layout.height / 2
  const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`

  return (
    <div className='mindmap'>
      <svg ref={svgRef} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
        {/* domanda → temi → ricordi / EN: question → themes → memories */}
        {layout.themes.map((t) => <path key={`q${t.id}`} d={curve(COL.question + QW, qy, t.x, t.y)} className='mm-edge' />)}
        {map.themes.map((t) => {
          const th = layout.themes.find((x) => x.id === t.id)!
          return t.memories.filter((id) => layout.placed.has(id)).map((id) => {
            const p = layout.placed.get(id)!
            return <path key={`t${t.id}-${id}`} d={curve(th.x + TW, th.y, p.x, p.y + CARD.h / 2)} className='mm-edge' />
          })
        })}
        {/* ricordo → vicini espansi / EN: memory → expanded neighbors */}
        {Object.entries(extra).flatMap(([from, e]) => e.memories.filter((n) => layout.placed.get(n.id)?.extra).map((n) => {
          const a = layout.placed.get(from)
          const b = layout.placed.get(n.id)!
          return a ? <path key={`x${from}-${n.id}`} d={curve(a.x + CARD.w, a.y + CARD.h / 2, b.x, b.y + CARD.h / 2)} className='mm-edge extra' /> : null
        }))}
        {/* collegamenti fra ricordi: archi sul lato destro delle schede / EN: links between memories: arcs on the right side of the cards */}
        {layout.links.map((l) => {
          const a = layout.placed.get(l.source)!
          const b = layout.placed.get(l.target)!
          if (a.extra || b.extra) return null
          // Sempre quelli del dreaming; gli altri solo intorno al ricordo sotto il mouse o illuminato
          // EN: Always the dreaming ones; the others only around the memory under the mouse or highlighted
          const near = (id: string) => id === hover || id === focus
          if (l.kind !== 'dream' && !near(l.source) && !near(l.target)) return null
          const x = a.x + CARD.w
          const y1 = a.y + CARD.h / 2
          const y2 = b.y + CARD.h / 2
          const bulge = 30 + Math.min(120, Math.abs(y2 - y1) / 4)
          const label = l.kind === 'dream' && l.rel ? s.rel[l.rel] ?? l.rel : s.kind[l.kind] ?? l.kind
          return (
            <path key={`l${l.source}${l.target}`} d={`M${x},${y1} C${x + bulge},${y1} ${x + bulge},${y2} ${x},${y2}`} className={`mm-link ${l.kind} ${l.rel ?? ''}`}>
              <title>{label}</title>
            </path>
          )
        })}

        {/* nodi / EN: nodes */}
        <foreignObject x={COL.question} y={qy - 40} width={QW} height={80}>
          <div className='mm-question'>{map.question}</div>
        </foreignObject>
        {layout.themes.map((t) => {
          const toggle = () => setOpenThemes((o) => { const n = new Set(o); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n })
          return (
            <g key={t.id}>
              <foreignObject x={t.x} y={t.y - 18} width={TW} height={36}>
                <div className='mm-theme' title={t.label} onClick={toggle} style={{ cursor: 'pointer' }}>{t.label}</div>
              </foreignObject>
              {(t.hidden > 0 || openThemes.has(t.id)) && (
                <foreignObject x={COL.memory} y={t.bottom - 20} width={CARD.w} height={22}>
                  <button className='mm-more' onClick={toggle}>{t.hidden > 0 ? s.more(t.hidden) : s.less}</button>
                </foreignObject>
              )}
            </g>
          )
        })}
        {[...layout.placed.values()].map((p) => (
          <foreignObject key={p.id} x={p.x} y={p.y} width={CARD.w} height={CARD.h}>
            <div className={`mm-card ${p.m.root ? 'root' : ''} ${p.m.found ? 'found' : ''} ${cited.has(p.id) ? 'cited' : ''} ${focus === p.id ? 'focus' : ''} ${p.extra ? 'extra' : ''}`} onClick={() => onOpen(p.m)} title={s.open}
              onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover((h) => (h === p.id ? null : h))}>
              <div className='mm-title'>{p.m.root && <span className='mm-root'>◆ </span>}{p.m.title}</div>
              <div className='mm-line'>{p.m.line}</div>
              {!p.extra && !extra[p.id] && <button className='mm-plus' title={s.expand} onClick={(e) => { e.stopPropagation(); onExpand(p.id) }}>+</button>}
            </div>
          </foreignObject>
        ))}
      </svg>
      <div className='mm-hint muted small'>{s.hint}</div>
    </div>
  )
}
