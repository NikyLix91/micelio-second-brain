/**
 * @file Colori della costellazione. Funzioni pure, testate a parte.
 *
 * Ogni autore ha un colore STABILE: lo ricaviamo da un hash della sua chiave, così lo stesso
 * collega ha lo stesso colore su ogni PC e a ogni avvio, senza doverlo salvare da nessuna parte.
 */

/** Hash numerico semplice e deterministico di una stringa (FNV-1a a 32 bit). */
export function hash (s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Colore di un autore: tonalità dall'hash, saturazione e luminosità fisse per restare
 * leggibili sullo sfondo scuro della costellazione.
 */
export function authorColor (key: string): string {
  return `hsl(${hash(key) % 360} 70% 62%)`
}

/** Colori fissi per tipo di ricordo. */
export const KIND_COLOR: Record<string, string> = {
  fact: '#7fb7ff',
  howto: '#8fe39b',
  decision: '#f5c86b',
  gotcha: '#ff8f7a',
  snippet: '#c9a2ff',
  reference: '#9fd8d6'
}

/** Colore "spento" per i nodi esclusi da un filtro o da una ricerca. */
export const DIM = 'rgba(160, 170, 160, 0.18)'
