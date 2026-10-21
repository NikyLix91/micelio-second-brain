/**
 * @file Galassie nelle viste grafiche (Nucleo 3D e Mappa 2D): cosa disegnare in un team grande.
 *
 * EN: Galaxies in the graphic views (3D Nucleus and 2D Map): what to draw in a large team.
 *
 * Con migliaia di ricordi disegnarli tutti dà un campo indistinto (e un browser lento). Il daemon
 * raggruppa i ricordi in GALASSIE (src/graph/communities.ts); qui si decide il LIVELLO della vista:
 *
 * EN: With thousands of memories, drawing them all gives a shapeless field (and a slow browser). The
 * daemon groups memories into GALAXIES (src/graph/communities.ts); here we pick the view LEVEL:
 *
 * - `all`: team piccolo (fino a GALAXY_THRESHOLD ricordi), tutto come sempre;
 * - `overview`: una stella per galassia, con nome e numero di ricordi, unite dai legami fra
 *   galassie. Con ricerca o filtri attivi si accendono le galassie che contengono risultati;
 * - `galaxy`: dentro una galassia, i suoi ricordi (al massimo STAR_BUDGET: le Radici, quelli
 *   accesi e i più vivi);
 * - `filtered`: ricerca o filtri con pochi risultati (fino a GALAXY_THRESHOLD): si vedono solo
 *   quelli, da qualunque galassia, senza dover entrare in ognuna.
 *
 * EN:
 * - `all`: small team (up to GALAXY_THRESHOLD memories), everything as usual;
 * - `overview`: one star per galaxy, with name and number of memories, joined by the links between
 *   galaxies. With search or filters active, the galaxies that contain results light up;
 * - `galaxy`: inside a galaxy, its memories (at most STAR_BUDGET: the Roots, the lit ones
 *   and the most alive);
 * - `filtered`: search or filters with few results (up to GALAXY_THRESHOLD): only those are shown,
 *   from any galaxy, without having to enter each one.
 *
 * Funzioni pure, testate in __tests__/galaxies.test.ts.
 *
 * EN: Pure functions, tested in __tests__/galaxies.test.ts.
 */
import type { Galaxy, Graph, GraphLink, GraphNode } from '../api/client'
import type { TourStop } from './nucleus/tour'

/** Oltre questo numero di ricordi le viste partono dalla vista d'insieme per galassie. / EN: Above this number of memories the views start from the galaxy overview. */
export const GALAXY_THRESHOLD = 250
/** Stelle al massimo dentro una galassia (le altre si contano e basta). / EN: Maximum stars inside a galaxy (the others are only counted). */
export const STAR_BUDGET = 600
/** Legami mostrati al massimo per galassia nella vista d'insieme (i più forti). / EN: Maximum links shown per galaxy in the overview (the strongest). */
const LINKS_PER_GALAXY = 3
/** Id dei nodi-galassia nelle viste: non si confondono con gli id dei ricordi. / EN: Ids of galaxy nodes in the views: they cannot be mistaken for memory ids. */
const PREFIX = 'galaxy:'

/** Nodo della vista d'insieme: una galassia intera. / EN: Overview node: a whole galaxy. */
export interface GalaxyNode extends GraphNode {
  galaxyInfo: Galaxy & {
    /** Ricordi della galassia accesi da ricerca o filtri (null = nessun filtro attivo). / EN: Galaxy memories lit by search or filters (null = no active filter). */
    matches: number | null
  }
}

export type ViewNode = GraphNode | GalaxyNode

export type ViewLevel = 'all' | 'overview' | 'galaxy' | 'filtered'

export interface View {
  level: ViewLevel
  nodes: ViewNode[]
  links: GraphLink[]
  /** Nodi della vista accesi; null = tutti. / EN: Lit view nodes; null = all. */
  lit: Set<string> | null
  /** Galassia in cui si è entrati (livello `galaxy`). / EN: Galaxy that was entered (`galaxy` level). */
  galaxy: Galaxy | null
  /** Ricordi della galassia non disegnati per il limite STAR_BUDGET. / EN: Galaxy memories not drawn because of the STAR_BUDGET limit. */
  hidden: number
  /**
   * Chiave della STRUTTURA della vista (quali nodi): le librerie a forze rimettono in moto la
   * simulazione quando cambiano i dati, quindi si ricreano solo se cambia questa.
   *
   * EN: Key of the view STRUCTURE (which nodes): force-layout libraries restart the simulation
   * when the data changes, so they are rebuilt only when this changes.
   */
  key: string
}

