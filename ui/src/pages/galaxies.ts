/**
 * @file Galassie nelle viste grafiche (Nucleo 3D e Mappa 2D): cosa disegnare in un team grande.
 *
 * Con migliaia di ricordi disegnarli tutti dà un campo indistinto (e un browser lento). Il daemon
 * raggruppa i ricordi in GALASSIE (src/graph/communities.ts); qui si decide il LIVELLO della vista:
 *
 * - `all`: team piccolo (fino a GALAXY_THRESHOLD ricordi), tutto come sempre;
 * - `overview`: una stella per galassia, con nome e numero di ricordi, unite dai legami fra
 *   galassie. Con ricerca o filtri attivi si accendono le galassie che contengono risultati;
 * - `galaxy`: dentro una galassia, i suoi ricordi (al massimo STAR_BUDGET: le Radici, quelli
 *   accesi e i più vivi);
 * - `filtered`: ricerca o filtri con pochi risultati (fino a GALAXY_THRESHOLD): si vedono solo
 *   quelli, da qualunque galassia, senza dover entrare in ognuna.
 *
 * Funzioni pure, testate in __tests__/galaxies.test.ts.
 */
import type { Galaxy, Graph, GraphLink, GraphNode } from '../api/client'
import type { TourStop } from './nucleus/tour'

/** Oltre questo numero di ricordi le viste partono dalla vista d'insieme per galassie. */
export const GALAXY_THRESHOLD = 250
/** Stelle al massimo dentro una galassia (le altre si contano e basta). */
export const STAR_BUDGET = 600
/** Legami mostrati al massimo per galassia nella vista d'insieme (i più forti). */
const LINKS_PER_GALAXY = 3
/** Id dei nodi-galassia nelle viste: non si confondono con gli id dei ricordi. */
const PREFIX = 'galaxy:'

/** Nodo della vista d'insieme: una galassia intera. */
export interface GalaxyNode extends GraphNode {
  galaxyInfo: Galaxy & {
    /** Ricordi della galassia accesi da ricerca o filtri (null = nessun filtro attivo). */
    matches: number | null
  }
}

export type ViewNode = GraphNode | GalaxyNode

export type ViewLevel = 'all' | 'overview' | 'galaxy' | 'filtered'

export interface View {
  level: ViewLevel
  nodes: ViewNode[]
  links: GraphLink[]
  /** Nodi della vista accesi; null = tutti. */
  lit: Set<string> | null
  /** Galassia in cui si è entrati (livello `galaxy`). */
  galaxy: Galaxy | null
  /** Ricordi della galassia non disegnati per il limite STAR_BUDGET. */
  hidden: number
  /**
   * Chiave della STRUTTURA della vista (quali nodi): le librerie a forze rimettono in moto la
   * simulazione quando cambiano i dati, quindi si ricreano solo se cambia questa.
   */
  key: string
}

export function isGalaxyNode (n: unknown): n is GalaxyNode {
  return !!n && typeof n === 'object' && 'galaxyInfo' in n
}

/** Id del nodo che rappresenta una galassia nella vista d'insieme. */
export function galaxyNodeId (id: number): string {
  return PREFIX + id
}

/** true se il team è abbastanza grande (e diviso in più galassie) da usare la vista d'insieme. */
export function usesGalaxies (graph: Graph | undefined): boolean {
  return !!graph && graph.nodes.length > GALAXY_THRESHOLD && (graph.galaxies?.length ?? 0) > 1
}

/**
 * Cosa disegnare.
 * @param galaxy galassia in cui si è entrati (null = nessuna)
 * @param lit ricordi accesi da ricerca, filtri o tappa del tour (null = nessun filtro)
 * @param focusGalaxy galassia da accendere nella vista d'insieme (tappa del tour)
 */
