/**
 * @file Nodo di avvio della DHT privata di Micelio.
 *
 * EN: Bootstrap node of Micelio's private DHT.
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
 * EN: WHAT IT IS. Micelio nodes find each other on the internet through a DHT (distributed hash
 * table): each node announces "for the team with fingerprint X, I answer at this address" and looks
 * for the others with the same fingerprint. To join the DHT you need at least one known address: the
 * bootstrap node. By default Micelio uses Holepunch's public bootstrap nodes; with this server the
 * team uses a DHT ALL OF ITS OWN:
 * - no dependency on third-party servers;
 * - team fingerprints and member IP addresses do not end up in the public DHT;
 * - IT only needs to open ONE UDP port on a machine it controls.
 *
 * COSA FA. Il nodo di avvio è anche un nodo completo della DHT: conserva gli annunci dei team e
 * fa da intermediario per l'"hole punching" (i due PC dietro router si contattano nello stesso
 * istante e i router lasciano passare la connessione, che da lì è DIRETTA fra i PC). Non vede
 * né i contenuti né le chiavi dei team: solo impronte (hash) e indirizzi IP.
 *
 * EN: WHAT IT DOES. The bootstrap node is also a full DHT node: it stores the team announcements and
 * acts as intermediary for "hole punching" (the two PCs behind routers contact each other at the same
 * moment and the routers let the connection through, which from then on is DIRECT between the PCs).
 * It sees neither the content nor the team keys: only fingerprints (hashes) and IP addresses.
 *
 * RELAY (B8). Se due PC non riescono a collegarsi direttamente (reti aziendali, NAT restrittivi),
 * la connessione passa dal server, sempre cifrata fra i PC: vedi relay.ts. Stessa porta UDP.
 *
 * EN: RELAY (B8). If two PCs cannot connect directly (corporate networks, strict NATs), the
 * connection goes through the server, still encrypted end to end between the PCs: see relay.ts. Same UDP port.
 *
 * ATTIVITÀ (B8). Il server conta chi lo contatta e cosa chiede (PC distinti, annunci, ricerche,
 * hole punching fatti da intermediario, connessioni in relay): finisce nel log a intervalli, così
 * un problema di rete si vede anche dal server e non solo dai PC.
 *
 * EN: ACTIVITY (B8). The server counts who contacts it and what they ask (distinct PCs, announcements,
 * lookups, hole punching it brokered, relayed connections): this goes to the log at intervals, so
 * a network problem is visible from the server too, not only from the PCs.
 *
 * Facoltativamente avvia altri nodi DHT sulle porte successive (`extraNodes`), per avere più di
 * un nodo che conserva gli annunci. Richiedono altrettante porte UDP aperte.
 *
 * EN: Optionally it starts more DHT nodes on the following ports (`extraNodes`), to have more than
 * one node storing the announcements. They need as many open UDP ports.
 */
import HyperDHT from 'hyperdht'
import { type RelayKeyOptions, type RelayStats, startRelay } from './relay'

export interface ServerOptions {
  /**
   * Indirizzo IPv4 PUBBLICO con cui i client raggiungono il server (quello che metteranno in
   * `micelio network set`). Il nodo di avvio lo comunica agli altri come proprio indirizzo.
   *
   * EN: PUBLIC IPv4 address clients use to reach the server (the one they will put in
   * `micelio network set`). The bootstrap node tells the others it is its own address.
   */
  publicHost: string
  /** Porta UDP del nodo di avvio (default 49737, la stessa convenzione di HyperDHT). / EN: UDP port of the bootstrap node (default 49737, the same HyperDHT convention). */
  port: number
  /** Interfaccia locale su cui ascoltare (default 0.0.0.0 = tutte). / EN: Local interface to listen on (default 0.0.0.0 = all). */
  bindHost?: string
  /** Nodi DHT aggiuntivi sulle porte port+1 … port+N (default 0). / EN: Extra DHT nodes on ports port+1 … port+N (default 0). */
  extraNodes?: number
  /** Chiave del relay: seme casuale e chiave vecchia sì/no (vedi relay.ts). / EN: Relay key: random seed and old key yes/no (see relay.ts). */
  relay?: RelayKeyOptions
  log?: (msg: string) => void
}

