/**
 * @file Nodo di avvio della DHT privata di Micelio.
 *
 * COS'È. I nodi Micelio si trovano su internet tramite una DHT (tabella distribuita): ogni nodo
 * annuncia "per il team con impronta X rispondo io a questo indirizzo" e cerca gli altri con la
 * stessa impronta. Per entrare nella DHT serve almeno un indirizzo noto: il nodo di avvio
 * (bootstrap). Di default Micelio usa i nodi di avvio pubblici di Holepunch; con questo server
 * il team usa una DHT TUTTA SUA:
 * - nessuna dipendenza da server di terzi;
 * - impronte del team e indirizzi IP dei membri non finiscono nella DHT pubblica;
 * - all'IT basta aprire UNA porta UDP su una macchina che controlla.
 *
 * COSA FA. Il nodo di avvio è anche un nodo completo della DHT: conserva gli annunci dei team e
 * fa da intermediario per l'"hole punching" (i due PC dietro router si contattano nello stesso
 * istante e i router lasciano passare la connessione, che da lì è DIRETTA fra i PC). Non vede
 * né i contenuti né le chiavi dei team: solo impronte (hash) e indirizzi IP.
 *
 * RELAY (B8). Se due PC non riescono a collegarsi direttamente (reti aziendali, NAT restrittivi),
 * la connessione passa dal server, sempre cifrata fra i PC: vedi relay.ts. Stessa porta UDP.
 *
 * ATTIVITÀ (B8). Il server conta chi lo contatta e cosa chiede (PC distinti, annunci, ricerche,
 * hole punching fatti da intermediario, connessioni in relay): finisce nel log a intervalli, così
 * un problema di rete si vede anche dal server e non solo dai PC.
 *
 * Facoltativamente avvia altri nodi DHT sulle porte successive (`extraNodes`), per avere più di
 * un nodo che conserva gli annunci. Richiedono altrettante porte UDP aperte.
 */
import HyperDHT from 'hyperdht'
import { type RelayStats, startRelay } from './relay'

export interface ServerOptions {
  /**
   * Indirizzo IPv4 PUBBLICO con cui i client raggiungono il server (quello che metteranno in
   * `micelio network set`). Il nodo di avvio lo comunica agli altri come proprio indirizzo.
   */
  publicHost: string
  /** Porta UDP del nodo di avvio (default 49737, la stessa convenzione di HyperDHT). */
  port: number
  /** Interfaccia locale su cui ascoltare (default 0.0.0.0 = tutte). */
  bindHost?: string
  /** Nodi DHT aggiuntivi sulle porte port+1 … port+N (default 0). */
  extraNodes?: number
  log?: (msg: string) => void
}

export interface RunningServer {
  /** Stringa da dare ai client: "host:porta". */
  bootstrap: string
  /**
   * Nodi DHT PERSISTENTI noti al nodo di avvio (gli altri server, i nodi aggiuntivi, eventuali
   * client con IP pubblico). I PC dietro NAT sono nodi "effimeri" e non compaiono qui.
   */
  dhtNodes: () => number
  /** Chiave pubblica del relay (hex): i PC la ricavano da soli dall'indirizzo. */
  relayKey: string
  /**
   * Attività dall'ultima chiamata (e azzera i contatori): PC distinti, richieste per tipo, relay.
   * La usa il battito periodico del log.
   */
  activity: () => Activity
  close: () => Promise<void>
}

/** Attività del server in un intervallo. */
export interface Activity {
  /** Indirizzi IP distinti che hanno contattato il server. */
  clients: number
  /** Annunci ricevuti (un PC che dice "per questo team rispondo io"). */
  announces: number
  /** Ricerche di un team o di un PC. */
  lookups: number
  /** Presentazioni fra due PC fatte da intermediario (inizio dell'hole punching). */
  handshakes: number
  holepunches: number
  relay: RelayStats
}

/** Comandi di HyperDHT (hyperdht/lib/constants.js): servono solo a contare l'attività. */
const CMD = { PEER_HANDSHAKE: 0, PEER_HOLEPUNCH: 1, FIND_PEER: 2, LOOKUP: 3, ANNOUNCE: 4 }

/** Porta standard dei nodi di avvio HyperDHT. */
export const DEFAULT_PORT = 49737

/** Avvia il nodo di avvio (ed eventuali nodi aggiuntivi) e attende che siano pronti. */
export async function startServer (opts: ServerOptions): Promise<RunningServer> {
  const log = opts.log ?? (() => {})
  const bindHost = opts.bindHost ?? '0.0.0.0'

  // 1) Nodo di avvio: porta fissa, non "firewalled", nessun altro bootstrap (è lui il primo).
  const boot = HyperDHT.bootstrapper(opts.port, opts.publicHost, { host: bindHost })
  await boot.ready()
  log(`nodo di avvio in ascolto su ${bindHost}:${opts.port} (UDP), annunciato come ${opts.publicHost}:${opts.port}`)

  // Contatori dell'attività. HyperDHT gestisce le richieste nel metodo `onrequest` (non con un
  // evento), quindi lo avvolgiamo: contiamo e poi lasciamo fare a lui, senza cambiare nulla.
  const ips = new Set<string>()
  const counts = { announces: 0, lookups: 0, handshakes: 0, holepunches: 0 }
  const handle = boot.onrequest.bind(boot)
  boot.onrequest = (req: any) => {
    if (req?.from?.host) ips.add(req.from.host)
    switch (req?.command) {
      case CMD.ANNOUNCE: counts.announces++; break
      case CMD.LOOKUP: case CMD.FIND_PEER: counts.lookups++; break
      case CMD.PEER_HANDSHAKE: counts.handshakes++; break
      case CMD.PEER_HOLEPUNCH: counts.holepunches++; break
    }
    return handle(req)
  }

  // Relay sullo stesso nodo (stessa porta): piano B quando l'hole punching non riesce
  const relay = await startRelay(boot, opts.publicHost, opts.port)
  log(`relay attivo (chiave ${relay.publicKey.slice(0, 12)}…, ricavata dall'indirizzo: i PC la conoscono da soli)`)

  // 2) Nodi aggiuntivi: persistenti, si appoggiano al nodo di avvio.
  // Tipo strutturale (non `HyperDHT[]`): questo file è compilato anche dai test della radice,
  // dove `hyperdht` è dichiarato come modulo senza tipi.
  const extra: { destroy: () => Promise<void> }[] = []
  for (let i = 1; i <= (opts.extraNodes ?? 0); i++) {
    const node = new HyperDHT({
      port: opts.port + i,
      host: bindHost,
      anyPort: false,
      ephemeral: false,
      firewalled: false,
      bootstrap: [{ host: opts.publicHost, port: opts.port }]
    })
    await node.ready()
    extra.push(node)
    log(`nodo DHT aggiuntivo in ascolto sulla porta ${opts.port + i} (UDP)`)
  }

  return {
    bootstrap: `${opts.publicHost}:${opts.port}`,
    dhtNodes: () => boot.toArray().length,
    relayKey: relay.publicKey,
    activity: () => {
      const out: Activity = { clients: ips.size, ...counts, relay: relay.stats() }
      ips.clear()
      counts.announces = counts.lookups = counts.handshakes = counts.holepunches = 0
      return out
    },
    close: async () => {
      await relay.close().catch(() => {})
      for (const n of extra) await n.destroy()
      await boot.destroy()
    }
  }
}
