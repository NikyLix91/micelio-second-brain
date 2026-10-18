/**
 * @file Qualità della distillazione (Fase 10): dati per decidere QUANTI ricordi distillare.
 *
 * Il limite di ricordi per distillazione (`distill.maxMemories`, default 5) è una scelta di team:
 * con la CLI dell'abbonamento il costo non è il problema, il RUMORE sì. Per alzarlo (o abbassarlo)
 * con criterio servono misure, non impressioni. Ogni ricordo distillato porta in `source`:
 * - `rank`:  la sua posizione nel distillato (1 = il primo, di solito il più importante);
 * - `batch`: quanti ricordi aveva proposto il modello in quella distillazione.
 * Sono metadati replicati: le metriche sono le stesse su ogni PC del team.
 *
 * Per ogni FASCIA di posizione (1ª, 2ª, 3ª, 4ª–5ª, 6ª–10ª, oltre) si misura, sui ricordi
 * abbastanza vecchi da aver avuto il tempo di essere usati (MIN_AGE_DAYS):
 * - utili:        votati positivamente o usati almeno una volta dagli agenti;
 * - votati inutili: somma dei voti negativa;
 * - rimossi:      fusi o archiviati dal dreaming (doppioni o sapere che non serviva);
 * - mai usati:    attivi, nessun uso e nessun voto;
 * - punteggio = utili − votati inutili − rimossi (da −1 a +1).
 * Più la SATURAZIONE: quante distillazioni hanno proposto almeno tanti ricordi quanto il limite.
 *
 * L'indicazione finale confronta le ultime posizioni consentite con le prime: se valgono quasi
 * quanto le prime e il limite viene toccato spesso, il limite sta tagliando sapere utile.
 * Funzione pura: testata in test/unit/quality.test.ts.
 */

/** Limite di default e limiti ammessi per `distill.maxMemories`. */
export const DEFAULT_MAX_MEMORIES = 5
export const MAX_MEMORIES_RANGE = { min: 1, max: 20 } as const

/** Età minima perché un ricordo conti nelle percentuali (prima non ha avuto modo di essere usato). */
export const MIN_AGE_DAYS = 3
/** Ricordi maturi minimi per dare un'indicazione. */
export const MIN_SAMPLE = 30
/** Ricordi minimi nelle ultime posizioni per confrontarle con le prime. */
export const MIN_TAIL_SAMPLE = 10
/** Soglie dell'indicazione (differenze di punteggio fra ultime e prime posizioni). */
export const RAISE_MAX_GAP = 0.15
export const LOWER_MIN_GAP = 0.35
export const RAISE_MIN_SATURATION = 0.3

/** I dati di un ricordo che servono alle metriche. */
export interface QualityInput {
  ts: number
  status: 'active' | 'superseded' | 'archived' | 'redacted'
  source?: { type: string, rank?: number, batch?: number }
  votes: number
  uses: number
}

export interface QualityBucket {
  label: string
  from: number
  to: number
  /** Ricordi maturi in questa fascia (quelli contati nelle percentuali). */
  n: number
  /** Ricordi troppo recenti per essere giudicati. */
  young: number
  useful: number
  notUseful: number
  removed: number
  unused: number
  score: number
}

export interface DistillQuality {
  maxMemories: number
  /** Ricordi distillati con posizione nota (maturi + recenti). */
  total: number
  buckets: QualityBucket[]
  /** Distillazioni note e quante hanno proposto almeno `maxMemories` ricordi. */
  saturation: { batches: number, atLimit: number, rate: number }
  advice: {
    action: 'raise' | 'keep' | 'lower' | 'unknown'
    /** Caso preciso, per comporre il testo nella lingua dell'utente (UI). */
    code: 'too-few' | 'tail-small' | 'lower' | 'raise' | 'keep-unsaturated' | 'keep-balanced'
    /** Valori citati nel testo. */
    params: { mature: number, minSample: number, minAgeDays: number, minTail: number, saturationRate: number, tailN?: number, headScore?: number, tailScore?: number, badShare?: number }
    /** Testo in italiano (CLI). */
    reason: string
  }
}

const FASCE = [
  { label: '1ª', from: 1, to: 1 },
  { label: '2ª', from: 2, to: 2 },
  { label: '3ª', from: 3, to: 3 },
  { label: '4ª–5ª', from: 4, to: 5 },
  { label: '6ª–10ª', from: 6, to: 10 },
  { label: 'oltre la 10ª', from: 11, to: 100 }
]

/** Percentuali e punteggio di un insieme di ricordi maturi. */
function measure (ms: QualityInput[]): Omit<QualityBucket, 'label' | 'from' | 'to' | 'young'> {
  const n = ms.length
  if (!n) return { n: 0, useful: 0, notUseful: 0, removed: 0, unused: 0, score: 0 }
  const frac = (pred: (m: QualityInput) => boolean) => ms.filter(pred).length / n
  const removed = frac((m) => m.status === 'superseded' || m.status === 'archived')
  const active = (m: QualityInput) => m.status === 'active'
  const useful = frac((m) => active(m) && (m.votes > 0 || (m.uses > 0 && m.votes >= 0)))
  const notUseful = frac((m) => active(m) && m.votes < 0)
  const unused = frac((m) => active(m) && m.uses === 0 && m.votes === 0)
  return { n, useful, notUseful, removed, unused, score: useful - notUseful - removed }
}

