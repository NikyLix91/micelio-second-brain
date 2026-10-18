/**
 * @file Costellazione del sapere: il grafo mostrato nella schermata principale della UI.
 *
 * - NODI: i ricordi del team.
 * - COLLEGAMENTI: legami fra ricordi correlati, con un peso. Le fonti di correlazione crescono
 *   con le fasi del progetto:
 *     Fase 3  → tag in comune (peso = numero di tag condivisi, pesati per rarità);
 *     Fase 5  → affinità di significato (embedding);
 *     Fase 6  → collegamenti espliciti creati dal dreaming (memory.link).
 *   Ogni fonte aggiunge collegamenti con il proprio `kind`, così la UI può distinguerli.
 *
 * Per evitare il "gomitolo" (tutti collegati a tutti) ogni nodo tiene solo i suoi K
 * collegamenti più forti. Un tag usato da quasi tutti i ricordi (es. "test") conta poco:
 * il peso di un tag è inversamente proporzionale a quanti ricordi lo usano (stile IDF).
 *
 * Funzione pura: nessun accesso a rete o disco, quindi facile da testare.
 */
import type { RecallHit } from '../core/model'
import type { Galaxy } from './communities'

export interface GraphNode {
  id: string
  title: string
  kind: string
  tags: string[]
  author: string
  authorName: string | null
  ts: number
  /** Attivazione 0..1 (Fase 5), aggiunta dal nodo: i ricordi più "vivi" brillano di più. */
  activation?: number
  /** Presente se il ricordo è una Radice (Fase 8): le viste grafiche la marcano in modo distinto. */
  root?: { category: string, status: 'ok' | 'review' }
  /** Galassia del ricordo (src/graph/communities.ts); -1 = senza collegamenti ("altro"). */
  galaxy?: number
}

export interface GraphLink {
  source: string
  target: string
  /** Forza del legame, normalizzata fra 0 e 1. */
  weight: number
  /** Origine del legame: oggi solo "tags"; in futuro "semantic" e "dream". */
  kind: 'tags' | 'semantic' | 'dream'
}

export interface Graph {
  nodes: GraphNode[]
  links: GraphLink[]
  /** Galassie (comunità di ricordi) per la vista d'insieme dei team grandi. */
  galaxies?: Galaxy[]
  /** Legami fra galassie: somma dei collegamenti fra i loro ricordi, normalizzata 0..1. */
  galaxyLinks?: { source: number, target: number, weight: number }[]
}

/** Collegamenti massimi per nodo (i più forti). */
export const MAX_LINKS_PER_NODE = 6
/** Fino a quanti ricordi per tag si generano tutte le coppie; oltre, solo una "finestra" per ricordo. */
const TAG_ALL_PAIRS = 40
/** Ricordi successivi a cui si collega ogni ricordo di un tag molto usato (vedi buildGraph). */
const TAG_WINDOW = 12

/** Hash stabile di una stringa (FNV-1a): ordine deterministico ma non alfabetico. */
function stableHash (s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h
}

/**
 * Costruisce la costellazione dai ricordi.
 * @param memories ricordi con i loro tag (dall'indice locale)
 * @param extraLinks collegamenti da altre fonti (semantici, dreaming), già pesati 0..1
 */
export function buildGraph (memories: RecallHit[], extraLinks: GraphLink[] = []): Graph {
  const nodes: GraphNode[] = memories.map((m) => ({
    id: m.id, title: m.title, kind: m.kind, tags: m.tags, author: m.author, authorName: m.authorName, ts: m.ts
  }))

  // Indice inverso tag → ricordi che lo usano.
  const byTag = new Map<string, string[]>()
  for (const m of memories) {
    for (const t of new Set(m.tags)) {
      const list = byTag.get(t)
      if (list) list.push(m.id)
      else byTag.set(t, [m.id])
    }
  }

  // Peso grezzo di ogni coppia: somma, sui tag condivisi, di log(N / ricordi con quel tag).
  // Un tag presente in tutti i ricordi vale log(1) = 0; uno raro vale molto.
  // Tag molto usati: invece di TUTTE le coppie (700 ricordi = 245 000 coppie, poi quasi tutte
  // scartate perché ogni nodo tiene solo MAX_LINKS_PER_NODE collegamenti) ogni ricordo si collega
  // ai TAG_WINDOW successivi in un ordine stabile (hash dell'id). Il costo diventa lineare.
  const n = Math.max(memories.length, 2)
  const pairWeight = new Map<string, number>()
  const add = (a: string, b: string, w: number) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    pairWeight.set(key, (pairWeight.get(key) ?? 0) + w)
  }
  for (const ids of byTag.values()) {
    if (ids.length < 2) continue
    const idf = Math.log(n / ids.length)
    if (idf <= 0) continue
    if (ids.length <= TAG_ALL_PAIRS) {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) add(ids[i], ids[j], idf)
    } else {
      const ring = [...ids].sort((a, b) => stableHash(a) - stableHash(b))
      for (let i = 0; i < ring.length; i++) for (let k = 1; k <= TAG_WINDOW; k++) add(ring[i], ring[(i + k) % ring.length], idf)
    }
  }

  const candidates: GraphLink[] = []
  // Massimo con un ciclo: `Math.max(...valori)` passa i valori come argomenti e con centinaia di
  // migliaia di coppie supera lo stack (bug reale: daemon in crash oltre i 1 800 ricordi)
  let max = 0
  for (const w of pairWeight.values()) if (w > max) max = w
  for (const [key, w] of pairWeight) {
    const [source, target] = key.split('|')
    candidates.push({ source, target, weight: max > 0 ? w / max : 0, kind: 'tags' })
  }
  // Collegamenti da altre fonti: solo fra ricordi presenti nel grafo (es. non verso archiviati).
  const present = new Set(nodes.map((n) => n.id))
  for (const l of extraLinks) if (present.has(l.source) && present.has(l.target)) candidates.push(l)

  return { nodes, links: keepStrongest(candidates, MAX_LINKS_PER_NODE) }
}

/**
 * Tiene, per ogni nodo, al massimo `k` collegamenti, scegliendo i più forti.
 * Un collegamento sopravvive se è fra i k migliori di ALMENO uno dei suoi due estremi:
 * così i nodi "periferici" restano agganciati alla costellazione.
 */
export function keepStrongest (links: GraphLink[], k: number): GraphLink[] {
  const byNode = new Map<string, GraphLink[]>()
  for (const l of links) {
    byNode.set(l.source, [...(byNode.get(l.source) ?? []), l])
    byNode.set(l.target, [...(byNode.get(l.target) ?? []), l])
  }
  const kept = new Set<GraphLink>()
  for (const list of byNode.values()) {
    list.sort((a, b) => b.weight - a.weight).slice(0, k).forEach((l) => kept.add(l))
  }
  return [...kept]
}