export interface RunningServer {
  /** Stringa da dare ai client: "host:porta", con "#chiave del relay" se è casuale. / EN: String to give to clients: "host:port", with "#relay key" if it is random. */
  bootstrap: string
  /**
   * Nodi DHT PERSISTENTI noti al nodo di avvio (gli altri server, i nodi aggiuntivi, eventuali
   * client con IP pubblico). I PC dietro NAT sono nodi "effimeri" e non compaiono qui.
   *
   * EN: PERSISTENT DHT nodes known to the bootstrap node (other servers, the extra nodes, any
   * clients with a public IP). PCs behind NAT are "ephemeral" nodes and do not show up here.
   */
  dhtNodes: () => number
  /** Chiave pubblica del relay (hex): la casuale se c'è, altrimenti quella ricavata dall'indirizzo. / EN: Public key of the relay (hex): the random one if any, otherwise the one derived from the address. */
  relayKey: string
  /**
   * Attività dall'ultima chiamata (e azzera i contatori): PC distinti, richieste per tipo, relay.
   * La usa il battito periodico del log.
   *
   * EN: Activity since the last call (and resets the counters): distinct PCs, requests by type, relay.
   * Used by the periodic log heartbeat.
   */
  activity: () => Activity
  close: () => Promise<void>
}

/** Attività del server in un intervallo. / EN: Server activity over an interval. */
export interface Activity {
  /** Indirizzi IP distinti che hanno contattato il server. / EN: Distinct IP addresses that contacted the server. */
  clients: number
  /** Annunci ricevuti (un PC che dice "per questo team rispondo io"). / EN: Announcements received (a PC saying "I answer for this team"). */
  announces: number
  /** Ricerche di un team o di un PC. / EN: Lookups of a team or a PC. */
  lookups: number
  /** Presentazioni fra due PC fatte da intermediario (inizio dell'hole punching). / EN: Introductions between two PCs brokered by the server (start of hole punching). */
  handshakes: number
  holepunches: number
  relay: RelayStats
}

/** Comandi di HyperDHT (hyperdht/lib/constants.js): servono solo a contare l'attività. / EN: HyperDHT commands (hyperdht/lib/constants.js): used only to count activity. */
const CMD = { PEER_HANDSHAKE: 0, PEER_HOLEPUNCH: 1, FIND_PEER: 2, LOOKUP: 3, ANNOUNCE: 4 }

/** Porta standard dei nodi di avvio HyperDHT. / EN: Standard port of HyperDHT bootstrap nodes. */
export const DEFAULT_PORT = 49737

/** Avvia il nodo di avvio (ed eventuali nodi aggiuntivi) e attende che siano pronti. / EN: Starts the bootstrap node (and any extra nodes) and waits until they are ready. */
export async function startServer (opts: ServerOptions): Promise<RunningServer> {
  const log = opts.log ?? (() => {})
  const bindHost = opts.bindHost ?? '0.0.0.0'

  // 1) Nodo di avvio: porta fissa, non "firewalled", nessun altro bootstrap (è lui il primo).
  // EN: 1) Bootstrap node: fixed port, not "firewalled", no other bootstrap (it is the first one).
  const boot = HyperDHT.bootstrapper(opts.port, opts.publicHost, { host: bindHost })
  await boot.ready()
  log(`nodo di avvio in ascolto su ${bindHost}:${opts.port} (UDP), annunciato come ${opts.publicHost}:${opts.port}`)

  // Contatori dell'attività. HyperDHT gestisce le richieste nel metodo `onrequest` (non con un
  // evento), quindi lo avvolgiamo: contiamo e poi lasciamo fare a lui, senza cambiare nulla.
  // EN: Activity counters. HyperDHT handles requests in the `onrequest` method (not with an
  //     event), so we wrap it: we count, then let it do its job, without changing anything.
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
  // EN: Relay on the same node (same port): plan B when hole punching fails
  const relay = await startRelay(boot, opts.publicHost, opts.port, opts.relay)
  if (opts.relay?.seed) {
    log(`relay attivo con chiave casuale ${relay.publicKey.slice(0, 12)}…${relay.legacy ? ' (e, per i PC non aggiornati, anche con quella ricavata dall\'indirizzo: MICELIO_SERVER_RELAY_LEGACY=0 per spegnerla)' : ''}`)
  } else {
    log(`ATTENZIONE: relay con la chiave ricavata dall'indirizzo, calcolabile da chiunque. Imposta MICELIO_SERVER_RELAY_SEED (64 cifre esadecimali casuali, es. openssl rand -hex 32)`)
  }

  // 2) Nodi aggiuntivi: persistenti, si appoggiano al nodo di avvio.
  // Tipo strutturale (non `HyperDHT[]`): questo file è compilato anche dai test della radice,
  // dove `hyperdht` è dichiarato come modulo senza tipi.
  // EN: 2) Extra nodes: persistent, they rely on the bootstrap node.
  //     Structural type (not `HyperDHT[]`): this file is also compiled by the root tests,
  //     where `hyperdht` is declared as a module without types.
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
    bootstrap: `${opts.publicHost}:${opts.port}${opts.relay?.seed ? '#' + relay.publicKey : ''}`,
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
