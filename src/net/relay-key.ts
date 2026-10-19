/**
 * @file Chiave del relay del server del team (B8), come la calcola un PC.
 *
 * Il server del team (server/src/relay.ts) offre un relay per le connessioni che l'hole punching
 * non riesce a stabilire. La sua chiave si ricava dall'indirizzo del server, così i PC la
 * conoscono senza configurare nulla: questa è la STESSA derivazione di server/src/relay.ts (il
 * server non importa codice della radice, quindi è duplicata; test/unit/relay-key.test.ts
 * verifica che coincidano). Cambiarla da una parte sola romperebbe il relay.
 */
import { createHash } from 'node:crypto'
import HyperDHT from 'hyperdht'

/**
 * Chiave pubblica del relay del server `host:port`.
 * @returns 32 byte, come li vuole Hyperswarm (`relayThrough`)
 */
export function relayKeyFor (host: string, port: number): Buffer {
  const seed = createHash('sha256').update(`micelio-relay/v1\n${host}:${port}`).digest()
  return HyperDHT.keyPair(seed).publicKey
}
