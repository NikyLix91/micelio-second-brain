/**
 * @file Relay del server del team (B8): il piano B quando due PC non riescono a collegarsi direttamente.
 *
 * I PC del team si collegano DIRETTAMENTE con l'hole punching: il server fa solo da intermediario
 * per presentarli. Fra due reti aziendali o con NAT restrittivi l'hole punching può fallire, e
 * senza un piano B i due PC restano a 0 peer (prova reale del 2026-10-19). Il relay è quel piano B:
 * la connessione passa dal server.
 *
 * - È un `blind-relay` di Holepunch: inoltra i pacchetti di una connessione già cifrata da un
 *   capo all'altro (Noise). Il server non ha le chiavi e non può leggere nulla.
 * - Vive sullo STESSO nodo DHT del server (stessa porta UDP): nessuna porta in più da aprire.
 *   I PC lo trovano perché un nodo DHT risponde anche per i server in ascolto su sé stesso.
 * - I PC lo usano solo quando serve: dopo un hole punching fallito, o se il loro NAT è simmetrico.
 *
 * La CHIAVE del relay si ricava dall'indirizzo del server (decisione dell'utente: nessuna
 * configurazione in più sui PC). La stessa derivazione è in src/net/relay-key.ts (il server non
 * importa codice della radice); un test verifica che coincidano. Conseguenza accettata: chi conosce
 * l'indirizzo può calcolare anche la chiave segreta e avviare un finto relay. Il traffico resta
 * comunque cifrato fra i PC: il peggio che può fare è non inoltrare, cioè un disservizio. In una
 * DHT privata l'indirizzo lo conosce solo il team.
 */
import { createHash } from 'node:crypto'
import HyperDHT from 'hyperdht'
import { Server as RelayServer } from 'blind-relay'

/** Seme della chiave del relay: dipende solo dall'indirizzo pubblico del server. */
export function relaySeed (host: string, port: number): Buffer {
  return createHash('sha256').update(`micelio-relay/v1\n${host}:${port}`).digest()
}

/** Chiave pubblica del relay (hex), come la calcolano i PC del team. */
export function relayPublicKey (host: string, port: number): string {
  return HyperDHT.keyPair(relaySeed(host, port)).publicKey.toString('hex')
}

export interface RelayStats {
  /** Connessioni al relay da quando è partito (ogni PC che passa dal relay ne apre una). */
  sessions: number
  /** Connessioni aperte adesso. */
  active: number
}

/** Ciò che il relay usa del nodo DHT. Tipo strutturale: i test della radice compilano questo file
 * con `hyperdht` dichiarato senza tipi (src/types/holepunch.d.ts). */
interface DhtNode {
  createServer (opts: object, onconnection: (socket: any) => void): { listen (keyPair: { publicKey: Buffer, secretKey: Buffer }): Promise<void>, close (): Promise<void> }
  createRawStream (opts?: object): any
}

/**
 * Avvia il relay sul nodo DHT del server.
 * @param dht il nodo di avvio (non "firewalled": i PC lo raggiungono direttamente)
 */
export async function startRelay (dht: DhtNode, host: string, port: number): Promise<{ publicKey: string, stats: () => RelayStats, close: () => Promise<void> }> {
  const stats: RelayStats = { sessions: 0, active: 0 }
  // Gli stream inoltrati sono stream UDX "grezzi" sullo stesso socket del nodo DHT
  const relay = new RelayServer({ createStream: (opts: object) => dht.createRawStream({ ...opts, framed: true }) })
  const server = dht.createServer({ shareLocalAddress: false }, (socket: any) => {
    stats.sessions++
    stats.active++
    socket.on('close', () => { stats.active-- })
    // Un PC che cade o un messaggio malformato non devono fermare il server
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
