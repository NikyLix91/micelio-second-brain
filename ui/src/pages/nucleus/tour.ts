/**
 * @file Logica della navigazione guidata del Nucleo 3D. Funzioni pure, testate senza WebGL.
 *
 * Una TAPPA del tour è un argomento del sapere del team: oggi un tag condiviso da più ricordi
 * (dalla Fase 5 diventeranno gruppi per affinità di significato). Per ogni tappa la camera vola
 * verso il "baricentro" dei ricordi coinvolti e una didascalia ne racconta il contenuto.
 */
import type { GraphNode } from '../../api/client'

export interface TourStop {
  /** Argomento (tag). */
  topic: string
  /** Id dei ricordi coinvolti. */
  ids: string[]
  /** Nomi degli autori, dal più presente. */
  authors: string[]
  /** Tipi di ricordo presenti, dal più frequente. */
  kinds: string[]
}

/** Numero massimo di tappe di un tour. */
export const MAX_STOPS = 8

/** Elenco ordinato per frequenza decrescente (a parità, ordine alfabetico: risultato stabile). */
function byFrequency (values: string[]): string[] {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v)
}

/**
 * Calcola le tappe: i tag usati da almeno 2 ricordi, dal più diffuso, al massimo MAX_STOPS.
 * Un tag presente in TUTTI i ricordi non è un argomento interessante (non distingue nulla): escluso.
 */
export function computeTourStops (nodes: GraphNode[], max = MAX_STOPS): TourStop[] {
  const byTag = new Map<string, GraphNode[]>()
  for (const n of nodes) for (const t of new Set(n.tags)) byTag.set(t, [...(byTag.get(t) ?? []), n])
  return [...byTag]
    .filter(([, list]) => list.length >= 2 && list.length < nodes.length)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([topic, list]) => ({
      topic,
      ids: list.map((n) => n.id),
      authors: byFrequency(list.map((n) => n.authorName ?? n.author.slice(0, 8))),
      kinds: byFrequency(list.map((n) => n.kind))
    }))
}

export interface Vec3 { x: number, y: number, z: number }

/** Baricentro di un insieme di punti; l'origine se l'insieme è vuoto. */
export function centroid (points: Vec3[]): Vec3 {
  if (points.length === 0) return { x: 0, y: 0, z: 0 }
  const s = points.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y, z: a.z + p.z }), { x: 0, y: 0, z: 0 })
  return { x: s.x / points.length, y: s.y / points.length, z: s.z / points.length }
}

/**
 * Dove mettere la camera per inquadrare un punto della sfera "da fuori": sulla stessa
 * direzione del punto rispetto al centro, a distanza `distance` dal centro. Se il punto è
 * proprio al centro, si guarda dall'asse z.
 */
export function cameraFor (target: Vec3, distance: number): Vec3 {
  const len = Math.hypot(target.x, target.y, target.z)
  if (len < 1e-6) return { x: 0, y: 0, z: distance }
  const k = distance / len
  return { x: target.x * k, y: target.y * k, z: target.z * k }
}

/** Testo della didascalia di una tappa, es. "12 ricordi · di Mario, Lucia e altri 2 · soprattutto gotcha". */
export function caption (stop: TourStop, kindLabel: (k: string) => string): string {
  const who = stop.authors.length <= 2
    ? stop.authors.join(' e ')
    : `${stop.authors.slice(0, 2).join(', ')} e altri ${stop.authors.length - 2}`
  return `${stop.ids.length} ricordi · di ${who} · soprattutto ${kindLabel(stop.kinds[0])}`
}
