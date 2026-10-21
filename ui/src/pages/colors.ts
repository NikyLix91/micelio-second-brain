/**
 * @file Colori delle viste a grafo (Nucleo 3D, Mappa 2D, pannelli). Funzioni pure, testate a parte.
 *
 * EN: Colors of the graph views (3D Nucleus, 2D Map, panels). Pure functions, tested separately.
 *
 * Autori: una PALETTE di colori ben distinti, assegnati in ordine stabile (chiavi ordinate) agli
 * autori presenti. Prima usavamo una tonalità ricavata dall'hash della chiave, ma due autori
 * potevano finire con colori quasi uguali (es. due verdi): con pochi colleghi è illeggibile.
 * Il registro va popolato con `registerAuthors` quando arrivano i dati del grafo; per un autore
 * non registrato si ripiega sull'hash.
 *
 * EN: Authors: a PALETTE of clearly distinct colors, assigned in a stable order (sorted keys) to
 * the authors present. We used to derive a hue from the key hash, but two authors could end up
 * with almost the same color (e.g. two greens): with few colleagues it is unreadable.
 * Fill the registry with `registerAuthors` when the graph data arrives; for an unregistered
 * author we fall back to the hash.
 */

/** Hash numerico semplice e deterministico di una stringa (FNV-1a a 32 bit). / EN: Simple, deterministic numeric hash of a string (32-bit FNV-1a). */
export function hash (s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Colori ben distinguibili fra loro e sullo sfondo nero (ordine scelto per massimo contrasto). / EN: Colors easy to tell apart from each other and on the black background (order chosen for maximum contrast). */
export const PALETTE = ['#4cc9f0', '#ff6b6b', '#b8f35d', '#c77dff', '#ffd166', '#06d6a0', '#ff9f1c', '#f15bb5', '#9bf6ff', '#e9ff70']

/** Registro autore → colore, condiviso da tutte le viste. / EN: Author → color registry, shared by all views. */
const registry = new Map<string, string>()

/**
 * Assegna i colori della palette agli autori indicati, in ordine di chiave (stabile: lo stesso
 * insieme di autori produce gli stessi colori su ogni PC). Oltre 10 autori la palette ricomincia.
 *
 * EN: Assigns the palette colors to the given authors, in key order (stable: the same set of
 * authors produces the same colors on every PC). Beyond 10 authors the palette starts over.
 */
export function registerAuthors (keys: Iterable<string>): void {
  const sorted = [...new Set(keys)].sort()
  registry.clear()
  sorted.forEach((k, i) => registry.set(k, PALETTE[i % PALETTE.length]))
}

/** Colore di un autore: dal registro, o (se sconosciuto) una tonalità ricavata dall'hash. / EN: Color of an author: from the registry or (if unknown) a hue derived from the hash. */
export function authorColor (key: string): string {
  return registry.get(key) ?? `hsl(${hash(key) % 360} 70% 62%)`
}

/** Colori fissi per tipo di ricordo. / EN: Fixed colors per memory kind. */
export const KIND_COLOR: Record<string, string> = {
  fact: '#7fb7ff',
  howto: '#8fe39b',
  decision: '#f5c86b',
  gotcha: '#ff8f7a',
  snippet: '#c9a2ff',
  reference: '#9fd8d6'
}

/** Colore "spento" per i nodi esclusi da un filtro o da una ricerca. / EN: "Dimmed" color for nodes excluded by a filter or a search. */
export const DIM = 'rgba(160, 170, 160, 0.18)'

/**
 * Marcatura delle RADICI (Fase 8) in tutte le viste grafiche. L'anello è bianco ghiaccio perché
 * deve distinguersi in ogni modalità di colore (la palette degli autori usa già ciano, rosso…);
 * diventa rosso se la Radice è "da rivedere". La stella della Radice è ciano solo nella modalità
 * olografica (dove tutto il resto è ambra); nelle altre mantiene il colore di autore o tipo.
 *
 * EN: Marking of ROOTS (Phase 8) in all graphic views. The ring is ice white because it must
 * stand out in every color mode (the author palette already uses cyan, red…); it turns red if
 * the Root is "to review". The Root star is cyan only in holographic mode (where everything else
 * is amber); in the other modes it keeps the author or kind color.
 */
export const ROOT_RING = '#f4fbff'
export const ROOT_REVIEW = '#ff4d4d'
export const ROOT_STAR = '#7ef9ff'
/** Colore dell'anello di una Radice secondo il suo stato. / EN: Ring color of a Root based on its status. */
export const rootRing = (status: 'ok' | 'review'): string => (status === 'review' ? ROOT_REVIEW : ROOT_RING)
