import { describe, expect, it } from 'vitest'
import type { MemoryRecord } from '../../src/core/model'
import { MemoryIndex, toFtsQuery } from '../../src/store/memory-index'

const mem = (id: string, title: string, body: string, tags: string[] = []): MemoryRecord =>
  ({ id, kind: 'fact', title, body, tags, source: { type: 'cli' }, author: 'k', ts: 1, status: 'active' })

describe('MemoryIndex', () => {
  const idx = new MemoryIndex(':memory:')
  idx.rebuild([
    mem('1', 'Build Angular in out of memory', 'Impostare NODE_OPTIONS su Azure DevOps', ['angular', 'ci']),
    mem('2', 'Perché usiamo Drizzle', 'Niente motore binario, a differenza di Prisma', ['orm']),
    mem('3', 'Retry SFTP', 'keepaliveInterval e backoff esponenziale', ['sftp'])
  ], [{ key: 'k', name: 'alice', role: 'admin', invitedBy: null, removed: false, joinedAt: 1 }])

  it('trova per parole del titolo, del corpo e dei tag', () => {
    expect(idx.search('angular')[0].id).toBe('1')
    expect(idx.search('prisma')[0].id).toBe('2')
    expect(idx.search('sftp')[0].id).toBe('3')
  })

  it('ignora gli accenti e usa i prefissi', () => {
    expect(idx.search('perche')[0].id).toBe('2')
    expect(idx.search('esponenz')[0].id).toBe('3')
  })

  it('riporta il nome dell\'autore', () => {
    expect(idx.search('drizzle')[0].authorName).toBe('alice')
  })

  it('non si rompe con sintassi FTS nell\'input', () => {
    expect(() => idx.search('NEAR(" AND -angular : *')).not.toThrow()
    expect(idx.search('')).toEqual([])
  })

  it('ricostruzione completa sostituisce il contenuto', () => {
    const i2 = new MemoryIndex(':memory:')
    i2.rebuild([mem('1', 'uno', 'x')], [])
    i2.rebuild([mem('2', 'due', 'y')], [])
    expect(i2.count()).toBe(1)
    expect(i2.search('uno')).toEqual([])
  })

  it('toFtsQuery produce prefissi quotati in OR', () => {
    expect(toFtsQuery('Build "Angular"!')).toBe('"build"* OR "angular"*')
  })
})

describe('MemoryIndex incrementale', () => {
  const members = [{ key: 'k', name: 'alice', role: 'admin' as const, invitedBy: null, removed: false, joinedAt: 1 }]
  it('aggiunge i nuovi, toglie gli usciti anche dalla ricerca testuale, aggiorna solo i segnali cambiati', () => {
    const idx = new MemoryIndex(':memory:')
    const a = mem('a', 'Timeout del gateway', 'keepalive 30 secondi')
    const b = mem('b', 'Retry SFTP', 'backoff esponenziale')
    idx.rebuild([a, b], members, { votes: new Map(), pins: new Set(), usage: new Map() })
    expect(idx.search('gateway').map((h) => h.id)).toEqual(['a'])
    // b esce (archiviato), c entra, a riceve un voto
    const c = mem('c', 'Gateway di pagamento', 'circuit breaker')
    idx.rebuild([a, c], members, { votes: new Map([['a', 2]]), pins: new Set(), usage: new Map() })
    expect(idx.count()).toBe(2)
    expect(idx.search('sftp')).toEqual([])
    expect(idx.search('gateway').map((h) => h.id).sort()).toEqual(['a', 'c'])
    expect(idx.signals().get('a')?.votes).toBe(2)
    // stesso stato: nulla da fare, risultato identico
    idx.rebuild([a, c], members, { votes: new Map([['a', 2]]), pins: new Set(), usage: new Map() })
    expect(idx.search('gateway')).toHaveLength(2)
  })
})