/**
 * Calcola le metriche (vedi intestazione).
 * @param memories ricordi del team, ATTIVI E NO (fusi e archiviati contano come "rimossi")
 * @param maxMemories limite in vigore
 */
export function distillQuality (memories: QualityInput[], maxMemories: number, now = Date.now()): DistillQuality {
  const minTs = now - MIN_AGE_DAYS * 24 * 3600 * 1000
  const ranked = memories.filter((m) => m.status !== 'redacted' && typeof m.source?.rank === 'number')
  const mature = ranked.filter((m) => m.ts <= minTs)
  const inRange = (m: QualityInput, from: number, to: number) => m.source!.rank! >= from && m.source!.rank! <= to

  const buckets = FASCE
    .map((f) => ({
      ...f,
      ...measure(mature.filter((m) => inRange(m, f.from, f.to))),
      young: ranked.filter((m) => m.ts > minTs && inRange(m, f.from, f.to)).length
    }))
    // Si mostrano le fasce entro il limite in vigore, e quelle oltre solo se hanno dati (limite cambiato)
    .filter((b) => b.from <= maxMemories || b.n + b.young > 0)

  // Saturazione: una distillazione = il suo ricordo in posizione 1
  const firsts = ranked.filter((m) => m.source!.rank === 1 && typeof m.source!.batch === 'number')
  const atLimit = firsts.filter((m) => m.source!.batch! >= maxMemories).length
  const saturation = { batches: firsts.length, atLimit, rate: firsts.length ? atLimit / firsts.length : 0 }

  return { maxMemories, total: ranked.length, buckets, saturation, advice: advise(mature, maxMemories, saturation.rate) }
}

/** Indicazione per l'admin: alzare, tenere, abbassare il limite, o "servono più dati". */
function advise (mature: QualityInput[], max: number, saturationRate: number): DistillQuality['advice'] {
  // Valori su cui si basa l'indicazione: restituiti insieme al testo, così la UI può comporre
  // la frase nella lingua scelta dall'utente (il testo `reason` è in italiano, per la CLI).
  const base = { mature: mature.length, minSample: MIN_SAMPLE, minAgeDays: MIN_AGE_DAYS, minTail: MIN_TAIL_SAMPLE, saturationRate }
  if (mature.length < MIN_SAMPLE) {
    return { action: 'unknown', code: 'too-few', params: base, reason: `Servono almeno ${MIN_SAMPLE} ricordi distillati da più di ${MIN_AGE_DAYS} giorni (ora ${mature.length}).` }
  }
  // Prime posizioni (1–3) contro le ultime consentite (le ultime due sotto il limite)
  const head = measure(mature.filter((m) => m.source!.rank! <= Math.min(3, max)))
  const tailFrom = Math.max(1, max - 1)
  const tail = measure(mature.filter((m) => m.source!.rank! >= tailFrom && m.source!.rank! <= max))
  const params = { ...base, tailN: tail.n, headScore: head.score, tailScore: tail.score, badShare: tail.notUseful + tail.removed }
  const pct = (x: number) => `${Math.round(x * 100)}%`
  if (max <= 3 || tail.n < MIN_TAIL_SAMPLE) {
    return { action: 'unknown', code: 'tail-small', params, reason: `Pochi ricordi nelle ultime posizioni consentite (${tail.n}): servono almeno ${MIN_TAIL_SAMPLE} per confrontarle con le prime.` }
  }
  const gap = head.score - tail.score
  if (gap >= LOWER_MIN_GAP || tail.notUseful + tail.removed >= 0.5) {
    return { action: 'lower', code: 'lower', params, reason: `I ricordi nelle ultime posizioni valgono molto meno dei primi (punteggio ${tail.score.toFixed(2)} contro ${head.score.toFixed(2)}; ${pct(tail.notUseful + tail.removed)} votati inutili o rimossi): il limite si può abbassare.` }
  }
  if (gap <= RAISE_MAX_GAP && saturationRate >= RAISE_MIN_SATURATION) {
    return { action: 'raise', code: 'raise', params, reason: `Le ultime posizioni valgono quasi quanto le prime (punteggio ${tail.score.toFixed(2)} contro ${head.score.toFixed(2)}) e il limite viene raggiunto nel ${pct(saturationRate)} delle distillazioni: alzarlo dovrebbe portare altro sapere utile.` }
  }
  return saturationRate < RAISE_MIN_SATURATION
    ? { action: 'keep', code: 'keep-unsaturated', params, reason: `Il limite viene raggiunto solo nel ${pct(saturationRate)} delle distillazioni: non sta tagliando sapere.` }
    : { action: 'keep', code: 'keep-balanced', params, reason: `Le ultime posizioni valgono un po' meno delle prime (punteggio ${tail.score.toFixed(2)} contro ${head.score.toFixed(2)}): il limite attuale è equilibrato.` }
}

/** Legge e valida `distill.maxMemories` dalla configurazione di team (default se assente o non valido). */
export function maxMemoriesOf (value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MAX_MEMORIES_RANGE.min && value <= MAX_MEMORIES_RANGE.max ? value : DEFAULT_MAX_MEMORIES
}
