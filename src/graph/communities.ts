/**
 * @file Galassie: i ricordi raggruppati in comunità, per le viste di un team grande.
 *
 * EN: Galaxies: memories grouped into communities, for the views of a large team.
 *
 * Con centinaia o migliaia di ricordi la costellazione diventa un campo indistinto. Le galassie
 * ne danno una vista d'insieme: da lontano una galassia per argomento, con nome e numero di
 * ricordi; entrandoci si vedono le sue stelle (ui/src/pages/nucleus, Constellation).
 *
 * EN: With hundreds or thousands of memories the constellation becomes a shapeless field. Galaxies
 * give an overview of it: from afar, one galaxy per topic, with a name and a memory count;
 * zooming in shows its stars (ui/src/pages/nucleus, Constellation).
 *
 * Algoritmo, deterministico (stessi ricordi → stesse galassie, su ogni PC):
 * 1. **Louvain** sui collegamenti della costellazione (tag in comune, significato, dreaming):
 *    sposta ogni ricordo nella comunità che aumenta di più la modularità, poi riunisce ogni
 *    comunità in un nodo e ripete. Quasi lineare nel numero di collegamenti. La RISOLUZIONE si
 *    sceglie da sola (vedi RESOLUTIONS): la più bassa che non produce galassie giganti.
 *    Misurato su 5 000 ricordi di prova: con la propagazione delle etichette (la prima versione)
 *    una galassia raccoglieva 1 477 ricordi (purezza dell'argomento 41%); con Louvain la più
 *    grande ne ha 383 (purezza 65%), in circa 170 ms;
 * 2. le comunità **troppo piccole** confluiscono in quella vicina con cui hanno il legame più
 *    forte; i ricordi senza collegamenti vanno nella galassia "altro" (id -1);
 * 3. se restano **troppe** galassie, le più piccole confluiscono finché non sono al massimo
 *    MAX_GALAXIES (da lontano devono restare leggibili).
 * Il nome di una galassia sono i suoi tag più CARATTERISTICI: frequenti dentro, rari fuori
 * (frequenza × IDF), così due galassie non si chiamano entrambe con un tag usato ovunque.
 *
 * EN: Deterministic algorithm (same memories → same galaxies, on every PC):
 * 1. **Louvain** on the constellation links (shared tags, meaning, dreaming):
 *    moves each memory into the community that increases modularity the most, then collapses each
 *    community into a node and repeats. Nearly linear in the number of links. The RESOLUTION is
 *    picked automatically (see RESOLUTIONS): the lowest one that doesn't produce giant galaxies.
 *    Measured on 5,000 test memories: with label propagation (the first version) one galaxy
 *    gathered 1,477 memories (topic purity 41%); with Louvain the largest has 383 (purity 65%),
 *    in about 170 ms;
 * 2. communities that are **too small** merge into the neighbor they are most strongly linked
 *    to; memories without links go into the "other" galaxy (id -1);
 * 3. if **too many** galaxies remain, the smallest ones merge until there are at most
 *    MAX_GALAXIES (they must stay readable from afar).
 * A galaxy's name is its most CHARACTERISTIC tags: frequent inside, rare outside
 * (frequency × IDF), so two galaxies aren't both named after a tag used everywhere.
 *
 * Funzione pura: nessun accesso a rete o disco.
 *
 * EN: Pure function: no network or disk access.
 */
import type { GraphLink, GraphNode } from './constellation'

/** Galassie al massimo nella vista d'insieme. / EN: Maximum number of galaxies in the overview. */
export const MAX_GALAXIES = 40
/** Risoluzioni provate in ordine: più alta = galassie più piccole e numerose. / EN: Resolutions tried in order: higher = smaller and more numerous galaxies. */
const RESOLUTIONS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16]
/** Una galassia non dovrebbe superare questa quota dei ricordi (né, comunque, 150 ricordi). / EN: A galaxy shouldn't exceed this share of the memories (nor, in any case, 150 memories). */
const MAX_GALAXY_SHARE = 0.1
/** Galassie desiderate almeno (con abbastanza ricordi): poche galassie enormi non orientano. / EN: Minimum desired galaxies (with enough memories): a few huge galaxies don't help orientation. */
const MIN_GALAXIES = 8
/** Id della galassia dei ricordi senza collegamenti. / EN: Id of the galaxy of memories without links. */
export const OTHER_GALAXY = -1

