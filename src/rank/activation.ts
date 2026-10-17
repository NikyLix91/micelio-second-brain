/**
 * @file Attivazione dei ricordi (DESIGN §8.2): quanto un ricordo è "vivo" per il team.
 *
 * Ispirata al livello base del modello ACT-R della memoria umana: ciò che è usato spesso e di
 * recente è più accessibile. Componenti:
 * - recency:    decadimento esponenziale dall'ultimo uso (o dalla creazione), con emivita
 *               diversa per tipo di ricordo (una decisione resta valida più a lungo di uno snippet);
 * - uses:       quante volte il team l'ha usato (logaritmico: 100 usi non valgono 100 volte 1);
 * - votes:      somma dei voti di utilità;
 * - centrality: quanti collegamenti ha nella costellazione;
 * - pinned:     un ricordo fissato ha sempre attivazione massima.
 *
 * Calcolata AL MOMENTO della query con l'orologio locale: la vista replicata contiene solo gli
 * ingredienti (usi, voti, pin), quindi resta deterministica su tutti i nodi.
 * Funzione pura: testata in test/unit/rank.test.ts. Il risultato è normalizzato fra 0 e 1.
 */

/** Emivita (giorni) per tipo di ricordo: dopo questo tempo senza usi, la recency si dimezza. */
export const HALF_LIFE_DAYS: Record<string, number> = {
  decision: 365, reference: 365, howto: 180, fact: 180, gotcha: 120, snippet: 90
}

/** Pesi delle componenti (somma 1). Da tarare con l'uso reale. */
export const WEIGHTS = { recency: 0.4, uses: 0.3, votes: 0.2, centrality: 0.1 }

export interface ActivationInput {
  kind: string
  /** Creazione del ricordo (epoch ms). */
  createdAt: number
  /** Ultimo uso da parte di qualunque nodo (epoch ms), se mai usato. */
  lastUsed?: number
  /** Usi totali nel team. */
  uses: number
  /** Somma dei voti (+1/-1 per nodo). */
  votes: number
  /** Numero di collegamenti nella costellazione. */
  degree: number
  pinned: boolean
}

const DAY = 24 * 3600 * 1000

/** Attivazione fra 0 e 1 (1 = massima). */
export function activation (m: ActivationInput, now = Date.now()): number {
  if (m.pinned) return 1
  const since = Math.max(0, now - Math.max(m.createdAt, m.lastUsed ?? 0)) / DAY
  const recency = Math.pow(0.5, since / (HALF_LIFE_DAYS[m.kind] ?? 180))
  const uses = Math.min(1, Math.log1p(m.uses) / Math.log1p(50)) // 50 usi ≈ saturazione
  const votes = 0.5 + Math.max(-0.5, Math.min(0.5, m.votes / 10)) // 0 voti = 0.5 (neutro)
  const centrality = Math.min(1, m.degree / 8)
  const a = WEIGHTS.recency * recency + WEIGHTS.uses * uses + WEIGHTS.votes * votes + WEIGHTS.centrality * centrality
  return Math.max(0, Math.min(1, a))
}