export function buildView (graph: Graph | undefined, galaxy: number | null, lit: Set<string> | null, focusGalaxy: number | null = null): View {
  const nodes = graph?.nodes ?? []
  const links = graph?.links ?? []
  if (!graph || !usesGalaxies(graph)) return { level: 'all', nodes, links, lit, galaxy: null, hidden: 0, key: 'all' }

  // Dentro una galassia
  const info = galaxy !== null ? graph.galaxies!.find((g) => g.id === galaxy) : undefined
  if (info) {
    const members = nodes.filter((n) => n.galaxy === info.id)
    // Priorità per il limite di stelle: accesi, Radici, poi i più vivi
    const rank = (n: GraphNode) => (lit?.has(n.id) ? 2 : 0) + (n.root ? 1 : 0)
    const shown = members.length <= STAR_BUDGET
      ? members
      : [...members].sort((a, b) => rank(b) - rank(a) || (b.activation ?? 0) - (a.activation ?? 0) || a.id.localeCompare(b.id)).slice(0, STAR_BUDGET)
    return {
      level: 'galaxy',
      nodes: shown,
      links: linksAmong(shown, links),
      lit: lit ? new Set(shown.filter((n) => lit.has(n.id)).map((n) => n.id)) : null,
      galaxy: info,
      hidden: members.length - shown.length,
      // Con il limite di stelle i ricordi mostrati dipendono anche da quelli accesi
      key: `galaxy:${info.id}:${shown.length < members.length ? shown.map((n) => n.id).join(',') : ''}`
    }
  }

  // Pochi risultati di ricerca o filtri: solo quelli
  if (lit && lit.size <= GALAXY_THRESHOLD) {
    const shown = nodes.filter((n) => lit.has(n.id))
    return { level: 'filtered', nodes: shown, links: linksAmong(shown, links), lit: null, galaxy: null, hidden: 0, key: `filtered:${shown.map((n) => n.id).join(',')}` }
  }

  // Vista d'insieme: una stella per galassia
  const matches = new Map<number, number>()
  if (lit) for (const n of nodes) if (lit.has(n.id)) matches.set(n.galaxy ?? -1, (matches.get(n.galaxy ?? -1) ?? 0) + 1)
  const galaxyNodes: GalaxyNode[] = graph.galaxies!.map((g) => ({
    id: galaxyNodeId(g.id),
    title: g.label,
    kind: 'galaxy',
    tags: g.tags,
    author: '',
    authorName: null,
    ts: 0,
    galaxyInfo: { ...g, matches: lit ? matches.get(g.id) ?? 0 : null }
  }))
  let litView: Set<string> | null = null
  if (focusGalaxy !== null) litView = new Set([galaxyNodeId(focusGalaxy)])
  else if (lit) litView = new Set(galaxyNodes.filter((g) => g.galaxyInfo.matches).map((g) => g.id))
  return { level: 'overview', nodes: galaxyNodes, links: overviewLinks(graph), lit: litView, galaxy: null, hidden: 0, key: 'overview' }
}

/** Collegamenti fra i soli nodi dati. */
function linksAmong (shown: GraphNode[], links: GraphLink[]): GraphLink[] {
  const ids = new Set(shown.map((n) => n.id))
  return links.filter((l) => ids.has(l.source) && ids.has(l.target))
}

/** Legami fra galassie: per ognuna i LINKS_PER_GALAXY più forti (tutti insieme sarebbero una ragnatela). */
function overviewLinks (graph: Graph): GraphLink[] {
  const all = [...(graph.galaxyLinks ?? [])].sort((a, b) => b.weight - a.weight)
  const used = new Map<number, number>()
  const out: GraphLink[] = []
  for (const l of all) {
    if ((used.get(l.source) ?? 0) >= LINKS_PER_GALAXY && (used.get(l.target) ?? 0) >= LINKS_PER_GALAXY) continue
    used.set(l.source, (used.get(l.source) ?? 0) + 1)
    used.set(l.target, (used.get(l.target) ?? 0) + 1)
    out.push({ source: galaxyNodeId(l.source), target: galaxyNodeId(l.target), weight: l.weight, kind: 'tags' })
  }
  return out
}

/**
 * Tappe del tour nella vista d'insieme: le galassie più grandi (non "altro"), al massimo `max`.
 * Ogni tappa porta l'id della galassia, che si accende e si inquadra.
 */
export function galaxyStops (graph: Graph, max = 8): (TourStop & { galaxy: number })[] {
  const byGalaxy = new Map<number, GraphNode[]>()
  for (const n of graph.nodes) {
    if (n.galaxy === undefined || n.galaxy < 0) continue
    if (!byGalaxy.has(n.galaxy)) byGalaxy.set(n.galaxy, [])
    byGalaxy.get(n.galaxy)!.push(n)
  }
  return (graph.galaxies ?? [])
    .filter((g) => g.id >= 0)
    .slice(0, max)
    .map((g) => {
      const members = byGalaxy.get(g.id) ?? []
      return {
        topic: g.label || g.tags[0] || String(g.id),
        ids: members.map((n) => n.id),
        authors: byFrequency(members.map((n) => n.authorName ?? n.author.slice(0, 8))),
        kinds: byFrequency(members.map((n) => n.kind)),
        galaxy: g.id
      }
    })
}

/** Elenco ordinato per frequenza decrescente (a parità, alfabetico). */
function byFrequency (values: string[]): string[] {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v)
}
