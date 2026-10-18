/**
 * @file Lacune di conoscenza (B4): ciò che il team cerca e non trova.
 *
 * Ogni ricerca ESPLICITA senza risultati (tool `recall` degli agenti, ricerca nella UI o in CLI) è
 * un indizio: qualcuno aveva bisogno di un sapere che il team non ha ancora scritto. Le richieste
 * del contesto automatico non contano: sono frasi libere, non domande alla memoria.
 *
 * Due livelli:
 * 1. **sul tuo PC** (private.db, mai replicato): le tue ricerche senza risposta, raggruppate se
 *    dicono la stessa cosa (stesse parole, in qualunque ordine). Il testo passa prima dalla
 *    redazione dei segreti;
 * 2. **nel team**: una lacuna che ritieni utile la SEGNALI (`gap.report`); compare a tutti, chi
 *    ha la stessa necessità si aggiunge, e chi scrive il ricordo che la colma la chiude
 *    (`gap.close`). Niente parte da solo: le tue ricerche restano tue finché non decidi tu.
 */
import { createHash } from 'node:crypto'

/** Parole che non distinguono una ricerca dall'altra (italiano e inglese). */
const STOPWORDS = new Set(['come', 'cosa', 'dove', 'quando', 'perché', 'perche', 'per', 'con', 'del', 'della', 'dei', 'delle', 'nel', 'nella', 'che', 'una', 'uno', 'gli', 'le', 'il', 'lo', 'la', 'di', 'da', 'in', 'su', 'the', 'and', 'for', 'how', 'what', 'where', 'when', 'with', 'from', 'into'])

/**
 * Chiave di raggruppamento: parole significative (3+ caratteri), in minuscolo, senza accenti e
 * punteggiatura, ordinate e senza ripetizioni. "Timeout gateway?" e "gateway timeout" coincidono.
 */
export function gapKey (query: string): string {
  const words = query.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  return [...new Set(words)].sort().join(' ')
}

/** Id di team di una lacuna: hash della chiave, uguale su ogni PC per la stessa domanda. */
export function gapId (key: string): string {
  return createHash('sha256').update(`gap\n${key}`).digest('hex')
}
