/**
 * Logica pura della UI: tappe del tour del Nucleo, geometria della camera, colori stabili,
 * parser dello stream SSE. Niente DOM né WebGL: girano velocissimi.
 */
import { describe, expect, it } from 'vitest'
import type { GraphNode } from '../api/client'
import { parseSse } from '../api/live'
import { authorColor, hash } from '../pages/colors'
import { cameraFor, caption, centroid, computeTourStops } from '../pages/nucleus/tour'

const node = (id: string, tags: string[], author = 'a'.repeat(64), kind = 'fact'): GraphNode =>
  ({ id, title: id, kind, tags, author, authorName: author.startsWith('a') ? 'alice' : 'bruno', ts: 0 })

describe('tour del Nucleo', () => {
  const nodes = [
    node('1', ['angular', 'ci']), node('2', ['angular']), node('3', ['angular', 'docker'], 'b'.repeat(64), 'gotcha'),
    node('4', ['docker', 'ci']), node('5', ['solo']), node('6', ['ci'])
  ]

  it('le tappe sono i tag condivisi, dal più diffuso, esclusi quelli singoli', () => {
    const stops = computeTourStops(nodes)
    expect(stops.map((s) => s.topic)).toEqual(['angular', 'ci', 'docker'])
    expect(stops[0].ids).toEqual(['1', '2', '3'])
    expect(stops[0].authors).toEqual(['alice', 'bruno'])
  })

  it('un tag presente in tutti i ricordi non è una tappa', () => {
    expect(computeTourStops([node('1', ['x']), node('2', ['x'])])).toEqual([])
  })

  it('la didascalia riassume quantità, autori e tipo prevalente', () => {
    const [angular] = computeTourStops(nodes)
    expect(caption(angular, (k) => k)).toBe('3 ricordi · di alice e bruno · soprattutto fact')
  })

  it('baricentro e posizione della camera "da fuori"', () => {
    expect(centroid([{ x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: 6 }])).toEqual({ x: 1, y: 2, z: 3 })
    expect(cameraFor({ x: 3, y: 0, z: 4 }, 10)).toEqual({ x: 6, y: 0, z: 8 })
    expect(cameraFor({ x: 0, y: 0, z: 0 }, 10)).toEqual({ x: 0, y: 0, z: 10 })
  })
})

describe('colori', () => {
  it('ogni autore ha sempre lo stesso colore', () => {
    expect(authorColor('abc')).toBe(authorColor('abc'))
    expect(hash('abc')).not.toBe(hash('abd'))
  })
})

describe('parser SSE', () => {
  it('estrae eventi completi, ignora i ping e conserva il resto incompleto', () => {
    const { events, rest } = parseSse('event: hello\ndata: {}\n\n: ping\n\nevent: change\ndata: {"topic":"inbox"}\n\nevent: chan')
    expect(events).toEqual([{ event: 'hello', data: '{}' }, { event: 'change', data: '{"topic":"inbox"}' }])
    expect(rest).toBe('event: chan')
  })
})
