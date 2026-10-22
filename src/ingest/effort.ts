/**
 * @file Fatica di una parte di sessione (B12): quanto è stato sudato ciò che se ne ricava.
 *
 * EN: Effort of a session part (B12): how hard-won what comes out of it was.
 *
 * Un gotcha trovato dopo un'ora di errori vale più di un fatto ovvio, ma senza questo dato
 * nascerebbero con lo stesso peso. Idea presa da Spector (`SurpriseDetector`/`FlashbulbPolicy`: ciò
 * che sorprende si ricorda meglio), vedi PLAN B12. Il segnale viene dalla trascrizione, senza
 * chiamate LLM in più:
 * - errori degli strumenti (esiti segnati come errore): il segnale più forte, metà del punteggio;
 * - durata del capitolo, dal primo all'ultimo messaggio: un quarto;
 * - messaggi dell'utente, cioè scambi e tentativi: un quarto.
 *
 * EN: A gotcha found after an hour of errors is worth more than an obvious fact, but without this
 * data they'd be born with the same weight. Idea taken from Spector (`SurpriseDetector`/
 * `FlashbulbPolicy`: what surprises is remembered better), see PLAN B12. The signal comes from the
 * transcript, with no extra LLM calls:
 * - tool errors (outcomes marked as error): the strongest signal, half of the score;
 * - chapter duration, from the first to the last message: a quarter;
 * - user messages, i.e. exchanges and attempts: a quarter.
 *
 * Soglie tarate il 2026-10-22 su 196 capitoli reali (decisione dell'utente): con 15 errori, 120
 * minuti e 25 messaggi risulta "difficile" (punteggio ≥ 0.5) circa un capitolo su cinque. Con la
 * prima ipotesi (6, 60, 12) era quasi la metà: le sessioni sono spesso lunghe anche quando filano.
 *
 * EN: Thresholds tuned on 2026-10-22 on 196 real chapters (the user's decision): with 15 errors,
 * 120 minutes and 25 messages about one chapter in five turns out "hard" (score ≥ 0.5). With the
 * first guess (6, 60, 12) it was almost half: sessions are often long even when they go smoothly.
 *
 * Funzione pura, testata in test/unit/effort.test.ts.
 *
 * EN: Pure function, tested in test/unit/effort.test.ts.
 */

/** Errori a cui la componente "errori" è piena. / EN: Errors at which the "errors" component is full. */
export const EFFORT_ERRORS = 15
/** Minuti a cui la componente "durata" è piena. / EN: Minutes at which the "duration" component is full. */
export const EFFORT_MINUTES = 120
/** Messaggi dell'utente a cui la componente "messaggi" è piena. / EN: User messages at which the "messages" component is full. */
export const EFFORT_TURNS = 25
/** Da qui il ricordo si mostra come "nato da una sessione difficile". / EN: From here the memory is shown as "born from a hard session". */
export const HARD_EFFORT = 0.5

/** Fatica di un capitolo, come viaggia nel ricordo (`source.effort`). / EN: A chapter's effort, as it travels in the memory (`source.effort`). */
export interface Effort { score: number, errors: number, minutes: number }

/**
 * Punteggio 0..1 (due decimali) di un capitolo.
 *
 * EN: Score 0..1 (two decimals) of a chapter.
 * @param o.firstAt, o.lastAt istanti del primo e dell'ultimo messaggio (null se assenti: durata 0)
 *        EN: times of the first and last message (null if missing: duration 0)
 */
export function sessionEffort (o: { errors: number, userTurns: number, firstAt: number | null, lastAt: number | null }): Effort {
  const minutes = o.firstAt !== null && o.lastAt !== null ? Math.max(0, Math.round((o.lastAt - o.firstAt) / 60_000)) : 0
  const score = 0.5 * Math.min(1, o.errors / EFFORT_ERRORS) + 0.25 * Math.min(1, minutes / EFFORT_MINUTES) + 0.25 * Math.min(1, o.userTurns / EFFORT_TURNS)
  return { score: Math.round(score * 100) / 100, errors: o.errors, minutes }
}
