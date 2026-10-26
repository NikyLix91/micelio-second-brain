/**
 * @file Chiave del relay del server del team (B8), come la calcola un PC.
 *
 * EN: Key of the team server relay (B8), as a PC computes it.
 *
 * Il server del team (server/src/relay.ts) offre un relay per le connessioni che l'hole punching
 * non riesce a stabilire. La sua chiave si ricava dall'indirizzo del server, così i PC la
 * conoscono senza configurare nulla: questa è la STESSA derivazione di server/src/relay.ts (il
 * server non importa codice della radice, quindi è duplicata; test/unit/relay-key.test.ts
 * verifica che coincidano). Cambiarla da una parte sola romperebbe il relay.
 *
 * EN: The team server (server/src/relay.ts) offers a relay for connections that hole punching
 * cannot establish. Its key is derived from the server address, so the PCs know it without any
 * configuration: this is the SAME derivation as server/src/relay.ts (the server does not import
 * code from the repo root, so it is duplicated; test/unit/relay-key.test.ts checks that they
 * match). Changing it on one side only would break the relay.
 */
import { createHash } from 'node:crypto'
import HyperDHT from 'hyperdht'

/**
 * Chiave pubblica del relay del server `host:port`.
 *
 * EN: Public key of the relay of server `host:port`.
 * @returns 32 byte, come li vuole Hyperswarm (`relayThrough`)
 *          EN: 32 bytes, as Hyperswarm expects them (`relayThrough`)
 */
/**
 * Chiave del relay da usare per un nodo di avvio: quella casuale del server se l'indirizzo la porta
 * (`host:porta#chiave`, 0.6.2), altrimenti quella ricavata dall'indirizzo.
 *
 * EN: Relay key to use for a bootstrap node: the server's random one if the address carries it
 * (`host:port#key`, 0.6.2), otherwise the one derived from the address.
 */
export function relayKeyOf (node: { host: string, port: number, relay?: string }): Buffer {
  return node.relay ? Buffer.from(node.relay, 'hex') : relayKeyFor(node.host, node.port)
}

export function relayKeyFor (host: string, port: number): Buffer {
  const seed = createHash('sha256').update(`micelio-relay/v1\n${host}:${port}`).digest()
  return HyperDHT.keyPair(seed).publicKey
}