export function isGalaxyNode (n: unknown): n is GalaxyNode {
  return !!n && typeof n === 'object' && 'galaxyInfo' in n
}

/** Id del nodo che rappresenta una galassia nella vista d'insieme. / EN: Id of the node that represents a galaxy in the overview. */
export function galaxyNodeId (id: number): string {
  return PREFIX + id
}

/** true se il team è abbastanza grande (e diviso in più galassie) da usare la vista d'insieme. / EN: true if the team is large enough (and split into several galaxies) to use the overview. */
export function usesGalaxies (graph: Graph | undefined): boolean {
  return !!graph && graph.nodes.length > GALAXY_THRESHOLD && (graph.galaxies?.length ?? 0) > 1
}

/**
 * Cosa disegnare.
 *
 * EN: What to draw.
 * @param galaxy galassia in cui si è entrati (null = nessuna)
 *        EN: galaxy that was entered (null = none)
 * @param lit ricordi accesi da ricerca, filtri o tappa del tour (null = nessun filtro)
 *        EN: memories lit by search, filters or a tour stop (null = no filter)
 * @param focusGalaxy galassia da accendere nella vista d'insieme (tappa del tour)
 *        EN: galaxy to light up in the overview (tour stop)
 */
export function buildView (graph: Graph | undefined, galaxy: number | null, lit: Set<string> | null, focusGalaxy: number | null = null): View {
  const nodes = graph?.nodes ?? []
  const links = graph?.links ?? []
  if (!graph || !usesGalaxies(graph)) return { level: 'all', nodes, links, lit, galaxy: null, hidden: 0, key: 'all' }

  // Dentro una galassia
  // EN: Inside a galaxy
  const info = galaxy !== null ? graph.galaxies!.find((g) => g.id === galaxy) : undefined
  if (info) {
    const members = nodes.filter((n) => n.galaxy === info.id)
    // Priorità per il limite di stelle: accesi, Radici, poi i più vivi
    // EN: Priority for the star limit: lit ones, Roots, then the most alive
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
      // EN: With the star limit, the memories shown also depend on the lit ones
      key: `galaxy:${info.id}:${shown.length < members.length ? shown.map((n) => n.id).join(',') : ''}`
    }
  }

  // Pochi risultati di ricerca o filtri: solo quelli
  // EN: Few search or filter results: only those
  if (lit && lit.size <= GALAXY_THRESHOLD) {
    const shown = nodes.filter((n) => lit.has(n.id))
    return { level: 'filtered', nodes: shown, links: linksAmong(shown, links), lit: null, galaxy: null, hidden: 0, key: `filtered:${shown.map((n) => n.id).join(',')}` }
  }

  // Vista d'insieme: una stella per galassia
  // EN: Overview: one star per galaxy
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

/** Collegamenti fra i soli nodi dati. / EN: Links among the given nodes only. */
function linksAmong (shown: GraphNode[], links: GraphLink[]): GraphLink[] {
  const ids = new Set(shown.map((n) => n.id))
  return links.filter((l) => ids.has(l.source) && ids.has(l.target))
}

/** Legami fra galassie: per ognuna i LINKS_PER_GALAXY più forti (tutti insieme sarebbero una ragnatela). / EN: Links between galaxies: the LINKS_PER_GALAXY strongest for each one (all of them together would be a cobweb). */
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
 *
 * EN: Tour stops in the overview: the largest galaxies (not "other"), at most `max`.
 * Each stop carries the galaxy id, which lights up and gets framed.
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

/** Elenco ordinato per frequenza decrescente (a parità, alfabetico). / EN: List sorted by decreasing frequency (ties alphabetical). */
function byFrequency (values: string[]): string[] {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v)
}
