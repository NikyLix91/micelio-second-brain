/**
 * @file Relay del server del team (B8): il piano B quando due PC non riescono a collegarsi direttamente.
 *
 * EN: Team server relay (B8): the fallback when two PCs cannot connect directly.
 *
 * I PC del team si collegano DIRETTAMENTE con l'hole punching: il server fa solo da intermediario
 * per presentarli. Fra due reti aziendali o con NAT restrittivi l'hole punching può fallire, e
 * senza un piano B i due PC restano a 0 peer (prova reale del 2026-10-19). Il relay è quel piano B:
 * la connessione passa dal server.
 *
 * EN: The team PCs connect DIRECTLY with hole punching: the server only acts as an intermediary
 * to introduce them. Between two corporate networks or with strict NATs hole punching can fail, and
 * without a fallback the two PCs stay at 0 peers (real test on 2026-10-19). The relay is that
 * fallback: the connection goes through the server.
 *
 * - È un `blind-relay` di Holepunch: inoltra i pacchetti di una connessione già cifrata da un
 *   capo all'altro (Noise). Il server non ha le chiavi e non può leggere nulla.
 * - Vive sullo STESSO nodo DHT del server (stessa porta UDP): nessuna porta in più da aprire.
 *   I PC lo trovano perché un nodo DHT risponde anche per i server in ascolto su sé stesso.
 * - I PC lo usano solo quando serve: dopo un hole punching fallito, o se il loro NAT è simmetrico.
 *
 * EN:
 * - It is a Holepunch `blind-relay`: it forwards the packets of a connection that is already
 *   end-to-end encrypted (Noise). The server has no keys and cannot read anything.
 * - It lives on the SAME DHT node as the server (same UDP port): no extra port to open.
 *   PCs find it because a DHT node also answers for the servers listening on itself.
 * - PCs use it only when needed: after a failed hole punch, or if their NAT is symmetric.
 *
 * La CHIAVE del relay si ricava dall'indirizzo del server (decisione dell'utente: nessuna
 * configurazione in più sui PC). La stessa derivazione è in src/net/relay-key.ts (il server non
 * importa codice della radice); un test verifica che coincidano. Conseguenza accettata: chi conosce
 * l'indirizzo può calcolare anche la chiave segreta e avviare un finto relay. Il traffico resta
 * comunque cifrato fra i PC: il peggio che può fare è non inoltrare, cioè un disservizio. In una
 * DHT privata l'indirizzo lo conosce solo il team.
 *
 * EN: The relay KEY is derived from the server address (user's decision: no extra configuration
 * on the PCs). The same derivation is in src/net/relay-key.ts (the server does not import code
 * from the repo root); a test checks that they match. Accepted consequence: whoever knows the
 * address can also compute the secret key and start a fake relay. Traffic stays encrypted between
 * the PCs anyway: the worst it can do is not forward, i.e. a denial of service. In a private DHT
 * only the team knows the address.
 */
import { createHash } from 'node:crypto'
import HyperDHT from 'hyperdht'
import { Server as RelayServer } from 'blind-relay'

/** Seme della chiave del relay: dipende solo dall'indirizzo pubblico del server. / EN: Seed of the relay key: it depends only on the server's public address. */
export function relaySeed (host: string, port: number): Buffer {
  return createHash('sha256').update(`micelio-relay/v1\n${host}:${port}`).digest()
}

/** Chiave pubblica del relay (hex), come la calcolano i PC del team. / EN: Public key of the relay (hex), as the team PCs compute it. */
export function relayPublicKey (host: string, port: number): string {
  return HyperDHT.keyPair(relaySeed(host, port)).publicKey.toString('hex')
}

export interface RelayStats {
  /** Connessioni al relay da quando è partito (ogni PC che passa dal relay ne apre una). / EN: Connections to the relay since it started (each PC going through the relay opens one). */
  sessions: number
  /** Connessioni aperte adesso. / EN: Connections open right now. */
  active: number
}

/** Ciò che il relay usa del nodo DHT. Tipo strutturale: i test della radice compilano questo file
 * con `hyperdht` dichiarato senza tipi (src/types/holepunch.d.ts).
 *
 * EN: What the relay uses of the DHT node. Structural type: the repo-root tests compile this file
 * with `hyperdht` declared without types (src/types/holepunch.d.ts). */
interface DhtNode {
  createServer (opts: object, onconnection: (socket: any) => void): { listen (keyPair: { publicKey: Buffer, secretKey: Buffer }): Promise<void>, close (): Promise<void> }
  createRawStream (opts?: object): any
}

/**
 * Avvia il relay sul nodo DHT del server.
 *
 * EN: Starts the relay on the server's DHT node.
 * @param dht il nodo di avvio (non "firewalled": i PC lo raggiungono direttamente)
 *        EN: the bootstrap node (not "firewalled": the PCs reach it directly)
 */
export async function startRelay (dht: DhtNode, host: string, port: number): Promise<{ publicKey: string, stats: () => RelayStats, close: () => Promise<void> }> {
  const stats: RelayStats = { sessions: 0, active: 0 }
  // Gli stream inoltrati sono stream UDX "grezzi" sullo stesso socket del nodo DHT
  // EN: The forwarded streams are "raw" UDX streams on the same socket as the DHT node
  const relay = new RelayServer({ createStream: (opts: object) => dht.createRawStream({ ...opts, framed: true }) })
  const server = dht.createServer({ shareLocalAddress: false }, (socket: any) => {
    stats.sessions++
    stats.active++
    socket.on('close', () => { stats.active-- })
    // Un PC che cade o un messaggio malformato non devono fermare il server
    // EN: A PC dropping or a malformed message must not stop the server
    socket.on('error', () => {})
    relay.accept(socket, { id: socket.remotePublicKey }).on('error', () => {})
  })
  const keyPair = HyperDHT.keyPair(relaySeed(host, port))
  await server.listen(keyPair)
  return {
    publicKey: keyPair.publicKey.toString('hex'),
    stats: () => ({ ...stats }),
    close: async () => { await server.close(); await relay.close() }
  }
}
