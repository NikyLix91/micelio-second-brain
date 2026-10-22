/**
 * @file Sinapsi d'uso (B12): due ricordi che servono nella stessa sessione si legano.
 *
 * EN: Use synapses (B12): two memories that help in the same session become linked.
 *
 * È l'apprendimento hebbiano ("neuroni che si attivano insieme si collegano"), idea presa da
 * Spector (`CoActivationMemory`), vedi PLAN B12. Le altre sinapsi della costellazione dicono che due
 * ricordi PARLANO della stessa cosa (tag, significato) o che il dreaming li ha collegati; questa dice
 * che SERVONO insieme nel lavoro vero: chi tocca la configurazione del gateway di solito ha bisogno
 * anche della procedura di deploy, anche se i due testi non si somigliano.
 *
 * EN: It's Hebbian learning ("neurons that fire together wire together"), idea taken from Spector
 * (`CoActivationMemory`), see PLAN B12. The other constellation synapses say that two memories TALK
 * about the same thing (tags, meaning) or that dreaming linked them; this one says they HELP together
 * in real work: whoever touches the gateway configuration usually also needs the deploy procedure,
 * even if the two texts aren't alike.
 *
 * Funzioni pure, testate in test/unit/co-use.test.ts.
 *
 * EN: Pure functions, tested in test/unit/co-use.test.ts.
 */
import type { GraphLink } from '../graph/constellation'

/** Ricordi utili di una sessione considerati per le coppie: 6 → al massimo 15 coppie. / EN: Useful memories of a session considered for pairs: 6 → at most 15 pairs. */
export const CO_USE_PER_SESSION = 6
/** Emivita (giorni) di un legame non più rinforzato. / EN: Half-life (days) of a link no longer reinforced. */
export const CO_USE_HALF_LIFE_DAYS = 90
/** Sessioni insieme a cui il legame raggiunge la forza piena. / EN: Sessions together at which the link reaches full strength. */
export const CO_USE_FULL = 8
/** Forza minima per mostrare il legame e usarlo. / EN: Minimum strength to show the link and use it. */
export const CO_USE_MIN = 0.25
/** Legami d'uso tenuti per ricordo (i più forti). / EN: Use links kept per memory (the strongest). */
export const CO_USE_PER_MEMORY = 10
/** Forza minima perché un vicino d'uso venga "portato" nei risultati di una ricerca. / EN: Minimum strength for a use neighbor to be "brought" into search results. */
export const CO_USE_BRING_MIN = 0.5
/** Vicini d'uso portati al massimo in una ricerca. / EN: Maximum use neighbors brought into a search. */
export const CO_USE_BRING_MAX = 2

const DAY = 24 * 3600 * 1000

/**
 * Coppie di una sessione: tutte quelle fra i primi CO_USE_PER_SESSION ricordi, con a < b.
 *
 * EN: A session's pairs: all those among the first CO_USE_PER_SESSION memories, with a < b.
 * @param ids ricordi serviti, dal più importante
 *        EN: memories that helped, most important first
 */
export function sessionPairs (ids: string[]): [string, string][] {
  const top = [...new Set(ids)].slice(0, CO_USE_PER_SESSION)
  const out: [string, string][] = []
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) out.push(top[i] < top[j] ? [top[i], top[j]] : [top[j], top[i]])
  }
  return out
}

/**
 * Forza 0..1 di un legame: cresce in modo logaritmico con le sessioni insieme (1 → 0.32,
 * 3 → 0.63, 8 → 1) e si dimezza ogni CO_USE_HALF_LIFE_DAYS giorni senza rinforzi.
 *
 * EN: Strength 0..1 of a link: it grows logarithmically with the sessions together (1 → 0.32,
 * 3 → 0.63, 8 → 1) and halves every CO_USE_HALF_LIFE_DAYS days without reinforcement.
 */
export function coUseWeight (count: number, last: number, now = Date.now()): number {
  if (count <= 0) return 0
  const growth = Math.min(1, Math.log1p(count) / Math.log1p(CO_USE_FULL))
  const decay = Math.pow(0.5, Math.max(0, now - last) / DAY / CO_USE_HALF_LIFE_DAYS)
  return growth * decay
}

/**
 * Legami d'uso per la costellazione: sopra CO_USE_MIN, solo fra ricordi presenti, al massimo
 * CO_USE_PER_MEMORY per ricordo (un legame resta se è fra i più forti di almeno un estremo).
 * Lineare nel numero di coppie.
 *
 * EN: Use links for the constellation: above CO_USE_MIN, only between present memories, at most
 * CO_USE_PER_MEMORY per memory (a link stays if it's among the strongest of at least one end).
 * Linear in the number of pairs.
 */
export function coUseLinks (pairs: Map<string, { count: number, last: number }>, present: Set<string>, now = Date.now()): GraphLink[] {
  const byNode = new Map<string, GraphLink[]>()
  for (const [pair, c] of pairs) {
    const [source, target] = pair.split(':')
    if (!present.has(source) || !present.has(target)) continue
    const weight = coUseWeight(c.count, c.last, now)
    if (weight < CO_USE_MIN) continue
    const link: GraphLink = { source, target, weight, kind: 'use' }
    for (const k of [source, target]) {
      const list = byNode.get(k)
      if (list) list.push(link)
      else byNode.set(k, [link])
    }
  }
  const kept = new Set<GraphLink>()
  for (const list of byNode.values()) list.sort((a, b) => b.weight - a.weight).slice(0, CO_USE_PER_MEMORY).forEach((l) => kept.add(l))
  return [...kept]
}

/**
 * Vicini d'uso di ogni ricordo, dal più forte: servono alla ricerca per "portare" i ricordi che di
 * solito servono insieme a quelli trovati.
 *
 * EN: Use neighbors of each memory, strongest first: search uses them to "bring along" the memories
 * usually needed together with the ones found.
 */
export function coUseNeighbors (links: GraphLink[]): Map<string, { id: string, weight: number }[]> {
  const out = new Map<string, { id: string, weight: number }[]>()
  const add = (a: string, b: string, weight: number) => {
    const list = out.get(a)
    if (list) list.push({ id: b, weight })
    else out.set(a, [{ id: b, weight }])
  }
  for (const l of links) { add(l.source, l.target, l.weight); add(l.target, l.source, l.weight) }
  for (const list of out.values()) list.sort((a, b) => b.weight - a.weight)
  return out
}
