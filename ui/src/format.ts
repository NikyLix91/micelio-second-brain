/**
 * @file Piccole funzioni di formattazione e tabelle di etichette condivise dalle schermate.
 * Seguono la lingua scelta (i18n): date e numeri nel formato della lingua, etichette tradotte.
 *
 * EN: Small formatting functions and label tables shared by the screens.
 * They follow the chosen language (i18n): dates and numbers in the language's format, translated labels.
 */
import { byLang, currentLang, currentLocale } from './i18n'

/** Prime 12 cifre di una chiave: abbastanza per riconoscerla, abbastanza corte da leggere. / EN: First 12 digits of a key: enough to recognize it, short enough to read. */
export const short = (k: string | null | undefined): string => (k ? k.slice(0, 12) : '–')

/** Data e ora leggibili, es. "17/10/2026, 12:53". / EN: Readable date and time, e.g. "17/10/2026, 12:53". */
export const dateTime = (ts: number): string =>
  new Date(ts).toLocaleString(currentLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Data relativa breve: "adesso", "5 min fa", "3 h fa", "2 g fa" (o in inglese). / EN: Short relative date: "just now", "5 min ago", "3 h ago", "2 d ago" (or in Italian). */
export function ago (ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000)
  const it = currentLang() === 'it'
  if (s < 60) return it ? 'adesso' : 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ${it ? 'fa' : 'ago'}`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ${it ? 'fa' : 'ago'}`
  return `${Math.floor(s / 86_400)} ${it ? 'g fa' : 'd ago'}`
}

/** Dimensione leggibile: "512 B", "3,4 KB", "12,1 MB", "1,2 GB" (base 1024). / EN: Readable size: "512 B", "3.4 KB", "12.1 MB", "1.2 GB" (base 1024). */
export function bytes (n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toLocaleString(currentLocale(), { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`
}

/** Percentuale leggibile da una quota 0..1: "42%", "0,4%", "<0,1%". / EN: Readable percentage from a 0..1 share: "42%", "0.4%", "<0.1%". */
export function percent (share: number): string {
  const p = share * 100
  if (p > 0 && p < 0.1) return `<${(0.1).toLocaleString(currentLocale())}%`
  return `${p.toLocaleString(currentLocale(), { maximumFractionDigits: p < 10 ? 1 : 0 })}%`
}

/** Categorie delle Radici (Fase 8), nell'ordine in cui si mostrano, con le etichette. / EN: Root categories (Phase 8), in display order, with their labels. */
export const ROOT_CATEGORY_ORDER = ['architecture', 'network', 'interface', 'domain', 'practice', 'policy', 'other'] as const
export const ROOT_CATEGORY_LABEL = byLang({
  it: { architecture: 'Architettura', network: 'Rete e infrastruttura', interface: 'Interfacce e contratti', domain: 'Dominio', practice: 'Best practice', policy: 'Policy', other: 'Altro' },
  en: { architecture: 'Architecture', network: 'Network and infrastructure', interface: 'Interfaces and contracts', domain: 'Domain', practice: 'Best practices', policy: 'Policies', other: 'Other' }
})

/** Tipi di ricordo. / EN: Memory kinds. */
export const KIND_LABEL = byLang({
  it: { fact: 'fatto', howto: 'procedura', decision: 'decisione', gotcha: 'gotcha', snippet: 'snippet', reference: 'riferimento' },
  en: { fact: 'fact', howto: 'how-to', decision: 'decision', gotcha: 'gotcha', snippet: 'snippet', reference: 'reference' }
})

/** Esiti nel registro privato. / EN: Outcomes in the private log. */
export const OUTCOME_LABEL = byLang({
  it: { blocked: 'Bloccato dal filtro', private: 'Privato', discarded: 'Scartato', rejected: 'Rifiutato da te', expired: 'Scaduto' },
  en: { blocked: 'Blocked by the filter', private: 'Private', discarded: 'Discarded', rejected: 'Rejected by you', expired: 'Expired' }
})
