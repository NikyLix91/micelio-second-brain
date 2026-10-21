/**
 * @file Lacune di conoscenza (B4): ciò che il team cerca e non trova.
 *
 * EN: Knowledge gaps (B4): what the team searches for and does not find.
 *
 * Ogni ricerca ESPLICITA senza risultati (tool `recall` degli agenti, ricerca nella UI o in CLI) è
 * un indizio: qualcuno aveva bisogno di un sapere che il team non ha ancora scritto. Le richieste
 * del contesto automatico non contano: sono frasi libere, non domande alla memoria.
 *
 * EN: Every EXPLICIT search with no results (the agents' `recall` tool, search in the UI or CLI) is
 * a hint: someone needed knowledge the team has not written down yet. Automatic context requests
 * do not count: they are free text, not questions to the memory.
 *
 * Due livelli:
 * 1. **sul tuo PC** (private.db, mai replicato): le tue ricerche senza risposta, raggruppate se
 *    dicono la stessa cosa (stesse parole, in qualunque ordine). Il testo passa prima dalla
 *    redazione dei segreti;
 * 2. **nel team**: una lacuna che ritieni utile la SEGNALI (`gap.report`); compare a tutti, chi
 *    ha la stessa necessità si aggiunge, e chi scrive il ricordo che la colma la chiude
 *    (`gap.close`). Niente parte da solo: le tue ricerche restano tue finché non decidi tu.
 *
 * EN: Two levels:
 * 1. **on your PC** (private.db, never replicated): your searches with no answer, grouped when
 *    they say the same thing (same words, in any order). The text first goes through secret
 *    redaction;
 * 2. **in the team**: a gap you find useful, you REPORT it (`gap.report`); everyone sees it, whoever
 *    has the same need joins in, and whoever writes the memory that fills it closes it
 *    (`gap.close`). Nothing goes out on its own: your searches stay yours until you decide.
 */
import { createHash } from 'node:crypto'

/** Parole che non distinguono una ricerca dall'altra (italiano e inglese). / EN: Words that do not tell one search from another (Italian and English). */
const STOPWORDS = new Set(['come', 'cosa', 'dove', 'quando', 'perché', 'perche', 'per', 'con', 'del', 'della', 'dei', 'delle', 'nel', 'nella', 'che', 'una', 'uno', 'gli', 'le', 'il', 'lo', 'la', 'di', 'da', 'in', 'su', 'the', 'and', 'for', 'how', 'what', 'where', 'when', 'with', 'from', 'into'])

/**
 * Chiave di raggruppamento: parole significative (3+ caratteri), in minuscolo, senza accenti e
 * punteggiatura, ordinate e senza ripetizioni. "Timeout gateway?" e "gateway timeout" coincidono.
 *
 * EN: Grouping key: meaningful words (3+ characters), lowercase, without accents and
 * punctuation, sorted and deduplicated. "Timeout gateway?" and "gateway timeout" match.
 */
export function gapKey (query: string): string {
  const words = query.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  return [...new Set(words)].sort().join(' ')
}

/** Id di team di una lacuna: hash della chiave, uguale su ogni PC per la stessa domanda. / EN: Team id of a knowledge gap: hash of the key, identical on every PC for the same question. */
export function gapId (key: string): string {
  return createHash('sha256').update(`gap\n${key}`).digest('hex')
}
