// B8: la chiave del relay si ricava dall'indirizzo del server, con la STESSA formula sul server
// (server/src/relay.ts) e sui PC (src/net/relay-key.ts). Se divergono, il relay non si trova più.
// EN: B8: the relay key is derived from the server address, with the SAME formula on the server
//     (server/src/relay.ts) and on the PCs (src/net/relay-key.ts). If they diverge, the relay can no longer be found.
import { describe, expect, it } from 'vitest'
import { relayKeyFor } from '../../src/net/relay-key'
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