export interface Galaxy {
  id: number
  /** Nome: i 2 tag più caratteristici (vuoto per la galassia "altro"). / EN: Name: the 2 most characteristic tags (empty for the "other" galaxy). */
  label: string
  tags: string[]
  size: number
  /** Radici contenute. / EN: Roots it contains. */
  roots: number
  /** I ricordi più vivi (attivazione), per l'anteprima. / EN: The most alive memories (activation), for the preview. */
  top: string[]
}

export interface Communities {
  /** Galassia di ogni ricordo. / EN: Galaxy of each memory. */
  of: Map<string, number>
  galaxies: Galaxy[]
}

/** Hash stabile di una stringa: ordine di visita deterministico ma non alfabetico. / EN: Stable string hash: deterministic but non-alphabetical visit order. */
function hash (s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h
}

/**
 * Raggruppa i ricordi in galassie.
 *
 * EN: Groups memories into galaxies.
 *
 * @param minSize comunità più piccole confluiscono nella vicina (default: 3, o 1/200 dei ricordi)
 *                EN: smaller communities merge into their neighbor (default: 3, or 1/200 of the memories)
 */
/**
 * @param sizing dimensioni desiderate, per usi diversi dalla vista d'insieme (es. i temi della chat,
 *               B10: pochi ricordi, gruppi piccoli): galassia più grande e quante almeno
 *               EN: desired sizes, for uses other than the overview (e.g. the chat themes,
 *               B10: few memories, small groups): largest galaxy and minimum count
 */
