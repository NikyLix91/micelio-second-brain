/**
 * @file Attivazione dei ricordi (DESIGN §8.2): quanto un ricordo è "vivo" per il team.
 *
 * EN: Memory activation (DESIGN §8.2): how "alive" a memory is for the team.
 *
 * Ispirata al livello base del modello ACT-R della memoria umana: ciò che è usato spesso e di
 * recente è più accessibile. Componenti:
 * - recency:    decadimento esponenziale dall'ultimo uso (o dalla creazione), con emivita
 *               diversa per tipo di ricordo (una decisione resta valida più a lungo di uno snippet);
 * - uses:       quante volte il team l'ha usato (logaritmico: 100 usi non valgono 100 volte 1);
 *               un uso UTILE (B11: confermato a fine sessione) vale USEFUL_WEIGHT usi semplici,
 *               perché "restituito" non vuol dire "servito";
 * - votes:      somma dei voti di utilità;
 * - centrality: quanti collegamenti ha nella costellazione;
 * - pinned:     un ricordo fissato ha sempre attivazione massima;
 * - root:       una Radice (sapere fondante) non scende mai sotto ROOT_FLOOR, anche se nessuno
 *               la consulta da mesi; con l'uso sale come gli altri.
 *
 * EN: Inspired by the base level of the ACT-R model of human memory: what is used often and
 * recently is more accessible. Components:
 * - recency:    exponential decay since the last use (or since creation), with a half-life
 *               that depends on the memory kind (a decision stays valid longer than a snippet);
 * - uses:       how many times the team used it (logarithmic: 100 uses are not worth 100 times 1);
 *               a USEFUL use (B11: confirmed at the end of the session) is worth USEFUL_WEIGHT plain
 *               uses, because "returned" does not mean "helped";
 * - votes:      sum of the usefulness votes;
 * - centrality: how many links it has in the constellation;
 * - pinned:     a pinned memory always has maximum activation;
 * - root:       a Root (founding knowledge) never drops below ROOT_FLOOR, even if nobody has
 *               looked at it for months; with use it rises like the others.
 *
 * Calcolata AL MOMENTO della query con l'orologio locale: la vista replicata contiene solo gli
 * ingredienti (usi, voti, pin), quindi resta deterministica su tutti i nodi.
 * Funzione pura: testata in test/unit/rank.test.ts. Il risultato è normalizzato fra 0 e 1.
 *
 * EN: Computed AT QUERY TIME with the local clock: the replicated view only holds the
 * ingredients (uses, votes, pins), so it stays deterministic on every node.
 * Pure function: tested in test/unit/rank.test.ts. The result is normalized between 0 and 1.
 */

/** Emivita (giorni) per tipo di ricordo: dopo questo tempo senza usi, la recency si dimezza. / EN: Half-life (days) per memory kind: after this time without uses, the recency halves. */
export const HALF_LIFE_DAYS: Record<string, number> = {
  decision: 365, reference: 365, howto: 180, fact: 180, gotcha: 120, snippet: 90
}

/** Pesi delle componenti (somma 1). Da tarare con l'uso reale. / EN: Component weights (sum 1). To be tuned with real usage. */
export const WEIGHTS = { recency: 0.4, uses: 0.3, votes: 0.2, centrality: 0.1 }

export interface ActivationInput {
  kind: string
  /** Creazione del ricordo (epoch ms). / EN: Memory creation (epoch ms). */
  createdAt: number
  /** Ultimo uso da parte di qualunque nodo (epoch ms), se mai usato. / EN: Last use by any node (epoch ms), if ever used. */
  lastUsed?: number
  /** Usi totali nel team. / EN: Total uses in the team. */
  uses: number
  /** Volte in cui è stato utile a un agente, nel team (B11). / EN: Times it was useful to an agent, in the team (B11). */
  useful?: number
  /** Somma dei voti (+1/-1 per nodo). / EN: Sum of the votes (+1/-1 per node). */
  votes: number
  /** Numero di collegamenti nella costellazione. / EN: Number of links in the constellation. */
  degree: number
  pinned: boolean
  /** È una Radice (Fase 8): attivazione mai sotto ROOT_FLOOR. / EN: It is a Root (Phase 8): activation never below ROOT_FLOOR. */
  root?: boolean
}

/**
 * Attivazione minima di una Radice. Abbastanza alta da non essere mai candidata al decadimento
 * (soglia del dreaming: 0.15) e da restare in buona posizione nelle ricerche, ma sotto 1: una
 * Radice non deve schiacciare i ricordi più pertinenti alla domanda.
 *
 * EN: Minimum activation of a Root. High enough never to be a candidate for decay (dreaming threshold: 0.15)
 * and to stay well placed in searches, but below 1: a Root must not crush the memories most relevant to
 * the question.
 */
export const ROOT_FLOOR = 0.75

const DAY = 24 * 3600 * 1000
/** Quanti usi semplici vale un uso utile (B11). / EN: How many plain uses a useful use is worth (B11). */
export const USEFUL_WEIGHT = 3

/** Attivazione fra 0 e 1 (1 = massima). / EN: Activation between 0 and 1 (1 = maximum). */
export function activation (m: ActivationInput, now = Date.now()): number {
  if (m.pinned) return 1
  const since = Math.max(0, now - Math.max(m.createdAt, m.lastUsed ?? 0)) / DAY
  const recency = Math.pow(0.5, since / (HALF_LIFE_DAYS[m.kind] ?? 180))
  const uses = Math.min(1, Math.log1p(m.uses + USEFUL_WEIGHT * (m.useful ?? 0)) / Math.log1p(50)) // 50 usi ≈ saturazione / EN: 50 uses ≈ saturation
  const votes = 0.5 + Math.max(-0.5, Math.min(0.5, m.votes / 10)) // 0 voti = 0.5 (neutro) / EN: 0 votes = 0.5 (neutral)
  const centrality = Math.min(1, m.degree / 8)
  const a = WEIGHTS.recency * recency + WEIGHTS.uses * uses + WEIGHTS.votes * votes + WEIGHTS.centrality * centrality
  return Math.max(m.root ? ROOT_FLOOR : 0, Math.min(1, a))
}
