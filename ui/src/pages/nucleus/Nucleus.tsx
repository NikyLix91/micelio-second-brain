/**
 * @file Nucleo: la home di Micelio. Il sapere del team come un ologramma 3D navigabile.
 *
 * Cosa si vede:
 * - una sfera di ricordi luminosi (ambra/oro), uniti da "sinapsi" (i collegamenti fra ricordi
 *   correlati) percorse da impulsi di luce;
 * - anelli orbitali, meridiani e pulviscolo olografico che ruotano lentamente;
 * - un bagliore diffuso (UnrealBloomPass) che dà l'effetto ologramma.
 *
 * Come si naviga:
 * - LIBERO: trascina per ruotare, rotella per lo zoom, clic su un ricordo per volarci e leggerlo.
 *   Se nessuno tocca nulla per 20 secondi la sfera torna a ruotare da sola;
 * - GUIDATO: "Avvia esplorazione" fa volare la camera da un argomento all'altro (tour.ts), con
 *   una didascalia; si può andare avanti, indietro o fermarsi;
 * - RICERCA: accende i ricordi pertinenti, spegne gli altri e vola sul loro baricentro.
 *
 * Colori: "olografico" (ambra, intensità per attivazione), per autore o per tipo. Nelle modalità
 * a colori la LEGENDA è cliccabile: un clic isola un autore (o un tipo), un secondo clic mostra di
 * nuovo tutti. Il filtro si combina con la ricerca. `#/?colori=autore|tipo` apre già in quella modalità.
 *
 * RADICI (Fase 8): stanno al centro della sfera, con un anello luminoso attorno alla stella (rosso
 * se "da rivedere"); in modalità olografica la stella è ciano. "◆ Radici" isola solo le Radici.
 *
 * GALASSIE (team grandi, oltre GALAXY_THRESHOLD ricordi; vedi ../galaxies.ts): si parte dalla vista
 * d'insieme, un ammasso luminoso per galassia con nome e numero di ricordi; un clic ci entra, "◀
 * tutte le galassie" torna indietro. Il tour vola fra le galassie; ricerca e filtri con pochi
 * risultati mostrano solo quelli, con tanti accendono le galassie che li contengono.
 *
 * Questa pagina è caricata in modo pigro (React.lazy in App.tsx): three.js pesa, e le altre
 * schermate non devono pagarne il costo.
 */
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ForceGraph3D from 'react-force-graph-3d'
import * as THREE from 'three'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { api, type GraphNode } from '../../api/client'
import { MemoryPanel } from '../../components/MemoryPanel'
import { KIND_LABEL } from '../../format'
import { HelpButton } from '../../help'
import { defineStrings, useLang, useStrings } from '../../i18n'
import { authorColor, KIND_COLOR, registerAuthors, ROOT_STAR, rootRing } from '../colors'
import { buildView, galaxyStops, isGalaxyNode, usesGalaxies } from '../galaxies'
import { animateHologram, createHologram, galaxyMarker, HOLO, rootCrowding, rootMarker, SPHERE_RADIUS, sphericalForce, starSprite } from './hologram'
import { cameraFor, caption, centroid, computeTourStops, type TourStop } from './tour'

type ColorMode = 'holo' | 'author' | 'kind'

