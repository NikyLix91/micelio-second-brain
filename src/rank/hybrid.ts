/**
 * @file Ricerca ibrida (DESIGN §8.1): parole chiave + significato + attivazione.
 *
 * 1. FTS5/BM25 trova i ricordi che contengono le parole cercate;
 * 2. gli embedding trovano quelli SIMILI per significato, anche con parole diverse o in un'altra
 *    lingua ("memoria esaurita" ↔ "out of memory");
 * 3. le due classifiche si fondono con la Reciprocal Rank Fusion (RRF): conta la POSIZIONE in
 *    ciascuna classifica, non il punteggio grezzo (BM25 e coseno hanno scale incomparabili);
 * 4. si moltiplica per (1 + α·attivazione): a parità di pertinenza vincono i ricordi più vivi.
 *
 * Funzioni pure, testate in test/unit/rank.test.ts.
 */

/** Costante della RRF: smorza l'influenza delle prime posizioni (60 è il valore classico). */
export const RRF_K = 60
/** Peso dell'attivazione nel punteggio finale. */
export const ACTIVATION_ALPHA = 0.5

/**
 * Fonde più classifiche (liste di id, dal migliore) con la Reciprocal Rank Fusion.
 * @returns punteggio RRF per id (più alto = meglio)
 */
export function rrf (rankings: string[][], k = RRF_K): Map<string, number> {
  const scores = new Map<string, number>()
  for (const list of rankings) {
    list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)))
  }
  return scores
}

/** Similarità coseno fra due vettori della stessa lunghezza (già normalizzati: basta il prodotto). */
export function cosine (a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/**
 * I `k` vettori più simili alla query (ricerca esaustiva). Con qualche migliaio di ricordi da
 * 384 dimensioni sono pochi milioni di moltiplicazioni: millisecondi, nessun indice speciale.
 */
export function nearest (query: Float32Array, vectors: Map<string, Float32Array>, k: number, minScore = -1): { id: string, score: number }[] {
  const out: { id: string, score: number }[] = []
  for (const [id, v] of vectors) {
    const s = cosine(query, v)
    if (s >= minScore) out.push({ id, score: s })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, k)
}

/**
 * Classifica finale: RRF delle due liste, poi peso dell'attivazione.
 * @param keyword ids dalla ricerca per parole chiave (dal migliore)
 * @param semantic ids dalla ricerca semantica (dal migliore)
 * @param activationOf attivazione 0..1 di un id
 */
export function hybridRank (keyword: string[], semantic: string[], activationOf: (id: string) => number, alpha = ACTIVATION_ALPHA): { id: string, score: number }[] {
  return [...rrf([keyword, semantic])]
    .map(([id, s]) => ({ id, score: s * (1 + alpha * activationOf(id)) }))
    .sort((a, b) => b.score - a.score)
}
