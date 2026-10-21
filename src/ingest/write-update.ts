/**
 * @file Aggiornare invece di aggiungere (B4): cosa fare di un ricordo nuovo quando il team ne ha
 * già uno simile.
 *
 * EN: Update instead of add (B4): what to do with a new memory when the team already has
 * a similar one.
 *
 * Prima di B4 i quasi duplicati si sistemavano solo nel dreaming, il giorno dopo; nel frattempo
 * gli agenti trovavano due versioni, magari in contraddizione. Ora, al momento della scrittura:
 *
 * 1. si cercano i ricordi del team più SIMILI per significato (vettori, sopra la soglia di
 *    pertinenza del modello). Nessuno simile → il ricordo si aggiunge e basta, senza LLM;
 * 2. se ce ne sono, l'LLM (modello di classificazione, veloce) decide:
 *    - `new`: dice una cosa diversa → si aggiunge;
 *    - `duplicate`: non aggiunge niente a un ricordo esistente → non si scrive nulla;
 *    - `update`: corregge, completa o rende obsoleto un ricordo esistente → si scrive UNA versione
 *      aggiornata che lo sostituisce (`memory.supersede`: il vecchio resta come storico e si può
 *      ripristinare dall'Archivio).
 *
 * Radici e ricordi fissati non si sostituiscono mai (apply lo rifiuterebbe): per loro le sole
 * scelte possibili sono `new` e `duplicate`. Senza LLM, o a budget finito, il ricordo si aggiunge
 * come prima: nessun sapere va perso, al massimo ci pensa il dreaming.
 *
 * EN: Before B4, near-duplicates were only cleaned up in dreaming, the next day; meanwhile
 * agents found two versions, possibly contradicting each other. Now, at write time:
 *
 * 1. we look for the team memories most SIMILAR in meaning (vectors, above the model's relevance
 *    threshold). None similar → the memory is simply added, without LLM;
 * 2. if there are some, the LLM (classification model, fast) decides:
 *    - `new`: it says something different → it is added;
 *    - `duplicate`: it adds nothing to an existing memory → nothing is written;
 *    - `update`: it corrects, completes or obsoletes an existing memory → ONE updated version is
 *      written that replaces it (`memory.supersede`: the old one stays as history and can be
 *      restored from the Archive).
 *
 * Roots and pinned memories are never replaced (apply would reject it): for them the only
 * possible choices are `new` and `duplicate`. Without LLM, or with the budget used up, the memory
 * is added as before: no knowledge is lost, at worst dreaming takes care of it.
 */
import { z } from 'zod'
import { MEMORY_KINDS, type MemoryData } from '../core/events'
import type { RecallHit } from '../core/model'

/** Ricordi simili mostrati all'LLM al massimo. / EN: Max number of similar memories shown to the LLM. */
export const WRITE_CANDIDATES = 3

/** Decisione dell'LLM. / EN: The LLM's decision. */
export const WriteDecision = z.object({
  action: z.enum(['new', 'duplicate', 'update']),
  /** Id del ricordo esistente (per duplicate e update). / EN: Id of the existing memory (for duplicate and update). */
  target: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** Per update: la versione aggiornata, che sostituisce il ricordo `target`. / EN: For update: the updated version, which replaces the `target` memory. */
  merged: z.object({
    kind: z.enum(MEMORY_KINDS),
    title: z.string().min(3).max(200),
    body: z.string().min(1).max(20_000),
    tags: z.array(z.string()).max(20)
  }).optional(),
  reason: z.string().max(500)
})
export type WriteDecision = z.infer<typeof WriteDecision>

/** Un ricordo esistente candidato, con la sua similarità e se si può sostituire. / EN: A candidate existing memory, with its similarity and whether it can be replaced. */
export interface WriteCandidate { hit: RecallHit, score: number, protected: boolean }

/** Prompt di sistema del compito "write-update". / EN: System prompt of the "write-update" task. */
export function writeUpdateSystem (language: string): string {
  return `Gestisci la memoria condivisa di un team di sviluppo. Arriva un ricordo NUOVO e ti mostro i ricordi
ESISTENTI più simili. Decidi:
- "new": il nuovo dice qualcosa di diverso o di complementare che sta bene da solo → si aggiunge;
- "duplicate": il nuovo non aggiunge nulla a un ricordo esistente (stessa informazione) → "target" = quell'id;
- "update": il nuovo corregge, aggiorna o completa UN ricordo esistente → "target" = quell'id e in "merged"
  scrivi UNA versione aggiornata che li sostituisce entrambi: tieni tutto ciò che è ancora vero del vecchio,
  applica le correzioni del nuovo, non inventare nulla che non sia in uno dei due.
I ricordi marcati [PROTETTO] (Radici o fissati) non si sostituiscono: per loro solo "new" o "duplicate".
Nel dubbio scegli "new". Scrivi "merged" e "reason" in lingua "${language}". Rispondi solo con il JSON richiesto.`
}

/** Input del compito: il ricordo nuovo e i candidati, con id completi. / EN: Task input: the new memory and the candidates, with full ids. */
export function writeUpdateInput (memory: MemoryData, candidates: WriteCandidate[]): string {
  const block = (m: { kind: string, title: string, body: string }) => `${m.kind} · ${m.title}\n${m.body}`
  return [
    'NUOVO:',
    block(memory),
    '',
    'ESISTENTI:',
    ...candidates.map((c) => `[${c.hit.id}]${c.protected ? ' [PROTETTO]' : ''} ${block(c.hit)}`)
  ].join('\n')
}

/**
 * Rende sicura la decisione dell'LLM: il target deve essere fra i candidati, un update deve avere
 * la versione aggiornata e non può toccare un ricordo protetto. Altrimenti → aggiunta normale.
 *
 * EN: Makes the LLM decision safe: the target must be among the candidates, an update must have
 * the updated version and cannot touch a protected memory. Otherwise → normal add.
 */
export function checkDecision (d: WriteDecision, candidates: WriteCandidate[]): WriteDecision {
  if (d.action === 'new') return d
  const target = candidates.find((c) => c.hit.id === d.target)
  if (!target) return { action: 'new', reason: 'decisione scartata: ricordo esistente non valido' }
  if (d.action === 'update' && (!d.merged || target.protected)) {
    return { action: 'new', reason: target.protected ? 'il ricordo esistente è protetto (Radice o fissato)' : 'versione aggiornata mancante' }
  }
  return d
}