const S = defineStrings({
  it: {
    title: 'NUCLEO',
    stats: (m: number, r: number, a: number, l: number) => `${m} RICORDI · ${r} RADICI · ${a} AUTORI · ${l} SINAPSI`,
    highlight: 'Accendi un argomento…',
    modes: { holo: 'Olografico', author: 'Per autore', kind: 'Per tipo' } as Record<ColorMode, string>,
    rootsOnly: 'Mostra solo le Radici: il sapere fondante del team',
    roots: (n: number) => `◆ Radici ${n}`,
    startTour: '▶ Avvia esplorazione guidata',
    stop: '■ Stop',
    stopLabel: (i: number, n: number) => `TAPPA ${i} / ${n}`,
    lit: (n: number, relevant: boolean) => `${n} ricordi ${relevant ? 'pertinenti' : ''}`,
    to: (q: string) => `a «${q}»`,
    onlyRoots: 'solo Radici',
    by: (name: string) => `di ${name}`,
    ofKind: (k: string) => `di tipo ${k}`,
    empty: 'Il nucleo si accenderà con i primi ricordi del team.',
    showAll: 'Mostra tutti',
    isolate: 'Isola',
    showAllBtn: '✕ mostra tutti',
    galaxyStats: (g: number, m: number, r: number) => `${g} GALASSIE · ${m} RICORDI · ${r} RADICI`,
    insideStats: (m: number, l: number) => `${m} RICORDI · ${l} SINAPSI`,
    allGalaxies: '◀ Tutte le galassie',
    galaxyHint: 'Ogni ammasso è una galassia: ricordi dello stesso argomento. Clic per entrarci.',
    other: 'senza collegamenti',
    count: (n: number) => `${n} ricordi`,
    matches: (n: number) => `${n} pertinenti`,
    hidden: (n: number) => `+${n} ricordi meno vivi non disegnati: cercali per accenderli`,
    inGalaxies: (n: number) => `in ${n} galassie`
  },
  en: {
    title: 'NUCLEUS',
    stats: (m: number, r: number, a: number, l: number) => `${m} MEMORIES · ${r} ROOTS · ${a} AUTHORS · ${l} SYNAPSES`,
    highlight: 'Light up a topic…',
    modes: { holo: 'Holographic', author: 'By author', kind: 'By kind' } as Record<ColorMode, string>,
    rootsOnly: 'Show only the Roots: the foundational knowledge of the team',
    roots: (n: number) => `◆ Roots ${n}`,
    startTour: '▶ Start guided exploration',
    stop: '■ Stop',
    stopLabel: (i: number, n: number) => `STOP ${i} / ${n}`,
    lit: (n: number, relevant: boolean) => `${n} ${relevant ? 'relevant ' : ''}memories`,
    to: (q: string) => `to “${q}”`,
    onlyRoots: 'Roots only',
    by: (name: string) => `by ${name}`,
    ofKind: (k: string) => `of kind ${k}`,
    empty: 'The nucleus will light up with the first memories of the team.',
    showAll: 'Show all',
    isolate: 'Isolate',
    showAllBtn: '✕ show all',
    galaxyStats: (g: number, m: number, r: number) => `${g} GALAXIES · ${m} MEMORIES · ${r} ROOTS`,
    insideStats: (m: number, l: number) => `${m} MEMORIES · ${l} SYNAPSES`,
    allGalaxies: '◀ All galaxies',
    galaxyHint: 'Each cluster is a galaxy: memories on the same topic. Click to enter.',
    other: 'unlinked',
    count: (n: number) => `${n} memories`,
    matches: (n: number) => `${n} relevant`,
    hidden: (n: number) => `+${n} less active memories not drawn: search to light them up`,
    inGalaxies: (n: number) => `in ${n} galaxies`
  }
})

/** Distanza della camera dal centro durante il tour e dopo una ricerca. */
const TOUR_DISTANCE = SPHERE_RADIUS * 2.1
/** Durata di ogni tappa del tour automatico. */
const STOP_MS = 7000
/** Dopo quanto tempo di inattività la sfera ricomincia a ruotare da sola. */
const IDLE_MS = 20_000

