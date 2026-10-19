/**
 * @file Diagnosi della rete P2P (`micelio network check`).
 *
 * Domanda a cui risponde: "questo PC riesce a entrare nella DHT del team, e con che tipo di
 * connessione?". Crea un nodo DHT temporaneo (non tocca il daemon né il team), lo collega ai nodi
 * di avvio configurati e riporta:
 * - se i nodi di avvio rispondono e quanti nodi si conoscono;
 * - l'indirizzo PUBBLICO con cui questo PC si presenta su internet;
 * - se il router cambia porta a ogni destinazione (NAT "simmetrico"): è il caso più difficile per
 *   l'hole punching. Se ce l'hanno ENTRAMBI i lati, la connessione diretta può non riuscire.
 *
 * Limite: per vedere il NAT simmetrico servono risposte da almeno due nodi DHT diversi. Con un
 * server privato a nodo singolo l'indicazione non è disponibile (vedi server/README.md, --extra-nodes).
 */
import HyperDHT from 'hyperdht'
import { relayKeyFor } from './relay-key'

export interface NetworkCheck {
  /** "pubblica" (Holepunch) o l'elenco dei nodi di avvio privati. */
  dht: string
  /** true se almeno un nodo della DHT ha risposto. */
  reachable: boolean
  /** Nodi conosciuti dopo l'ingresso. */
  nodes: number
  /** Indirizzo pubblico visto dagli altri nodi (null se non determinato). */
  publicHost: string | null
  /** true = il router cambia porta per ogni destinazione (NAT simmetrico). null = non determinabile. */
  randomizedPort: boolean | null
  /** Millisecondi impiegati per entrare nella DHT. */
  ms: number
  /**
   * Solo DHT privata (B8): il server del team offre il relay, il piano B quando l'hole punching
   * fra due PC non riesce? null = DHT pubblica (nessun relay) o DHT non raggiungibile.
   */
  relay: boolean | null
}

/**
 * Esegue la diagnosi.
 * @param bootstrap nodi di avvio (undefined = DHT pubblica)
 * @param timeoutMs tempo massimo per entrare nella DHT
 */
export async function checkNetwork (bootstrap: { host: string, port: number }[] | undefined, timeoutMs = 20_000): Promise<NetworkCheck> {
  const t0 = Date.now()
  const dht = new HyperDHT({ ...(bootstrap ? { bootstrap } : {}) })
  try {
    // fullyBootstrapped: attende il primo giro di contatti con la DHT (o il fallimento).
    await Promise.race([
      dht.fullyBootstrapped(),
      new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ])
    const nodes = dht.toArray().length
    // Il campionatore NAT di dht-rpc: `host` noto e `port` 0 = porta diversa per ogni destinazione.
    const host: string | null = dht.host ?? null
    const relay = bootstrap?.length && nodes > 0 ? await relayAnswers(dht, relayKeyFor(bootstrap[0].host, bootstrap[0].port)) : null
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

/** true se il relay con quella chiave accetta una connessione entro 10 secondi. */
function relayAnswers (dht: any, key: Buffer): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = dht.connect(key)
    const timer = setTimeout(() => { socket.destroy(); resolve(false) }, 10_000)
    socket.once('open', () => { clearTimeout(timer); socket.destroy(); resolve(true) })
    socket.once('error', () => { clearTimeout(timer); resolve(false) })
  })
}
