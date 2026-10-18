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

/** Dimensione leggibile: "512 B", "3,4 KB", "12,1 MB", "1,2 GB" (base 1024). */
export function bytes (n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toLocaleString('it-IT', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`
}

/** Percentuale leggibile da una quota 0..1: "42%", "0,4%", "<0,1%". */
export function percent (share: number): string {
  const p = share * 100
  if (p > 0 && p < 0.1) return '<0,1%'
  return `${p.toLocaleString('it-IT', { maximumFractionDigits: p < 10 ? 1 : 0 })}%`
}

/** Categorie delle Radici (Fase 8), nell'ordine in cui si mostrano, con le etichette italiane. */
export const ROOT_CATEGORY_ORDER = ['architecture', 'network', 'interface', 'domain', 'practice', 'policy', 'other'] as const
export const ROOT_CATEGORY_LABEL: Record<string, string> = {
  architecture: 'Architettura', network: 'Rete e infrastruttura', interface: 'Interfacce e contratti',
  domain: 'Dominio', practice: 'Best practice', policy: 'Policy', other: 'Altro'
}

/** Etichette italiane dei tipi di ricordo. */
export const KIND_LABEL: Record<string, string> = {
  fact: 'fatto', howto: 'procedura', decision: 'decisione', gotcha: 'gotcha', snippet: 'snippet', reference: 'riferimento'
}

/** Etichette degli esiti nel registro privato. */
export const OUTCOME_LABEL: Record<string, string> = {
  blocked: 'Bloccato dal filtro', private: 'Privato', discarded: 'Scartato', rejected: 'Rifiutato da te', expired: 'Scaduto'
}
