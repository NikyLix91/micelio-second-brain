/**
 * @file Logica della navigazione guidata del Nucleo 3D. Funzioni pure, testate senza WebGL.
 *
 * EN: Logic of the guided tour of the 3D Nucleus. Pure functions, tested without WebGL.
 *
 * Una TAPPA del tour è un argomento del sapere del team: oggi un tag condiviso da più ricordi
 * (dalla Fase 5 diventeranno gruppi per affinità di significato). Per ogni tappa la camera vola
 * verso il "baricentro" dei ricordi coinvolti e una didascalia ne racconta il contenuto.
 *
 * EN: A tour STOP is a topic of the team's knowledge: today a tag shared by several memories (from Phase 5
 * they will become groups by similarity of meaning). For each stop the camera flies toward the
 * "centroid" of the memories involved and a caption describes their content.
 */
import type { GraphNode } from '../../api/client'

export interface TourStop {
  /** Argomento (tag). / EN: Topic (tag). */
  topic: string
  /** Id dei ricordi coinvolti. / EN: Ids of the memories involved. */
  ids: string[]
  /** Nomi degli autori, dal più presente. / EN: Author names, most frequent first. */
  authors: string[]
  /** Tipi di ricordo presenti, dal più frequente. / EN: Memory kinds present, most frequent first. */
  kinds: string[]
}

/** Numero massimo di tappe di un tour. / EN: Maximum number of stops in a tour. */
export const MAX_STOPS = 8

/** Elenco ordinato per frequenza decrescente (a parità, ordine alfabetico: risultato stabile). / EN: List sorted by decreasing frequency (ties in alphabetical order: stable result). */
function byFrequency (values: string[]): string[] {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v)
}

/**
 * Calcola le tappe: i tag usati da almeno 2 ricordi, dal più diffuso, al massimo MAX_STOPS.
 * Un tag presente in TUTTI i ricordi non è un argomento interessante (non distingue nulla): escluso.
 *
 * EN: Computes the stops: the tags used by at least 2 memories, most widespread first, at most MAX_STOPS. A
 * tag present in ALL memories is not an interesting topic (it tells nothing apart): excluded.
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

/** Baricentro di un insieme di punti; l'origine se l'insieme è vuoto. / EN: Centroid of a set of points; the origin if the set is empty. */
export function centroid (points: Vec3[]): Vec3 {
  if (points.length === 0) return { x: 0, y: 0, z: 0 }
  const s = points.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y, z: a.z + p.z }), { x: 0, y: 0, z: 0 })
  return { x: s.x / points.length, y: s.y / points.length, z: s.z / points.length }
}

/**
 * Dove mettere la camera per inquadrare un punto della sfera "da fuori": sulla stessa
 * direzione del punto rispetto al centro, a distanza `distance` dal centro. Se il punto è
 * proprio al centro, si guarda dall'asse z.
 *
 * EN: Where to put the camera to frame a point of the sphere "from outside": on the same direction as the
 * point from the center, at `distance` from the center. If the point is exactly at the center, we look
 * from the z axis.
 */
export function cameraFor (target: Vec3, distance: number): Vec3 {
  const len = Math.hypot(target.x, target.y, target.z)
  if (len < 1e-6) return { x: 0, y: 0, z: distance }
  const k = distance / len
  return { x: target.x * k, y: target.y * k, z: target.z * k }
}

/**
 * Testo della didascalia di una tappa, es. "12 ricordi · di Mario, Lucia e altri 2 · soprattutto gotcha"
 * (o in inglese: "12 memories · by Mario, Lucia and 2 more · mostly gotcha").
 *
 * EN: Caption text of a stop, e.g. "12 ricordi · di Mario, Lucia e altri 2 · soprattutto gotcha" (or in
 * English: "12 memories · by Mario, Lucia and 2 more · mostly gotcha").
 */
export function caption (stop: TourStop, kindLabel: (k: string) => string, lang: 'it' | 'en' = 'it'): string {
  const it = lang === 'it'
  const and = it ? 'e' : 'and'
  const who = stop.authors.length <= 2
    ? stop.authors.join(` ${and} `)
    : `${stop.authors.slice(0, 2).join(', ')} ${and} ${it ? 'altri' : ''} ${stop.authors.length - 2}${it ? '' : ' more'}`.replace(/\s+/g, ' ')
  return it
    ? `${stop.ids.length} ricordi · di ${who} · soprattutto ${kindLabel(stop.kinds[0])}`
    : `${stop.ids.length} memories · by ${who} · mostly ${kindLabel(stop.kinds[0])}`
}
