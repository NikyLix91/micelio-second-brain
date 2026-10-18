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
}

export interface GraphLink {
  source: string
  target: string
  /** Forza del legame, normalizzata fra 0 e 1. */
  weight: number
  /** Origine del legame: oggi solo "tags"; in futuro "semantic" e "dream". */
  kind: 'tags' | 'semantic' | 'dream'
}

export interface Graph { nodes: GraphNode[], links: GraphLink[] }

/** Collegamenti massimi per nodo (i più forti). */
export const MAX_LINKS_PER_NODE = 6

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
  for (const m of memories) for (const t of new Set(m.tags)) byTag.set(t, [...(byTag.get(t) ?? []), m.id])

  // Peso grezzo di ogni coppia: somma, sui tag condivisi, di log(N / ricordi con quel tag).
  // Un tag presente in tutti i ricordi vale log(1) = 0; uno raro vale molto.
  const n = Math.max(memories.length, 2)
  const pairWeight = new Map<string, number>()
  for (const ids of byTag.values()) {
    if (ids.length < 2) continue
    const idf = Math.log(n / ids.length)
    if (idf <= 0) continue
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`
        pairWeight.set(key, (pairWeight.get(key) ?? 0) + idf)
      }
    }
  }

  const candidates: GraphLink[] = []
  const max = Math.max(...pairWeight.values(), 0)
  for (const [key, w] of pairWeight) {
    const [source, target] = key.split('|')
    candidates.push({ source, target, weight: max > 0 ? w / max : 0, kind: 'tags' })
  }
  // Collegamenti da altre fonti: solo fra ricordi presenti nel grafo (es. non verso archiviati).
  const present = new Set(nodes.map((n) => n.id))
  candidates.push(...extraLinks.filter((l) => present.has(l.source) && present.has(l.target)))

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
