/**
 * @file Abituazione (B12): un ricordo proposto più volte agli agenti senza mai servire scende.
 *
 * EN: Habituation (B12): a memory offered to agents again and again without ever helping goes down.
 *
 * Come nel cervello, uno stimolo che si ripete senza conseguenze smette di attirare l'attenzione.
 * Nei primi giorni la pagina Efficacia ha mostrato che il contesto automatico propone spesso gli
 * stessi ricordi anche quando non c'entrano (solo il 10-28% di quelli forniti è servito): ogni
 * ricordo inutile nel contesto è rumore per l'agente e token sprecati. Idea presa da Spector
 * (`HabituationPenalty`), vedi PLAN B12.
 *
 * EN: As in the brain, a stimulus that repeats without consequences stops drawing attention. In the
 * first days the Effectiveness page showed that automatic context often offers the same memories even
 * when they're off topic (only 10-28% of those delivered helped): every useless memory in the context
 * is noise for the agent and wasted tokens. Idea taken from Spector (`HabituationPenalty`), see PLAN B12.
 *
 * Ingrediente: la SERIE di esiti senza uso dall'ultimo esito utile, letta dagli esiti di questo PC
 * (tabella `outcomes`, B11). Non dai contatori di team (`usage.report`, `useful.report`): sono
 * cumulativi, senza ordine nel tempo, e "restituito" lì conta anche le sessioni che nessuno ha mai
 * valutato. Così si penalizza solo ciò che è stato davvero misurato, e un esito utile azzera la serie.
 *
 * EN: Ingredient: the RUN of outcomes with no use since the last useful outcome, read from this PC's
 * outcomes (`outcomes` table, B11). Not from the team counters (`usage.report`, `useful.report`): they
 * are cumulative, with no order in time, and "returned" there also counts sessions nobody ever
 * evaluated. This way only what was really measured is penalized, and a useful outcome resets the run.
 *
 * Funzioni pure, testate in test/unit/habituation.test.ts.
 *
 * EN: Pure functions, tested in test/unit/habituation.test.ts.
 */

/** Esiti senza uso tollerati prima che il ricordo inizi a scendere. / EN: Outcomes with no use tolerated before the memory starts going down. */
export const HABITUATION_GRACE = 2
/** Quanto scende per ogni esito senza uso oltre la tolleranza. / EN: How much it goes down for each outcome with no use beyond the grace. */
export const HABITUATION_STEP = 0.15
/** Fattore minimo: un ricordo abituato scende ma non sparisce (la domanda giusta lo ritrova). / EN: Minimum factor: a habituated memory goes down but doesn't vanish (the right question still finds it). */
export const HABITUATION_MIN = 0.3

/** Esiti che contano come "è servito": azzerano la serie. / EN: Outcomes that count as "it helped": they reset the run. */
const USEFUL = new Set(['used', 'likely'])

/**
 * Serie di esiti senza uso dall'ultimo esito utile, per ricordo. Gli esiti vanno passati in ordine
 * di tempo crescente. "Sbagliato" conta come senza uso: non è servito.
 *
 * EN: Run of outcomes with no use since the last useful outcome, per memory. Outcomes must be given
 * in increasing time order. "Wrong" counts as no use: it didn't help.
 */
export function habituationStreaks (outcomes: Iterable<{ memory: string, verdict: string }>): Map<string, number> {
  const streak = new Map<string, number>()
  for (const o of outcomes) streak.set(o.memory, USEFUL.has(o.verdict) ? 0 : (streak.get(o.memory) ?? 0) + 1)
  // Solo i ricordi con una serie aperta: gli altri hanno fattore 1 e non servono in memoria
  // EN: Only memories with an open run: the others have factor 1 and needn't be kept in memory
  for (const [id, n] of streak) if (n === 0) streak.delete(id)
  return streak
}

/**
 * Fattore 0..1 per cui moltiplicare il punteggio di un ricordo. 1 fino a HABITUATION_GRACE esiti
 * senza uso, poi scende di HABITUATION_STEP a esito fino a HABITUATION_MIN.
 * Esempi: 2 → 1, 3 → 0.85, 5 → 0.55, 7 o più → 0.3.
 *
 * EN: Factor 0..1 to multiply a memory's score by. 1 up to HABITUATION_GRACE outcomes with no use,
 * then it goes down by HABITUATION_STEP per outcome down to HABITUATION_MIN.
 * Examples: 2 → 1, 3 → 0.85, 5 → 0.55, 7 or more → 0.3.
 */
export function habituationFactor (streak: number): number {
  return Math.max(HABITUATION_MIN, 1 - HABITUATION_STEP * Math.max(0, streak - HABITUATION_GRACE))
}

/**
 * Versione attenuata per le ricerche ESPLICITE (`recall`, ricerca della UI, chat): lì la domanda è
 * precisa e chi cerca vuole vedere anche i ricordi meno fortunati; il contesto automatico invece
 * arriva senza che l'agente abbia chiesto niente, e usa il fattore pieno. Metà dell'effetto:
 * 0.3 → 0.65.
 *
 * EN: Softened version for EXPLICIT searches (`recall`, UI search, chat): there the question is precise
 * and whoever searches also wants to see the less lucky memories; automatic context instead arrives
 * without the agent asking for anything, and uses the full factor. Half the effect: 0.3 → 0.65.
 */
export function softHabituation (factor: number): number {
  return 1 - (1 - factor) / 2
}
