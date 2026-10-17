/** @file Piccole funzioni di formattazione condivise dalle schermate. */

/** Prime 12 cifre di una chiave: abbastanza per riconoscerla, abbastanza corte da leggere. */
export const short = (k: string | null | undefined): string => (k ? k.slice(0, 12) : '–')

/** Data e ora locali leggibili, es. "17/10/2026, 12:53". */
export const dateTime = (ts: number): string =>
  new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Data relativa breve: "adesso", "5 min fa", "3 h fa", "2 g fa". */
export function ago (ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000)
  if (s < 60) return 'adesso'
  if (s < 3600) return `${Math.floor(s / 60)} min fa`
  if (s < 86_400) return `${Math.floor(s / 3600)} h fa`
  return `${Math.floor(s / 86_400)} g fa`
}

/** Etichette italiane dei tipi di ricordo. */
export const KIND_LABEL: Record<string, string> = {
  fact: 'fatto', howto: 'procedura', decision: 'decisione', gotcha: 'gotcha', snippet: 'snippet', reference: 'riferimento'
}

/** Etichette degli esiti nel registro privato. */
export const OUTCOME_LABEL: Record<string, string> = {
  blocked: 'Bloccato dal filtro', private: 'Privato', discarded: 'Scartato', rejected: 'Rifiutato da te', expired: 'Scaduto'
}
