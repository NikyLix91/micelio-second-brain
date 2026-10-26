// B8: la chiave del relay si ricava dall'indirizzo del server, con la STESSA formula sul server
// (server/src/relay.ts) e sui PC (src/net/relay-key.ts). Se divergono, il relay non si trova più.
// EN: B8: the relay key is derived from the server address, with the SAME formula on the server
//     (server/src/relay.ts) and on the PCs (src/net/relay-key.ts). If they diverge, the relay can no longer be found.
import { describe, expect, it } from 'vitest'
import { relayKeyFor, relayKeyOf } from '../../src/net/relay-key'
import { BOOTSTRAP_RE, parseBootstrap } from '../../src/node/config'
import { relayPublicKey } from '../../server/src/relay'

describe('chiave del relay del server', () => {
  it('server e PC calcolano la stessa chiave dallo stesso indirizzo', () => {
    expect(relayKeyFor('203.0.113.10', 49737).toString('hex')).toBe(relayPublicKey('203.0.113.10', 49737))
  })

  it('indirizzo o porta diversi → chiave diversa', () => {
    const k = relayKeyFor('203.0.113.10', 49737).toString('hex')
    expect(relayKeyFor('203.0.113.11', 49737).toString('hex')).not.toBe(k)
    expect(relayKeyFor('203.0.113.10', 49738).toString('hex')).not.toBe(k)
  })
})

describe('chiave casuale del relay nell\'indirizzo (0.6.2)', () => {
  const key = 'ab'.repeat(32)

  it('host:porta#chiave è un nodo di avvio valido e la chiave vince su quella ricavata', () => {
    expect(BOOTSTRAP_RE.test(`203.0.113.10:49737#${key}`)).toBe(true)
    expect(BOOTSTRAP_RE.test('203.0.113.10:49737')).toBe(true)
    for (const bad of ['203.0.113.10:49737#corta', `203.0.113.10#${key}`, `203.0.113.10:49737#${key.toUpperCase()}`]) expect(BOOTSTRAP_RE.test(bad)).toBe(false)
    const [withKey, without] = parseBootstrap([`203.0.113.10:49737#${key}`, '203.0.113.10:49737'])
    expect(withKey).toEqual({ host: '203.0.113.10', port: 49737, relay: key })
    expect(without).toEqual({ host: '203.0.113.10', port: 49737 })
    expect(relayKeyOf(withKey).toString('hex')).toBe(key)
    expect(relayKeyOf(without).toString('hex')).toBe(relayPublicKey('203.0.113.10', 49737))
  })
})