export function detectCommunities (nodes: GraphNode[], links: GraphLink[], minSize = Math.max(3, Math.round(nodes.length / 200)), sizing: { maxSize?: number, minCount?: number } = {}): Communities {
  // Adiacenza pesata, in entrambe le direzioni
  // EN: Weighted adjacency, in both directions
  const adj = new Map<string, Map<string, number>>()
  for (const n of nodes) adj.set(n.id, new Map())
  for (const l of links) {
    if (!adj.has(l.source) || !adj.has(l.target) || l.source === l.target) continue
    const w = Math.max(0.01, l.weight)
    adj.get(l.source)!.set(l.target, (adj.get(l.source)!.get(l.target) ?? 0) + w)
    adj.get(l.target)!.set(l.source, (adj.get(l.target)!.get(l.source) ?? 0) + w)
  }

  // 1. Louvain con la risoluzione più bassa che dà abbastanza galassie, nessuna gigante
  // EN: 1. Louvain with the lowest resolution that gives enough galaxies, none of them giant
  const order = nodes.map((n) => n.id).sort((a, b) => hash(a) - hash(b))
  const maxSize = sizing.maxSize ?? Math.max(150, Math.ceil(nodes.length * MAX_GALAXY_SHARE))
  const minCount = sizing.minCount ?? Math.min(MIN_GALAXIES, Math.floor(nodes.length / 50))
  let label = new Map<string, number>()
  let bestLargest = Infinity
  for (const r of RESOLUTIONS) {
    const candidate = louvain(order, adj, r)
    const sizes = new Map<number, number>()
    for (const [id, c] of candidate) if (adj.get(id)!.size) sizes.set(c, (sizes.get(c) ?? 0) + 1)
    let largest = 0
    for (const s of sizes.values()) if (s > largest) largest = s
    // conta solo le comunità che resteranno galassie (le piccole confluiscono nelle vicine)
    // EN: count only the communities that will remain galaxies (small ones merge into their neighbors)
    let count = 0
    for (const s of sizes.values()) if (s >= minSize) count++
    if (largest < bestLargest) { label = candidate; bestLargest = largest }
    if (largest <= maxSize && count >= minCount) { label = candidate; break }
  }

  // Raggruppa per etichetta
  // EN: Group by label
  const groups = new Map<number, Set<string>>()
  for (const [id, l] of label) {
    if (!adj.get(id)!.size) continue // isolati: "altro" / EN: isolated: "other"
    if (!groups.has(l)) groups.set(l, new Set())
    groups.get(l)!.add(id)
  }

  /** Fonde il gruppo `l` in quello vicino più legato; false se non ha vicini fuori da sé. / EN: Merges group `l` into its most strongly linked neighbor; false if it has no neighbors outside itself. */
  const mergeIntoNeighbor = (l: number): boolean => {
    const members = groups.get(l)!
    const toward = new Map<number, number>()
    for (const id of members) {
      for (const [nb, w] of adj.get(id)!) {
        const o = label.get(nb)!
        if (o !== l && groups.has(o)) toward.set(o, (toward.get(o) ?? 0) + w)
      }
    }
    if (!toward.size) return false
    const target = [...toward].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
    for (const id of members) { label.set(id, target); groups.get(target)!.add(id) }
    groups.delete(l)
    return true
  }

  // 2. Comunità troppo piccole → nella vicina; 3. troppe galassie → le più piccole confluiscono
  // EN: 2. Communities too small → into the neighbor; 3. too many galaxies → the smallest ones merge
  const bySize = () => [...groups].sort((a, b) => a[1].size - b[1].size || a[0] - b[0])
  for (const [l, members] of bySize()) if (groups.has(l) && members.size < minSize) mergeIntoNeighbor(l)
  while (groups.size > MAX_GALAXIES) {
    const smallest = bySize().find(([l]) => mergeIntoNeighbor(l))
    if (!smallest) break
  }

  // Assegnazione finale: id compatti per dimensione (0 = la più grande)
  // EN: Final assignment: compact ids by size (0 = the largest)
  const ranked = [...groups].sort((a, b) => b[1].size - a[1].size || a[0] - b[0])
  const of = new Map<string, number>()
  ranked.forEach(([, members], i) => { for (const id of members) of.set(id, i) })
  for (const n of nodes) if (!of.has(n.id)) of.set(n.id, OTHER_GALAXY)

  // Nomi: tag caratteristici (frequenza nella galassia × IDF sul team)
  // EN: Names: characteristic tags (frequency in the galaxy × IDF over the team)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const df = new Map<string, number>()
  for (const n of nodes) for (const t of new Set(n.tags)) df.set(t, (df.get(t) ?? 0) + 1)
  const describe = (id: number, members: string[]): Galaxy => {
    const tf = new Map<string, number>()
    for (const m of members) for (const t of new Set(byId.get(m)!.tags)) tf.set(t, (tf.get(t) ?? 0) + 1)
    const tags = [...tf]
      .map(([t, c]) => ({ t, score: (c / members.length) * Math.log(nodes.length / (df.get(t) ?? 1)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.t.localeCompare(b.t))
      .slice(0, 3)
      .map((x) => x.t)
    const top = [...members].sort((a, b) => (byId.get(b)!.activation ?? 0) - (byId.get(a)!.activation ?? 0)).slice(0, 5)
    return { id, label: id === OTHER_GALAXY ? '' : tags.slice(0, 2).join(' · '), tags, size: members.length, roots: members.filter((m) => byId.get(m)!.root).length, top }
  }
  const galaxies = ranked.map(([, members], i) => describe(i, [...members]))
  const others = nodes.filter((n) => of.get(n.id) === OTHER_GALAXY).map((n) => n.id)
  if (others.length) galaxies.push(describe(OTHER_GALAXY, others))
  return { of, galaxies }
}

/**
 * Louvain (modularità con risoluzione), deterministico: i nodi si visitano nell'ordine dato.
 * Fase 1: ogni nodo passa alla comunità vicina con il guadagno di modularità più alto, finché
 * nessuno si sposta. Fase 2: ogni comunità diventa un nodo e si ricomincia. Si ferma quando una
 * passata non sposta più nulla.
 *
 * EN: Louvain (modularity with resolution), deterministic: nodes are visited in the given order.
 * Phase 1: each node moves to the neighboring community with the highest modularity gain, until
 * nobody moves. Phase 2: each community becomes a node and it starts over. It stops when a
 * pass no longer moves anything.
 *
 * @returns comunità di ogni nodo (numeri arbitrari ma stabili)
 *          EN: community of each node (arbitrary but stable numbers)
 */
function louvain (order: string[], adjacency: Map<string, Map<string, number>>, resolution: number): Map<string, number> {
  const index = new Map(order.map((id, i) => [id, i]))
  let n = order.length
  let adj: Map<number, number>[] = order.map((id) => {
    const m = new Map<number, number>()
    for (const [nb, w] of adjacency.get(id)!) m.set(index.get(nb)!, w)
    return m
  })
  let member = order.map((_, i) => i) // nodo originale → nodo del livello attuale / EN: original node → node at the current level
  for (let pass = 0; pass < 10; pass++) {
    const k = adj.map((m) => { let s = 0; for (const w of m.values()) s += w; return s })
    let m2 = 0
    for (const x of k) m2 += x
    if (!m2) break
    const comm = Array.from({ length: n }, (_, i) => i)
    const tot = [...k]
    let any = false
    for (let it = 0, moved = true; moved && it < 20; it++) {
      moved = false
      for (let i = 0; i < n; i++) {
        const ci = comm[i]
        const toward = new Map<number, number>()
        for (const [j, w] of adj[i]) if (j !== i) toward.set(comm[j], (toward.get(comm[j]) ?? 0) + w)
        tot[ci] -= k[i]
        let best = ci
        let bestGain = (toward.get(ci) ?? 0) - resolution * tot[ci] * k[i] / m2
        for (const [c, w] of toward) {
          const gain = w - resolution * tot[c] * k[i] / m2
          if (gain > bestGain + 1e-12 || (Math.abs(gain - bestGain) <= 1e-12 && c < best)) { best = c; bestGain = gain }
        }
        tot[best] += k[i]
        if (best !== ci) { comm[i] = best; moved = true; any = true }
      }
    }
    if (!any) break
    // Ogni comunità diventa un nodo del livello successivo
    // EN: Each community becomes a node of the next level
    const relabel = new Map<number, number>()
    for (let i = 0; i < n; i++) if (!relabel.has(comm[i])) relabel.set(comm[i], relabel.size)
    const next: Map<number, number>[] = Array.from({ length: relabel.size }, () => new Map())
    for (let i = 0; i < n; i++) {
      for (const [j, w] of adj[i]) {
        const a = relabel.get(comm[i])!
        const b = relabel.get(comm[j])!
        if (a !== b) next[a].set(b, (next[a].get(b) ?? 0) + w)
      }
    }
    member = member.map((s) => relabel.get(comm[s])!)
    adj = next
    n = next.length
  }
  return new Map(order.map((id, i) => [id, member[i]]))
}

/**
 * Collegamenti fra galassie per la vista d'insieme: somma dei pesi dei collegamenti fra ricordi
 * di galassie diverse, normalizzata 0..1, tenendo per ogni galassia i 4 legami più forti.
 *
 * EN: Links between galaxies for the overview: sum of the weights of the links between memories
 * of different galaxies, normalized to 0..1, keeping the 4 strongest links for each galaxy.
 */
export function galaxyLinks (links: GraphLink[], of: Map<string, number>): { source: number, target: number, weight: number }[] {
  const sum = new Map<string, number>()
  for (const l of links) {
    const a = of.get(l.source)
    const b = of.get(l.target)
    if (a === undefined || b === undefined || a === b || a === OTHER_GALAXY || b === OTHER_GALAXY) continue
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    sum.set(key, (sum.get(key) ?? 0) + l.weight)
  }
  let max = 0
  for (const w of sum.values()) if (w > max) max = w
  const all = [...sum].map(([k, w]) => { const [a, b] = k.split('|').map(Number); return { source: a, target: b, weight: max ? w / max : 0 } })
  const kept = new Set<string>()
  const per = new Map<number, number>()
  for (const l of all.sort((x, y) => y.weight - x.weight)) {
    if ((per.get(l.source) ?? 0) >= 4 && (per.get(l.target) ?? 0) >= 4) continue
    kept.add(`${l.source}|${l.target}`)
    per.set(l.source, (per.get(l.source) ?? 0) + 1)
    per.set(l.target, (per.get(l.target) ?? 0) + 1)
  }
  return all.filter((l) => kept.has(`${l.source}|${l.target}`))
}
