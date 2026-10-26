/**
 * @file Diagnosi della rete P2P (`micelio network check`).
 *
 * EN: P2P network diagnostics (`micelio network check`).
 *
 * Domanda a cui risponde: "questo PC riesce a entrare nella DHT del team, e con che tipo di
 * connessione?". Crea un nodo DHT temporaneo (non tocca il daemon né il team), lo collega ai nodi
 * di avvio configurati e riporta:
 * - se i nodi di avvio rispondono e quanti nodi si conoscono;
 * - l'indirizzo PUBBLICO con cui questo PC si presenta su internet;
 * - se il router cambia porta a ogni destinazione (NAT "simmetrico"): è il caso più difficile per
 *   l'hole punching. Se ce l'hanno ENTRAMBI i lati, la connessione diretta può non riuscire.
 *
 * EN: The question it answers: "can this PC join the team's DHT, and with what kind of
 * connection?". It creates a temporary DHT node (it touches neither the daemon nor the team),
 * connects it to the configured bootstrap nodes and reports:
 * - whether the bootstrap nodes answer and how many nodes are known;
 * - the PUBLIC address this PC shows on the internet;
 * - whether the router changes port for each destination ("symmetric" NAT): the hardest case for
 *   hole punching. If BOTH sides have it, the direct connection may fail.
 *
 * Limite: per vedere il NAT simmetrico servono risposte da almeno due nodi DHT diversi. Con un
 * server privato a nodo singolo l'indicazione non è disponibile (vedi server/README.md, --extra-nodes).
 *
 * EN: Limitation: detecting symmetric NAT needs answers from at least two different DHT nodes. With a
 * single-node private server this information is not available (see server/README.md, --extra-nodes).
 */
import HyperDHT from 'hyperdht'
import { relayKeyOf } from './relay-key'

export interface NetworkCheck {
  /** "pubblica" (Holepunch) o l'elenco dei nodi di avvio privati. / EN: "pubblica" (Holepunch) or the list of private bootstrap nodes. */
  dht: string
  /** true se almeno un nodo della DHT ha risposto. / EN: true if at least one DHT node answered. */
  reachable: boolean
  /** Nodi conosciuti dopo l'ingresso. / EN: Nodes known after joining. */
  nodes: number
  /** Indirizzo pubblico visto dagli altri nodi (null se non determinato). / EN: Public address seen by the other nodes (null if not determined). */
  publicHost: string | null
  /** true = il router cambia porta per ogni destinazione (NAT simmetrico). null = non determinabile. / EN: true = the router changes port for each destination (symmetric NAT). null = cannot be determined. */
  randomizedPort: boolean | null
  /** Millisecondi impiegati per entrare nella DHT. / EN: Milliseconds taken to join the DHT. */
  ms: number
  /**
   * Solo DHT privata (B8): il server del team offre il relay, il piano B quando l'hole punching
   * fra due PC non riesce? null = DHT pubblica (nessun relay) o DHT non raggiungibile.
   *
   * EN: Private DHT only (B8): does the team server offer the relay, the plan B when hole punching
   * between two PCs fails? null = public DHT (no relay) or DHT not reachable.
   */
  relay: boolean | null
}

/**
 * Esegue la diagnosi.
 *
 * EN: Runs the diagnostics.
 * @param bootstrap nodi di avvio (undefined = DHT pubblica)
 *        EN: bootstrap nodes (undefined = public DHT)
 * @param timeoutMs tempo massimo per entrare nella DHT
 *        EN: maximum time to join the DHT
 */
export async function checkNetwork (bootstrap: { host: string, port: number, relay?: string }[] | undefined, timeoutMs = 20_000): Promise<NetworkCheck> {
  const t0 = Date.now()
  const dht = new HyperDHT({ ...(bootstrap ? { bootstrap: bootstrap.map(({ host, port }) => ({ host, port })) } : {}) })
  try {
    // fullyBootstrapped: attende il primo giro di contatti con la DHT (o il fallimento).
    // EN: fullyBootstrapped: waits for the first round of contacts with the DHT (or the failure).
    await Promise.race([
      dht.fullyBootstrapped(),
      new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ])
    const nodes = dht.toArray().length
    // Il campionatore NAT di dht-rpc: `host` noto e `port` 0 = porta diversa per ogni destinazione.
    // EN: dht-rpc's NAT sampler: known `host` and `port` 0 = a different port for each destination.
    const host: string | null = dht.host ?? null
    const relay = bootstrap?.length && nodes > 0 ? await relayAnswers(dht, relayKeyOf(bootstrap[0])) : null
    return {
      dht: bootstrap ? bootstrap.map((b) => `${b.host}:${b.port}`).join(', ') : 'pubblica (Holepunch)',
      reachable: nodes > 0,
      nodes,
      publicHost: host,
      randomizedPort: host === null || nodes < 2 ? null : dht.port === 0,
      ms: Date.now() - t0,
      relay
    }
  } finally {
    await dht.destroy()
  }
}

/** true se il relay con quella chiave accetta una connessione entro 10 secondi. / EN: true if the relay with that key accepts a connection within 10 seconds. */
function relayAnswers (dht: any, key: Buffer): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = dht.connect(key)
    const timer = setTimeout(() => { socket.destroy(); resolve(false) }, 10_000)
    socket.once('open', () => { clearTimeout(timer); socket.destroy(); resolve(true) })
    socket.once('error', () => { clearTimeout(timer); resolve(false) })
  })
}