export default function Nucleus () {
  const s = useStrings(S)
  const { lang } = useLang()
  const graph = useQuery({ queryKey: ['graph'], queryFn: api.graph })
  const status = useQuery({ queryKey: ['status'], queryFn: api.status })
  const fgRef = useRef<any>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [params] = useSearchParams()
  const initialMode: ColorMode = params.get('colori') === 'autore' ? 'author' : params.get('colori') === 'tipo' ? 'kind' : 'holo'
  const [mode, setMode] = useState<ColorMode>(initialMode)
  /** Voce della legenda isolata (chiave dell'autore o tipo), null = nessun filtro. */
  const [focus, setFocus] = useState<string | null>(null)
  /** Riferimento al bloom, per renderlo più tenue nelle modalità a colori. */
  const bloomRef = useRef<UnrealBloomPass | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [tourIndex, setTourIndex] = useState<number | null>(null)
  const [paused, setPaused] = useState(false)
  /** "◆ Radici": mostra accese solo le Radici. */
  const [rootsOnly, setRootsOnly] = useState(false)
  /**
   * Galassia in cui si è entrati, ricordata tramite un suo ricordo ("ancora"): gli id delle galassie
   * cambiano quando il daemon le ricalcola dopo una scrittura, il ricordo no.
   */
  const [anchor, setAnchor] = useState<string | null>(null)
  const big = usesGalaxies(graph.data)
  const galaxy = useMemo(() => (big && anchor ? graph.data!.nodes.find((n) => n.id === anchor)?.galaxy ?? null : null), [big, anchor, graph.data])

  // Tappe del tour: nella vista d'insieme le galassie; dentro una galassia i suoi argomenti
  const stops = useMemo<(TourStop & { galaxy?: number })[]>(() => {
    const nodes = graph.data?.nodes ?? []
    if (big && galaxy === null) return galaxyStops(graph.data!)
    return computeTourStops(galaxy !== null ? nodes.filter((n) => n.galaxy === galaxy) : nodes)
  }, [graph.data, big, galaxy])
  // `#/?tour=1` avvia subito l'esplorazione guidata (usato anche per catturare le schermate).
  useEffect(() => {
    if (params.get('tour') !== '1' || stops.length === 0) return
    const t = setTimeout(() => setTourIndex((i) => i ?? 0), 2500)
    return () => clearTimeout(t)
  }, [params, stops.length])
  const stop = tourIndex !== null ? stops[tourIndex] ?? null : null

  const q = query.trim()
  const search = useQuery({ queryKey: ['memories', 'nucleus-search', q], queryFn: () => api.search(q, 200), enabled: q.length >= 2 })

  // Colori degli autori: palette distinta, assegnata in ordine stabile a chi compare nel grafo.
  useMemo(() => registerAuthors((graph.data?.nodes ?? []).map((n) => n.author)), [graph.data])

  /**
   * Ricordi "accesi": quelli della tappa del tour o della ricerca, intersecati con la voce della
   * legenda isolata (autore o tipo). null = tutti accesi.
   */
  const lit = useMemo<Set<string> | null>(() => {
    let set: Set<string> | null = null
    // La tappa di una galassia accende la galassia (vedi buildView), non i singoli ricordi
    if (stop && stop.galaxy === undefined) set = new Set(stop.ids)
    else if (q.length >= 2 && search.data) set = new Set(search.data.map((h) => h.id))
    if (focus && mode !== 'holo') {
      const match = (graph.data?.nodes ?? []).filter((n) => (mode === 'author' ? n.author : n.kind) === focus).map((n) => n.id)
      set = set ? new Set(match.filter((id) => set!.has(id))) : new Set(match)
    }
    if (rootsOnly) {
      const roots = (graph.data?.nodes ?? []).filter((n) => n.root).map((n) => n.id)
      set = set ? new Set(roots.filter((id) => set!.has(id))) : new Set(roots)
    }
    return set
  }, [stop, q, search.data, focus, mode, graph.data, rootsOnly])

  // ── Cosa disegnare: tutto, galassie, una galassia o solo i risultati (../galaxies.ts) ──
  const view = useMemo(() => buildView(graph.data, galaxy, lit, stop?.galaxy ?? null), [graph.data, galaxy, lit, stop])
  /** Nodi accesi DELLA VISTA (ricordi o galassie); null = tutti. */
  const vlit = view.lit

  // Oggetto stabile: la libreria aggiunge x/y/z/vx… ai nodi, va ricreato solo quando cambia la
  // STRUTTURA della vista (view.key) o arrivano dati nuovi, non a ogni accensione.
  const data = useMemo(() => ({
    nodes: view.nodes.map((n) => ({ ...n })),
    links: view.links.map((l) => ({ ...l }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [graph.data, view.key])

  /** Numero di collegamenti per nodo: i ricordi più "connessi" brillano di più. */
  const degree = useMemo(() => {
    const d = new Map<string, number>()
    for (const l of data.links) {
      d.set(l.source, (d.get(l.source) ?? 0) + 1)
      d.set(l.target, (d.get(l.target) ?? 0) + 1)
    }
    return d
  }, [data])

  /**
   * Con molte Radici ognuna è un po' meno luminosa: insieme non devono accecare (vedi rootCrowding).
   * Conta le Radici ACCESE (tutte se nulla è filtrato): con filtri per autore o tipo, ricerca o tour
   * le Radici accese possono essere decine, e a piena luce tornerebbero una palla bianca.
   */
  const crowd = useMemo(() => {
    const roots = view.nodes.filter((n) => n.root && (!vlit || vlit.has(n.id)))
    return rootCrowding(roots.length)
  }, [view.nodes, vlit])

  // Vista d'insieme: pochi ammassi grandi, vanno tenuti più distanti fra loro
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    const overview = view.level === 'overview'
    fg.d3Force('charge')?.strength(overview ? -400 : -18)
    fg.d3Force('link')?.distance(overview ? 90 : 30)
    fg.d3ReheatSimulation?.()
  }, [view.level])

  // Cambio di livello (entrata o uscita da una galassia, risultati filtrati): camera al punto di partenza
  useEffect(() => {
    fgRef.current?.cameraPosition({ x: 0, y: 20, z: SPHERE_RADIUS * 2.6 }, { x: 0, y: 0, z: 0 }, 1200)
  }, [view.level, galaxy])

  // Nelle modalità a colori il bagliore pieno satura tutto in bianco e la tinta non si vede:
  // lo attenuiamo; in "olografico" torna pieno.
  useEffect(() => {
    if (bloomRef.current) bloomRef.current.strength = mode === 'holo' ? 1.35 : 0.45
  }, [mode])

  // ── Dimensioni ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!boxRef.current) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [])

  // ── Scena: bloom, ologramma, forze, rotazione automatica ───────────────────────────
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    // Bagliore: forza 1.35, raggio 0.4, soglia 0.22. La soglia esclude dal bagliore gli elementi
    // tenui (pulviscolo, linee sottili): con una soglia più bassa si sommano in un velo grigio
    // che schiarisce lo sfondo. Brillano solo i ricordi e gli impulsi.
    // Parametri regolabili da URL per prove visive: #/?bs=forza&br=raggio&bt=soglia
    const hp = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    const num = (k: string, d: number) => (hp.get(k) !== null ? Number(hp.get(k)) : d)
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), num('bs', initialMode === 'holo' ? 1.35 : 0.45), num('br', 0.4), num('bt', 0.22))
    bloomRef.current = bloom
    // Il bloom va inserito PRIMA del passaggio finale di conversione colore (OutputPass).
    // Aggiunto in coda, la conversione sRGB veniva applicata due volte: sfondo grigio-blu
    // invece che nero e colori slavati.
    const composer = fg.postProcessingComposer()
    const outIdx = composer.passes.findIndex((p: any) => p.isOutputPass)
    // `#/?bloom=0` disattiva il bagliore (diagnostica, o PC con grafica debole).
    const bloomOn = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('bloom') !== '0'
    if (bloomOn) {
      if (outIdx >= 0) composer.insertPass(bloom, outIdx)
      else { composer.addPass(bloom); composer.addPass(new OutputPass()) }
    }

    const holo = createHologram()
    fg.scene().add(holo)

    // Disposizione sferica e repulsione ridotta (altrimenti i nodi esplodono fuori dalla sfera).
    fg.d3Force('sphere', sphericalForce())
    fg.d3Force('charge')?.strength(-18)
    fg.d3Force('link')?.distance(30)

    // Camera iniziale: un po' lontana, poi un lento avvicinamento d'effetto.
    fg.cameraPosition({ x: 0, y: 40, z: SPHERE_RADIUS * 4 })
    setTimeout(() => fg.cameraPosition({ x: 0, y: 20, z: SPHERE_RADIUS * 2.6 }, { x: 0, y: 0, z: 0 }, 2500), 300)

    const controls = fg.controls()
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.35
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    // Quando l'utente interagisce la rotazione si ferma, e riparte dopo un po' di inattività.
    const onStart = () => {
      controls.autoRotate = false
      if (idleTimer) clearTimeout(idleTimer)
    }
    const onEnd = () => {
      idleTimer = setTimeout(() => { controls.autoRotate = true }, IDLE_MS)
    }
    controls.addEventListener('start', onStart)
    controls.addEventListener('end', onEnd)

    let raf = 0
    const tick = () => { animateHologram(holo); raf = requestAnimationFrame(tick) }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      if (idleTimer) clearTimeout(idleTimer)
      controls.removeEventListener('start', onStart)
      controls.removeEventListener('end', onEnd)
      fg.scene().remove(holo)
      if (bloomOn) fg.postProcessingComposer().removePass(bloom)
    }
    // Volutamente solo all'avvio: le dimensioni del bloom si aggiornano con il renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Vola sul baricentro di un insieme di ricordi, guardandolo da fuori la sfera. */
  const flyTo = useCallback((ids: Set<string>, ms = 2200) => {
    const fg = fgRef.current
    if (!fg || ids.size === 0) return
    const pts = data.nodes.filter((n: any) => ids.has(n.id) && n.x !== undefined) as any[]
    const c = centroid(pts)
    fg.controls().autoRotate = false
    // Distanza dal centro: almeno TOUR_DISTANCE, e comunque tale che il gruppo entri tutto
    // nell'inquadratura con margine (gruppi ampi o fitti di Radici, vedi rootCrowding)
    const spread = pts.reduce((m, p) => Math.max(m, Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z)), 0)
    fg.cameraPosition(cameraFor(c, Math.max(TOUR_DISTANCE, Math.hypot(c.x, c.y, c.z) + 3 * spread + 60)), c, ms)
  }, [data])

  // ── Tour guidato ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!stop) return
    flyTo(new Set(stop.ids))
    if (paused) return
    // Avanza alla tappa successiva; alla fine ricomincia dalla prima.
    const t = setTimeout(() => setTourIndex((i) => (i === null ? null : (i + 1) % stops.length)), STOP_MS)
    return () => clearTimeout(t)
  }, [stop, paused, stops.length, flyTo])

  const startTour = () => { setQuery(''); setSelected(null); setPaused(false); setTourIndex(0) }
  const stopTour = () => {
    setTourIndex(null)
    fgRef.current?.cameraPosition({ x: 0, y: 20, z: SPHERE_RADIUS * 2.6 }, { x: 0, y: 0, z: 0 }, 2000)
    if (fgRef.current) fgRef.current.controls().autoRotate = true
  }

  // Ricerca: quando arrivano i risultati voliamo sui ricordi pertinenti.
  useEffect(() => {
    if (tourIndex === null && vlit && vlit.size > 0) flyTo(vlit, 1600)
  }, [vlit, tourIndex, flyTo])

  // ── Aspetto dei ricordi ─────────────────────────────────────────────────────────────
  const colorOf = useCallback((n: GraphNode): string => {
    if (mode === 'author') return authorColor(n.author)
    if (mode === 'kind') return KIND_COLOR[n.kind] ?? HOLO.amber
    // Olografico: i ricordi più "vivi" (attivazione alta, Fase 5) tendono al bianco-oro,
    // quelli poco usati e vecchi all'ambra profonda.
    const a = n.activation ?? 0.5
    return a >= 0.6 ? HOLO.gold : a >= 0.35 ? HOLO.amber : HOLO.deep
  }, [mode, degree])

  // Ricreato quando cambiano colori, accensioni o selezione: la libreria rigenera gli sprite.
  const nodeObject = useCallback((n: any) => {
    const on = !vlit || vlit.has(n.id)
    if (isGalaxyNode(n)) {
      // Galassia: ammasso grande quanto la radice quadrata dei ricordi, con nome e numero
      const g = n.galaxyInfo
      const name = g.id < 0 ? s.other : g.label || g.tags[0] || '·'
      const count = g.matches !== null ? s.matches(g.matches) : s.count(g.size)
      return galaxyMarker(on ? HOLO.amber : '#8a6a3a', 8 + 1.6 * Math.sqrt(g.size), `${name} · ${count}`, on ? 1 : 0.3, g.roots > 0)
    }
    // Stelle piccole: il fascino è nei dettagli fini, il bloom fa il resto.
    // Dimensione: collegamenti e attivazione (un ricordo vivo e centrale è una stella più grande).
    const base = 3.2 + Math.min(5, (degree.get(n.id) ?? 0) * 0.6) + (n.activation ?? 0.5) * 3
    const size = n.id === selected?.id ? base * 2.2 : on && vlit ? base * 1.5 : base
    // I ricordi esclusi da tour/ricerca restano visibili ma tenui: danno il contesto.
    // Nelle modalità a colori stelle un po' più piccole e non sature: la tinta resta leggibile.
    const colored = mode !== 'holo'
    if (n.root) {
      // Radice: stella ciano in olografico (colore di modalità altrimenti) + anello luminoso
      const star = on ? (colored ? colorOf(n) : ROOT_STAR) : '#5a6a6a'
      // Radice spenta (fuori da filtro, ricerca o tappa): puntino tenue SENZA anello. Gli anelli
      // sono la parte più grande e luminosa: decine di anelli spenti sommati coprono quelli accesi.
      if (!on) return starSprite('#5a6a6a', size * 0.6, 0.25)
      // Solo la Radice selezionata resta piena; le altre più piccole e tenui se quelle accese sono tante
      const c = n.id === selected?.id ? 1 : crowd
      // Niente ingrandimento delle Radici accese (×1,5 per gli altri ricordi): si riconoscono già da
      // colore e anello, e ingrandite si fondono fra loro
      const rs = n.id === selected?.id ? size : base
      return rootMarker(star, rootRing(n.root.status), (colored ? rs * 0.85 : rs) * 1.15 * (0.5 + 0.5 * c), c, c)
    }
    return starSprite(on ? colorOf(n) : '#8a6a3a', colored ? size * 0.85 : size, on ? (colored ? 0.9 : 1) : 0.4)
  }, [vlit, degree, selected, colorOf, mode, crowd, s])

  const linkOn = (l: any) => !vlit || (vlit.has(l.source.id ?? l.source) && vlit.has(l.target.id ?? l.target))

  const all = graph.data?.nodes ?? []
  const rootCount = all.filter((n) => n.root).length
  const stats = view.level === 'overview'
    ? s.galaxyStats(view.nodes.length, all.length, rootCount)
    : view.level === 'galaxy'
      ? s.insideStats(view.nodes.length + view.hidden, data.links.length)
      : s.stats(data.nodes.length, data.nodes.filter((n) => n.root).length, new Set(data.nodes.map((n) => n.author)).size, data.links.length)
  /** Nome della galassia in cui si è entrati, per il percorso nell'HUD. */
  const galaxyName = view.galaxy ? (view.galaxy.id < 0 ? s.other : view.galaxy.label || view.galaxy.tags[0]) : null

  return (
    <div className='nucleus' ref={boxRef}>
      <ForceGraph3D
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={data}
        backgroundColor={HOLO.background}
        controlType='orbit'
        showNavInfo={false}
        nodeThreeObject={nodeObject}
        nodeLabel={(n: any) => `<div class="hud-tip">${escapeHtml(n.title)}</div>`}
        // Sinapsi: ambra per i legami da tag/significato, oro pieno per quelli creati dal dreaming.
        linkColor={(l: any) => (!linkOn(l) ? '#3a2c18' : l.kind === 'dream' ? HOLO.gold : HOLO.amber)}
        linkOpacity={0.22}
        linkWidth={0}
        // Impulsi di luce che percorrono le sinapsi più forti: il "pensiero" che scorre.
        linkDirectionalParticles={(l: any) => (linkOn(l) && l.weight > 0.35 ? 2 : 0)}
        linkDirectionalParticleWidth={1.4}
        linkDirectionalParticleSpeed={(l: any) => 0.002 + l.weight * 0.006}
        linkDirectionalParticleColor={() => HOLO.gold}
        warmupTicks={60}
        cooldownTicks={200}
        onNodeClick={(n: any) => {
          setTourIndex(null)
          // Galassia: ci si entra (ancorandola al suo ricordo più vivo, vedi `anchor`)
          if (isGalaxyNode(n)) {
            setSelected(null)
            setAnchor(n.galaxyInfo.top[0] ?? null)
            return
          }
          setSelected(n)
          // Vola sul ricordo, guardandolo da fuori la sfera.
          const dist = Math.hypot(n.x, n.y, n.z) + 70
          fgRef.current?.controls() && (fgRef.current.controls().autoRotate = false)
          fgRef.current?.cameraPosition(cameraFor(n, dist), n, 1500)
        }}
        onBackgroundClick={() => setSelected(null)}
      />

      {/* ── HUD: titolo e statistiche ─────────────────────────────────────── */}
      <div className='hud hud-top-left'>
        <div className='hud-title'>{s.title}{status.data?.team ? ` · ${status.data.team.name.toUpperCase()}` : ''} <HelpButton topic='views#nucleus' /></div>
        <div className='hud-sub'>{stats}</div>
        {galaxyName !== null && (
          <div className='row' style={{ marginTop: 8 }}>
            <button className='hud-btn' onClick={() => { setAnchor(null); setSelected(null); setTourIndex(null) }}>{s.allGalaxies}</button>
            <span className='hud-topic' style={{ fontSize: 16 }}>✦ {galaxyName}</span>
          </div>
        )}
        {view.hidden > 0 && <div className='hud-sub' style={{ marginTop: 6 }}>{s.hidden(view.hidden)}</div>}
      </div>

      {/* ── HUD: comandi ──────────────────────────────────────────────────── */}
      <div className='hud hud-top-right'>
        <input className='hud-input' placeholder={s.highlight} value={query} onChange={(e) => { setTourIndex(null); setQuery(e.target.value) }} />
        <div className='row'>
          {(['holo', 'author', 'kind'] as ColorMode[]).map((m) => (
            <button key={m} className={`hud-btn ${mode === m ? 'on' : ''}`} onClick={() => { setMode(m); setFocus(null) }}>
              {s.modes[m]}
            </button>
          ))}
          <button className={`hud-btn ${rootsOnly ? 'on' : ''}`} disabled={rootCount === 0} title={s.rootsOnly} onClick={() => { setTourIndex(null); setRootsOnly(!rootsOnly) }}>
            {s.roots(rootCount)}
          </button>
        </div>
        {tourIndex === null
          ? <button className='hud-btn primary' disabled={stops.length === 0} onClick={startTour}>{s.startTour}</button>
          : (
            <div className='row'>
              <button className='hud-btn' onClick={() => setTourIndex((i) => ((i ?? 0) - 1 + stops.length) % stops.length)}>◀</button>
              <button className='hud-btn' onClick={() => setPaused(!paused)}>{paused ? '▶' : '❚❚'}</button>
              <button className='hud-btn' onClick={() => setTourIndex((i) => ((i ?? 0) + 1) % stops.length)}>▶</button>
              <button className='hud-btn' onClick={stopTour}>{s.stop}</button>
            </div>
            )}
        {mode !== 'holo' && <Legend nodes={graph.data?.nodes ?? []} mode={mode} focus={focus} onFocus={(k) => { setTourIndex(null); setFocus(focus === k ? null : k) }} />}
      </div>

      {/* ── HUD: didascalia della tappa del tour ─────────────────────────── */}
      {stop && (
        <div className='hud hud-caption'>
          <div className='hud-sub'>{s.stopLabel((tourIndex ?? 0) + 1, stops.length)}</div>
          <div className='hud-topic'>#{stop.topic}</div>
          <div>{caption(stop, (k) => KIND_LABEL[k] ?? k, lang)}</div>
        </div>
      )}
      {!stop && !lit && view.level === 'overview' && (
        <div className='hud hud-caption'><div>{s.galaxyHint}</div></div>
      )}
      {!stop && lit && (
        <div className='hud hud-caption'>
          <div className='hud-topic'>{s.lit(lit.size, q.length >= 2)}</div>
          <div>
            {view.level === 'overview' && vlit && <>{s.inGalaxies(vlit.size)} · </>}
            {q.length >= 2 && <>{s.to(q)}</>}
            {rootsOnly && <>{q.length >= 2 || focus ? ' · ' : ''}{s.onlyRoots}</>}
            {focus && <>{q.length >= 2 ? ' · ' : ''}{mode === 'author' ? s.by(graph.data?.nodes.find((n) => n.author === focus)?.authorName ?? focus.slice(0, 8)) : s.ofKind(KIND_LABEL[focus] ?? focus)}</>}
          </div>
        </div>
      )}

      {data.nodes.length === 0 && !graph.isLoading && (
        <div className='hud hud-center'>{s.empty}</div>
      )}

      {selected && (
        <div className='nucleus-panel'>
          <MemoryPanel node={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  )
}

/**
 * Legenda cliccabile delle modalità a colori: un clic isola quella voce (autore o tipo), un
 * secondo clic sulla stessa voce rimuove il filtro. Mostra anche quanti ricordi ha ogni voce.
 */
function Legend ({ nodes, mode, focus, onFocus }: { nodes: GraphNode[], mode: ColorMode, focus: string | null, onFocus: (key: string) => void }) {
  const s = useStrings(S)
  const count = (pred: (n: GraphNode) => boolean) => nodes.filter(pred).length
  const entries = mode === 'kind'
    ? [...new Set(nodes.map((n) => n.kind))].map((k) => ({ key: k, label: KIND_LABEL[k] ?? k, color: KIND_COLOR[k] ?? HOLO.amber, n: count((x) => x.kind === k) }))
    : [...new Map(nodes.map((n) => [n.author, n.authorName ?? n.author.slice(0, 8)]))].map(([k, label]) => ({ key: k, label, color: authorColor(k), n: count((x) => x.author === k) }))
  return (
    <div className='hud-legend'>
      {entries.map((e) => (
        <button key={e.key} className={`hud-legend-item ${focus === e.key ? 'on' : ''} ${focus && focus !== e.key ? 'off' : ''}`} onClick={() => onFocus(e.key)} title={focus === e.key ? s.showAll : s.isolate}>
          <span className='dot' style={{ background: e.color, boxShadow: `0 0 6px ${e.color}` }} /> {e.label} <span className='hud-legend-count'>{e.n}</span>
        </button>
      ))}
      {focus && <button className='hud-legend-item' onClick={() => onFocus(focus)}>{s.showAllBtn}</button>}
    </div>
  )
}

/** I titoli dei ricordi arrivano da altri nodi: nel tooltip HTML vanno sempre "neutralizzati". */
function escapeHtml (s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
