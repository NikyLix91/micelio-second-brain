/**
 * @file Nodo di rete di un team: l'UNICO modulo che parla con le librerie Holepunch.
 *
 * EN: Network node of a team: the ONLY module that talks to the Holepunch libraries.
 *
 * Mette insieme tre pezzi:
 * - **Autobase**: log multi-writer. Ogni membro scrive sul proprio feed; Autobase li ordina e
 *   calcola la vista tramite `applyNodes` (src/net/apply.ts).
 * - **Hyperswarm**: trova gli altri membri su internet tramite una DHT (nessun server) e apre
 *   connessioni cifrate (Noise) attraverso i NAT.
 * - **blind-pairing**: protocollo d'ingresso. Il nuovo nodo presenta un codice d'invito, un
 *   membro online lo verifica e gli consegna, su canale cifrato, le chiavi del team (D2).
 *
 * EN: It brings together three pieces:
 * - **Autobase**: multi-writer log. Each member writes to its own feed; Autobase orders them and
 *   computes the view through `applyNodes` (src/net/apply.ts).
 * - **Hyperswarm**: finds the other members over the internet through a DHT (no server) and opens
 *   encrypted connections (Noise) through NATs.
 * - **blind-pairing**: join protocol. The new node presents an invite code, an online member
 *   checks it and hands over the team keys on an encrypted channel (D2).
 *
 * Lezioni dallo spike A (DESIGN §5) applicate qui:
 * - la replica deve agganciare anche il protocollo "wakeup", che segnala i core dei writer
 *   attivi; senza, i nuovi membri non vengono mai scoperti;
 * - Hyperswarm rifà la ricerca dei peer di rado: va rinfrescata spesso quando si è isolati.
 *
 * EN: Lessons from spike A (DESIGN §5) applied here:
 * - replication must also attach the "wakeup" protocol, which announces the cores of active
 *   writers; without it, new members are never discovered;
 * - Hyperswarm rarely repeats the peer lookup: refresh it often when isolated.
 *
 * Il resto del codice usa solo i metodi tipizzati di questa classe: le librerie Holepunch non
 * hanno tipi TypeScript (sono `any`, vedi src/types/holepunch.d.ts) e la loro API evolve.
 *
 * EN: The rest of the code only uses the typed methods of this class: the Holepunch libraries
 * have no TypeScript types (they are `any`, see src/types/holepunch.d.ts) and their API evolves.
 */
import { EventEmitter } from 'node:events'
import Autobase from 'autobase'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import BlindPairing from 'blind-pairing'
import Wakeup from 'protomux-wakeup'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import z32 from 'z32'
import { envelope, type EventPayload } from '../core/events'
import type { GapRecord, InviteRecord, MemberRecord, MemoryRecord, RedactAck, RootRecord, TeamRecord } from '../core/model'
import { KEYS, RANGES, applyNodes, openView } from './apply'
import { relayKeyFor } from './relay-key'

/**
 * Le due chiavi che identificano un team. Vanno salvate (state.json) e protette:
 * chi ha `encryptionKey` può leggere tutto il sapere del team.
 *
 * EN: The two keys that identify a team. Save them (state.json) and protect them:
 * whoever holds `encryptionKey` can read all of the team's knowledge.
 */
export interface TeamSecrets {
  /** Chiave pubblica dell'Autobase (identifica il team). / EN: Public key of the Autobase (identifies the team). */
  baseKey: string
  /** Chiave simmetrica con cui sono cifrati i blocchi di tutti i feed. / EN: Symmetric key that encrypts the blocks of all feeds. */
  encryptionKey: string
}

export interface TeamNodeOptions {
  /** Cartella del Corestore (i feed replicati). / EN: Corestore folder (the replicated feeds). */
  storeDir: string
  /** Nodi bootstrap della DHT (test o rete privata). Vuoto = DHT pubblica di Holepunch. / EN: DHT bootstrap nodes (tests or private network). Empty = Holepunch public DHT. */
  bootstrap?: { host: string, port: number }[]
  /** Funzione di log; di default silenziosa. / EN: Log function; silent by default. */
  log?: (msg: string) => void
  /**
   * Modalità SOLO LOCALE (B4): nessuna rete. Il nodo non entra nella DHT, non cerca peer e non
   * risponde a richieste d'ingresso: utile a chi usa Micelio da solo. Tutto il resto (log,
   * vista, permessi) funziona come sempre; per invitare qualcuno si sceglie una rete.
   *
   * EN: LOCAL ONLY mode (B4): no network. The node does not join the DHT, does not look for peers
   * and does not answer join requests: useful for people who use Micelio alone. Everything else
   * (log, view, permissions) works as usual; to invite someone you pick a network.
   */
  offline?: boolean
}

const hex = (b: Uint8Array) => b4a.toString(b, 'hex') as string
const buf = (h: string) => b4a.from(h, 'hex')

/**
 * Legge i dati di una richiesta d'ingresso (scritti dal candidato): chiave del feed in esadecimale
 * (64 cifre) e nome da 1 a 100 caratteri, come vuole l'evento member.add. Null se non tornano.
 *
 * EN: Reads the data of a join request (written by the candidate): the feed key in hex (64 digits)
 * and a name of 1 to 100 characters, as the member.add event requires. Null if they don't match.
 */
export function parseJoinRequest (data: Uint8Array | null | undefined): { key: string, name: string } | null {
  if (!data) return null
  let v: unknown
  try { v = JSON.parse(b4a.toString(data)) } catch { return null }
  if (!v || typeof v !== 'object') return null
  const { key, name } = v as Record<string, unknown>
  if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) return null
  if (typeof name !== 'string' || name.length < 1 || name.length > 100) return null
  return { key, name }
}

/** Validità di un invito. / EN: How long an invite is valid. */
const INVITE_TTL_MS = 24 * 60 * 60 * 1000
/** Ogni quanto rinfrescare la discovery quando non abbiamo nessun peer. / EN: How often to refresh discovery when we have no peers. */
const REFRESH_ISOLATED_MS = 5_000
/** Ogni quanto rinfrescarla comunque (per scoprire peer nuovi anche se ne abbiamo già). / EN: How often to refresh it anyway (to find new peers even if we already have some). */
const REFRESH_NORMAL_MS = 60_000
/** Ogni quanto si riprova se il relay del server del team risponde (B8). / EN: How often to check again whether the team server's relay answers (B8). */
const RELAY_PROBE_MS = 10 * 60_000

/**
 * Un nodo connesso a un team. Ciclo di vita: `create` | `open` | `join` → uso → `close`.
 *
 * EN: A node connected to a team. Lifecycle: `create` | `open` | `join` → use → `close`.
 *
 * Eventi emessi:
 * - `update`: la vista è cambiata (nuovi blocchi applicati);
 * - `peers` (n): il numero di connessioni è cambiato;
 * - `connection` (conn): nuova connessione P2P cifrata, per protocolli aggiuntivi.
 *
 * EN: Emitted events:
 * - `update`: the view changed (new blocks applied);
 * - `peers` (n): the number of connections changed;
 * - `connection` (conn): new encrypted P2P connection, for additional protocols.
 */
export class TeamNode extends EventEmitter {
  private store: any
  private swarm: any = null
  private wakeup: any = null
  private pairing: any = null
  /** Registrazione come "membro" di blind-pairing: risponde alle richieste d'ingresso. / EN: Registration as a blind-pairing "member": answers join requests. */
  private member: any = null
  private discovery: any = null
  private refreshTimer: NodeJS.Timeout | null = null
  /** Prova periodica del relay del server del team (B8). / EN: Periodic probe of the team server's relay (B8). */
  private relayTimer: NodeJS.Timeout | null = null
  /** Il relay del server risponde? null = mai provato (o DHT pubblica). / EN: Does the server relay answer? null = never probed (or public DHT). */
  private relayReachable: boolean | null = null
  private base: any = null
  private readonly log: (msg: string) => void

  constructor (private readonly opts: TeamNodeOptions) {
    super()
    this.log = opts.log ?? (() => {})
    this.store = new Corestore(opts.storeDir)
  }

  // ═══════════════════════════════ Ciclo di vita ═══════════════════════════════
  // EN: Lifecycle

  /**
   * Crea un nuovo team. Questo nodo diventa il primo writer, quindi fondatore, admin e indexer.
   *
   * EN: Creates a new team. This node becomes the first writer, hence founder, admin and indexer.
   * @param teamName nome leggibile del team
   *        EN: human-readable team name
   * @param nodeName nome di questo nodo
   *        EN: name of this node
   * @returns le chiavi del team, da salvare in state.json
   *          EN: the team keys, to save in state.json
   */
  async create (teamName: string, nodeName: string): Promise<TeamSecrets> {
    // La chiave di cifratura nasce qui e lascerà questo nodo solo via pairing cifrato.
    // EN: The encryption key is born here and will leave this node only via encrypted pairing.
    const encryptionKey = crypto.randomBytes(32)
    await this.startNetwork()
    // bootstrap = null: Autobase crea una base nuova il cui primo writer è il nostro feed locale.
    // EN: bootstrap = null: Autobase creates a new base whose first writer is our local feed.
    await this.openBase(null, encryptionKey)
    await this.append({ type: 'team.init', name: teamName, founderName: nodeName })
    await this.base.update()
    return this.secrets()
  }

  /** Riapre un team già configurato (avvio del daemon). / EN: Reopens an already configured team (daemon startup). */
  async open (secrets: TeamSecrets): Promise<void> {
    await this.startNetwork()
    await this.openBase(buf(secrets.baseKey), buf(secrets.encryptionKey))
  }

  /**
   * Entra in un team con un codice d'invito (decisione D2).
   *
   * EN: Joins a team with an invite code (decision D2).
   *
   * Sequenza:
   * 1. calcoliamo la chiave del NOSTRO futuro feed (serve al membro per aggiungerci come writer);
   * 2. ci presentiamo come "candidato" blind-pairing: la richiesta viaggia cifrata con il
   *    segreto dell'invito, quindi solo chi conosce l'invito (i membri) può leggerla;
   * 3. un membro online qualsiasi verifica l'invito, pubblica `member.add` e ci "conferma"
   *    consegnandoci chiave dell'Autobase e chiave di cifratura;
   * 4. apriamo la base e aspettiamo che il nostro permesso di scrittura sia replicato.
   *
   * EN: Sequence:
   * 1. we compute the key of OUR future feed (the member needs it to add us as a writer);
   * 2. we present ourselves as a blind-pairing "candidate": the request travels encrypted with
   *    the invite secret, so only those who know the invite (the members) can read it;
   * 3. any online member checks the invite, publishes `member.add` and "confirms" us by
   *    handing over the Autobase key and the encryption key;
   * 4. we open the base and wait until our write permission is replicated.
   *
   * @param inviteCode codice z32 prodotto da `createInvite`
   *        EN: z32 code produced by `createInvite`
   * @param nodeName   nome di questo nodo, visibile agli altri
   *        EN: name of this node, visible to the others
   * @param timeoutMs  quanto aspettare un membro online prima di arrendersi
   *        EN: how long to wait for an online member before giving up
   */
  async join (inviteCode: string, nodeName: string, timeoutMs = 120_000): Promise<TeamSecrets> {
    if (this.opts.offline) throw new Error('Per entrare in un team serve la rete: la modalità solo locale non si collega a nessuno')
    await this.startNetwork()
    await this.store.ready()
    // Il "local core" è il feed su cui scriveremo. Ne apriamo solo la chiave e lo richiudiamo:
    // Autobase lo riaprirà quando creeremo la base.
    // EN: The "local core" is the feed we will write to. We only open it for its key and close it:
    //     Autobase will reopen it when we create the base.
    const local = Autobase.getLocalCore(this.store)
    await local.ready()
    const writerKey = hex(local.key)
    await local.close()

    const result: any = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        candidate.close().catch(() => {})
        reject(new Error('Nessun membro del team ha risposto all\'invito (serve almeno un membro online). Riprova più tardi.'))
      }, timeoutMs)
      const candidate = this.pairing.addCandidate({
        invite: z32.decode(inviteCode.trim()),
        // userData arriva al membro che accoglie: gli diciamo chi siamo e quale feed aggiungere.
        // EN: userData reaches the welcoming member: we tell it who we are and which feed to add.
        userData: b4a.from(JSON.stringify({ key: writerKey, name: nodeName })),
        onadd: (res: any) => {
          clearTimeout(timer)
          candidate.close().catch(() => {})
          resolve(res) // res.key = chiave Autobase, res.encryptionKey = chiave di cifratura / EN: res.key = Autobase key, res.encryptionKey = encryption key
        }
      })
    })

    await this.openBase(result.key, result.encryptionKey)
    await this.waitWritable(timeoutMs)
    return this.secrets()
  }

  /** Chiude tutto in ordine inverso di apertura. Gli errori di chiusura sono ignorati. / EN: Closes everything in reverse opening order. Close errors are ignored. */
  async close (): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    if (this.relayTimer) clearInterval(this.relayTimer)
    if (this.member) await this.member.close().catch(() => {})
    if (this.pairing) await this.pairing.close().catch(() => {})
    if (this.swarm) await this.swarm.destroy().catch(() => {})
    if (this.base) await this.base.close().catch(() => {})
    await this.store.close().catch(() => {})
  }

  // ═══════════════════════════════════ Rete ════════════════════════════════════
  // EN: Network

  /**
   * Avvia Hyperswarm e il protocollo di pairing. Idempotente.
   * Separato da `openBase` perché durante `join` la rete serve PRIMA che la base esista.
   *
   * EN: Starts Hyperswarm and the pairing protocol. Idempotent.
   * Kept apart from `openBase` because during `join` the network is needed BEFORE the base exists.
   */
  private async startNetwork (): Promise<void> {
    if (this.swarm || this.wakeup) return
    await this.store.ready()
    this.wakeup = new Wakeup()
    // Solo locale: niente swarm né pairing (vedi TeamNodeOptions.offline)
    // EN: Local only: no swarm and no pairing (see TeamNodeOptions.offline)
    if (this.opts.offline) {
      this.log('modalità solo locale: nessuna connessione di rete')
      return
    }
    // B8: con la DHT privata, il relay del server del team come piano B quando l'hole punching
    // fallisce (o il nostro NAT è simmetrico). Hyperswarm chiama la funzione a ogni connessione:
    // `force` = un tentativo diretto con quel peer è già fallito.
    // EN: B8: with the private DHT, the team server's relay is the fallback when hole punching
    //     fails (or our NAT is symmetric). Hyperswarm calls the function on every connection:
    //     `force` = a direct attempt with that peer has already failed.
    const relay = this.opts.bootstrap?.length ? relayKeyFor(this.opts.bootstrap[0].host, this.opts.bootstrap[0].port) : null
    this.swarm = new Hyperswarm({
      // Chiave stabile del nodo sulla DHT, conservata nel Corestore.
      // EN: Stable node key on the DHT, kept in the Corestore.
      keyPair: await this.store.createKeyPair('hyperswarm'),
      ...(this.opts.bootstrap?.length ? { bootstrap: this.opts.bootstrap } : {}),
      ...(relay ? { relayThrough: (force: boolean, swarm: any) => ((force || swarm.dht.randomized) && this.relayReachable ? relay : null) } : {})
    })
    if (relay) this.watchRelay(relay)
    this.swarm.on('connection', (conn: any, info: any) => {
      // Un errore su una singola connessione (peer che cade) non deve far crashare il nodo.
      // EN: An error on a single connection (a peer dropping) must not crash the node.
      conn.on('error', () => {})
      this.log(`peer connesso ${hex(info.publicKey).slice(0, 8)}`)
      // Replica di tutti i core del Corestore su questa connessione…
      // EN: Replicate all the Corestore cores on this connection…
      this.store.replicate(conn)
      // …più il protocollo wakeup. Insieme equivalgono a `base.replicate(conn)` (lezione dello
      // spike A), ma funzionano anche per le connessioni aperte prima che la base esista.
      // EN: …plus the wakeup protocol. Together they are equivalent to `base.replicate(conn)`
      //     (lesson from spike A), but they also work for connections opened before the base exists.
      this.wakeup.addStream(conn)
      this.emit('peers', this.swarm.connections.size)
      // Altri protocolli (es. il download dei documenti, src/net/file-share.ts) si agganciano qui.
      // EN: Other protocols (e.g. document download, src/net/file-share.ts) attach here.
      this.emit('connection', conn)
      conn.once('close', () => this.emit('peers', this.swarm?.connections.size ?? 0))
    })
    // BlindPairing si aggancia da solo alle connessioni dello swarm.
    // EN: BlindPairing attaches itself to the swarm connections.
    this.pairing = new BlindPairing(this.swarm)
  }

  /**
   * Apre l'Autobase del team, si annuncia sulla DHT e si registra come "membro" di pairing.
   *
   * EN: Opens the team Autobase, announces itself on the DHT and registers as a pairing "member".
   * @param key           chiave dell'Autobase; null per crearne una nuova
   *        EN: Autobase key; null to create a new one
   * @param encryptionKey chiave di cifratura dei blocchi
   *        EN: block encryption key
   */
  private async openBase (key: Uint8Array | null, encryptionKey: Uint8Array): Promise<void> {
    this.base = new Autobase(this.store, key, {
      open: openView,
      apply: applyNodes,
      valueEncoding: 'json',
      // Ack automatici: aiutano l'ordinamento a convergere quando ci sono fork causali.
      // EN: Automatic acks: they help ordering converge when there are causal forks.
      ackInterval: 1000,
      encryptionKey,
      // Lo stesso protocollo wakeup agganciato alle connessioni in startNetwork.
      // EN: The same wakeup protocol attached to the connections in startNetwork.
      wakeup: this.wakeup
    })
    this.base.on('update', () => this.emit('update'))
    this.base.on('error', (err: Error) => this.log(`errore autobase: ${err.message}`))
    await this.base.ready()
    // Solo locale: nessun annuncio sulla DHT e nessuna risposta alle richieste d'ingresso
    // EN: Local only: no DHT announcement and no answer to join requests
    if (!this.swarm) return

    // Il topic DHT è la discoveryKey della base: un hash della chiave, che non la rivela.
    // EN: The DHT topic is the base discoveryKey: a hash of the key that does not reveal it.
    this.discovery = this.swarm.join(this.base.discoveryKey, { server: true, client: true })
    await this.discovery.flushed()
    this.log(`annunciato sul topic del team ${hex(this.base.discoveryKey).slice(0, 8)}`)

    // Refresh della discovery: frequente se isolati, raro altrimenti (spike A).
    // EN: Discovery refresh: frequent when isolated, rare otherwise (spike A).
    let lastRefresh = Date.now()
    this.refreshTimer = setInterval(() => {
      const isolated = this.swarm.connections.size === 0
      if (Date.now() - lastRefresh >= (isolated ? REFRESH_ISOLATED_MS : REFRESH_NORMAL_MS)) {
        lastRefresh = Date.now()
        this.discovery.refresh({ client: true, server: true }).catch(() => {})
      }
    }, REFRESH_ISOLATED_MS)
    this.refreshTimer.unref() // il timer non deve tenere vivo il processo da solo / EN: the timer alone must not keep the process alive

    // OGNI membro risponde alle richieste d'ingresso: chi ha invitato può essere offline.
    // EN: EVERY member answers join requests: whoever sent the invite may be offline.
    this.member = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: (candidate: any) => this.onCandidate(candidate)
    })
  }

  /**
   * Gestisce una richiesta d'ingresso arrivata via blind-pairing.
   * Se l'invito non è valido NON rispondiamo affatto: il candidato andrà in timeout, senza
   * ricevere informazioni su perché è stato rifiutato.
   *
   * EN: Handles a join request received via blind-pairing.
   * If the invite is not valid we do NOT answer at all: the candidate will time out without
   * learning why it was rejected.
   */
  private async onCandidate (candidate: any): Promise<void> {
    // Un nodo non (più) writer non può pubblicare member.add: lasciamo rispondere gli altri.
    // EN: A node that is not (or no longer) a writer cannot publish member.add: let the others answer.
    if (!this.base.writable) return
    const inviteId = hex(candidate.inviteId)
    const inv = await this.getRecord<InviteRecord>(KEYS.invite(inviteId))
    // L'invito deve essere nella nostra vista: se chi l'ha creato è andato offline prima di
    // replicarlo a noi, non possiamo verificarlo (vedi createInvite → `replicated`).
    // EN: The invite must be in our view: if its creator went offline before replicating it
    //     to us, we cannot verify it (see createInvite → `replicated`).
    if (!inv) return
    // La scadenza si controlla QUI e non in apply: qui possiamo usare l'orologio locale.
    // EN: Expiry is checked HERE and not in apply: here we can use the local clock.
    if (inv.expires && inv.expires < Date.now()) {
      this.log(`invito ${inviteId.slice(0, 8)} scaduto: rifiutato`)
      return
    }
    // "open" decifra la richiesta con la chiave pubblica dell'invito e ne verifica la firma.
    // EN: "open" decrypts the request with the invite public key and verifies its signature.
    candidate.open(buf(inv.publicKey))
    // I dati della richiesta li scrive chi chiede di entrare: si validano. Un JSON rotto faceva
    // cadere il daemon (l'errore usciva dal gestore di blind-pairing).
    // EN: The request data is written by whoever asks to join: it gets validated. Broken JSON used
    //     to crash the daemon (the error escaped blind-pairing's handler).
    const req = parseJoinRequest(candidate.userData)
    if (!req) {
      this.log(`richiesta d'ingresso con l'invito ${inviteId.slice(0, 8)} malformata: ignorata`)
      return
    }
    const { key, name } = req
    // Una chiave che è già di un membro (anche espulso) non entra: apply scarterebbe il
    // member.add, ma prima di questo controllo le chiavi del team venivano consegnate lo stesso.
    // EN: A key that already belongs to a member (even a removed one) doesn't get in: apply would
    //     drop the member.add, but before this check the team keys were handed over anyway.
    if (await this.getRecord<MemberRecord>(KEYS.member(key))) {
      this.log(`richiesta d'ingresso da "${name}" con una chiave già presente nel team: rifiutata`)
      return
    }
    this.log(`richiesta d'ingresso valida da "${name}": aggiungo il writer`)
    await this.append({ type: 'member.add', key, name, inviteId })
    // Le chiavi si consegnano solo se il member.add è stato davvero accettato nella nostra vista
    // (invito consumato e membro presente). Revisione di sicurezza 2026-10-26: prima si
    // consegnavano comunque, e un ingresso scartato diventava un lettore invisibile.
    // EN: Keys are handed over only if the member.add was really accepted in our view (invite
    //     consumed and member present). Security review 2026-10-26: before, they were handed over
    //     anyway, and a rejected join became an invisible reader.
    await this.base.update()
    const added = await this.getRecord<MemberRecord>(KEYS.member(key))
    const consumed = !(await this.getRecord<InviteRecord>(KEYS.invite(inviteId)))
    if (!added || added.removed || !consumed) {
      this.log(`ingresso di "${name}" non accettato dal team: chiavi non consegnate`)
      return
    }
    // Consegna delle chiavi sul canale cifrato del pairing.
    // EN: Hand over the keys on the encrypted pairing channel.
    candidate.confirm({ key: this.base.key, encryptionKey: this.base.encryptionKey })
  }

  /** Attende che questo nodo diventi writer (il member.add che ci riguarda è replicato). / EN: Waits until this node becomes a writer (the member.add about us has been replicated). */
  private async waitWritable (timeoutMs: number): Promise<void> {
    if (this.base.writable) return
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Ingresso accettato ma permesso di scrittura non ancora replicato')), timeoutMs)
      const check = () => {
        if (!this.base.writable) return
        clearTimeout(timer)
        this.base.off('update', check)
        resolve()
      }
      this.base.on('update', check)
      check()
    })
  }

  // ═════════════════════════════════ Operazioni ════════════════════════════════
  // EN: Operations

  /**
   * Appende un evento al feed locale (verrà replicato a tutti).
   *
   * EN: Appends an event to the local feed (it will be replicated to everyone).
   * @throws se il nodo non è writer (non ancora accettato, o espulso)
   *         EN: if the node is not a writer (not yet accepted, or removed)
   */
  /**
   * @param ts istante dell'evento, se deve essere noto prima (es. una firma che lo include, B12)
   *        EN: time of the event, if it must be known in advance (e.g. a signature covering it, B12)
   */
  async append (payload: EventPayload, ts?: number): Promise<void> {
    if (!this.base?.writable) throw new Error('Questo nodo non è (ancora) un writer del team')
    await this.base.append(envelope(payload, ts))
  }

  /**
   * Appende più eventi in UNA scrittura (Autobase accetta un array): per il ripristino di un
   * backup, dove migliaia di scritture singole costerebbero minuti. Ogni evento è validato prima:
   * se uno non è valido non si scrive nulla.
   *
   * EN: Appends several events in ONE write (Autobase accepts an array): for restoring a backup,
   * where thousands of single writes would take minutes. Every event is validated first:
   * if one is invalid nothing is written.
   */
  async appendMany (payloads: EventPayload[]): Promise<void> {
    if (!this.base?.writable) throw new Error('Questo nodo non è (ancora) un writer del team')
    if (!payloads.length) return
    const now = Date.now()
    await this.base.append(payloads.map((p) => envelope(p, now)))
  }

  /**
   * Crea un invito monouso valido 24 ore.
   *
   * EN: Creates a single-use invite valid for 24 hours.
   *
   * `replicated` indica se almeno un peer ha già ricevuto l'evento `invite.add`. Solo in quel
   * caso un ALTRO membro può accogliere il nuovo arrivato se questo nodo va offline.
   *
   * EN: `replicated` tells whether at least one peer has already received the `invite.add` event.
   * Only then can ANOTHER member welcome the newcomer if this node goes offline.
   *
   * @param waitMs quanto attendere al massimo la replica dell'invito
   *        EN: maximum time to wait for the invite to replicate
   */
  async createInvite (waitMs = 10_000): Promise<{ code: string, expires: number, replicated: boolean }> {
    const expires = Date.now() + INVITE_TTL_MS
    const { id, invite, publicKey } = BlindPairing.createInvite(this.base.key, { expires })
    await this.append({ type: 'invite.add', id: hex(id), publicKey: hex(publicKey), expires })
    if (this.member) await this.member.flushed()
    const replicated = await this.waitLocalReplicated(waitMs)
    // Il codice contiene il seed dell'invito (segreto) e la discoveryKey: NON la chiave di cifratura.
    // EN: The code contains the invite seed (secret) and the discoveryKey: NOT the encryption key.
    return { code: z32.encode(invite), expires, replicated }
  }

  /**
   * Attende che almeno un peer abbia scaricato tutto il nostro feed locale (best-effort).
   * Usa `remoteContiguousLength`: quanti blocchi contigui il peer dichiara di avere.
   *
   * EN: Waits until at least one peer has downloaded our whole local feed (best-effort).
   * Uses `remoteContiguousLength`: how many contiguous blocks the peer claims to have.
   */
  private async waitLocalReplicated (timeoutMs: number): Promise<boolean> {
    const local = this.base.local
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
      if (local.peers.some((p: any) => p.remoteContiguousLength >= local.length)) return true
      await new Promise((r) => setTimeout(r, 200))
    }
    return false
  }

  /** Forza Autobase a scaricare e applicare ciò che è disponibile dai peer. / EN: Forces Autobase to download and apply whatever is available from peers. */
  async update (): Promise<void> {
    await this.base.update()
  }

  // ═════════════════════════════ Letture dalla vista ═══════════════════════════
  // EN: Reads from the view

  /** true quando la base è aperta (dopo create/open/join). / EN: true when the base is open (after create/open/join). */
  get ready (): boolean { return this.base !== null }
  /** Versione della vista (cresce a ogni modifica): serve a non ricalcolare ciò che non è cambiato. / EN: View version (grows on every change): used to avoid recomputing what did not change. */
  get viewVersion (): number { return this.base?.view?.version ?? 0 }
  get writable (): boolean { return !!this.base?.writable }
  get isIndexer (): boolean { return !!this.base?.isIndexer }
  /** Chiave del feed locale (hex): è l'identità di questo nodo nel team. / EN: Local feed key (hex): the identity of this node in the team. */
  get localKey (): string | null { return this.base ? hex(this.base.local.key) : null }
  get peers (): number { return this.swarm?.connections.size ?? 0 }

  /**
   * Relay del server del team (B8): raggiungibile o no (null = DHT pubblica o non ancora provato),
   * e quante connessioni sono passate da lì. Per lo stato del nodo e `micelio network check`.
   *
   * EN: Team server relay (B8): reachable or not (null = public DHT or not probed yet),
   * and how many connections went through it. For the node status and `micelio network check`.
   */
  get relay (): { reachable: boolean | null, attempts: number, successes: number } {
    const r = this.swarm?.dht?.stats?.relaying
    return { reachable: this.relayReachable, attempts: r?.attempts ?? 0, successes: r?.successes ?? 0 }
  }

  /**
   * Il relay si usa SOLO se risponde. Hyperswarm, deciso il relay per un peer, continua a usarlo:
   * con un server senza relay (versione precedente a B8) un solo hole punching fallito lascerebbe
   * quei due PC scollegati per sempre. Si prova all'avvio e poi ogni RELAY_PROBE_MS.
   *
   * EN: The relay is used ONLY if it answers. Once Hyperswarm picks the relay for a peer, it keeps
   * using it: with a server without relay (version before B8) a single failed hole punch would
   * leave those two PCs disconnected forever. We probe at startup and then every RELAY_PROBE_MS.
   */
  private watchRelay (key: Buffer): void {
    const probe = () => {
      const swarm = this.swarm
      if (!swarm) return
      const socket = swarm.dht.connect(key)
      const timer = setTimeout(() => { socket.destroy() }, 15_000)
      socket.once('open', () => {
        if (this.relayReachable !== true) this.log('relay del server del team raggiungibile: piano B attivo se l\'hole punching non riesce')
        this.relayReachable = true
        clearTimeout(timer)
        socket.destroy()
      })
      socket.once('error', () => {
        if (this.relayReachable !== false) this.log('il server del team non offre un relay (versione precedente o non raggiungibile): solo connessioni dirette')
        this.relayReachable = false
        clearTimeout(timer)
      })
    }
    probe()
    this.relayTimer = setInterval(probe, RELAY_PROBE_MS)
    this.relayTimer.unref()
  }

  /**
   * Coppia di chiavi del feed locale: la pubblica è l'identità del nodo nel team, la segreta
   * serve a firmare (es. le richieste di documenti). null se la base non è aperta.
   *
   * EN: Key pair of the local feed: the public key is the node identity in the team, the secret
   * key is used for signing (e.g. document requests). null if the base is not open.
   */
  get localKeyPair (): { memberKey: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array } | null {
    const kp = this.base?.local?.keyPair
    // memberKey = chiave del feed (identità nel team); publicKey/secretKey = coppia di firma.
    // EN: memberKey = feed key (identity in the team); publicKey/secretKey = signing pair.
    return kp?.secretKey ? { memberKey: this.base.local.key, publicKey: kp.publicKey, secretKey: kp.secretKey } : null
  }

  /**
   * Chiave pubblica di FIRMA (hex) del feed di un membro, letta dal manifest del suo core.
   *
   * EN: Public SIGNING key (hex) of a member's feed, read from the manifest of its core.
   *
   * In Hypercore 11 la chiave di un feed (quella con cui un membro è registrato nel team) è
   * l'hash del suo manifest, NON la chiave che firma. Per verificare una firma "a nome di" un
   * membro bisogna quindi risalire alla chiave di firma dal manifest (che abbiamo, perché
   * replichiamo i feed di tutti i membri). null se il feed non è (ancora) disponibile.
   *
   * EN: In Hypercore 11 the key of a feed (the one a member is registered with in the team) is
   * the hash of its manifest, NOT the signing key. To verify a signature "on behalf of" a member
   * we must therefore get the signing key from the manifest (which we have, because we replicate
   * the feeds of all members). null if the feed is not available (yet).
   */
  async signerOf (writerKeyHex: string): Promise<string | null> {
    const core = this.store.get({ key: buf(writerKeyHex) })
    try {
      await core.ready()
      const pk = core.manifest?.signers?.[0]?.publicKey
      return pk ? hex(pk) : null
    } finally {
      await core.close().catch(() => {})
    }
  }

  /**
   * Dimensione del feed di ciascun membro: è lo spazio che i SUOI eventi (ricordi, voti, uso,
   * sogni…) occupano nel log del team, quindi su OGNI nodo, perché ogni nodo replica tutto.
   * `byteLength` è la lunghezza del feed nota a questo nodo (cifrata, senza indici locali).
   *
   * EN: Feed size of each member: the space that THEIR events (memories, votes, usage,
   * dreams…) take in the team log, hence on EVERY node, because every node replicates everything.
   * `byteLength` is the feed length known to this node (encrypted, without local indexes).
   * @param writerKeys chiavi (hex) dei feed dei membri
   *        EN: keys (hex) of the members' feeds
   * @returns chiave → { bytes, blocks }; 0 per un feed non (ancora) disponibile
   *          EN: key → { bytes, blocks }; 0 for a feed not available (yet)
   */
  async feedSizes (writerKeys: string[]): Promise<Record<string, { bytes: number, blocks: number }>> {
    const out: Record<string, { bytes: number, blocks: number }> = {}
    for (const k of writerKeys) {
      const core = this.store.get({ key: buf(k) })
      try {
        await core.ready()
        out[k] = { bytes: core.byteLength ?? 0, blocks: core.length ?? 0 }
      } catch {
        out[k] = { bytes: 0, blocks: 0 }
      } finally {
        await core.close().catch(() => {})
      }
    }
    return out
  }

  /** Connessioni P2P aperte in questo momento (per agganciare protocolli a quelle già esistenti). / EN: P2P connections open right now (to attach protocols to the existing ones). */
  get connections (): any[] { return this.swarm ? [...this.swarm.connections] : [] }

  /** Chiavi del team, da salvare in state.json. / EN: Team keys, to save in state.json. */
  secrets (): TeamSecrets {
    return { baseKey: hex(this.base.key), encryptionKey: hex(this.base.encryptionKey) }
  }

  /** Legge un record qualsiasi della vista; null se assente. / EN: Reads any record from the view; null if missing. */
  async getRecord<T> (key: string): Promise<T | null> {
    const node = await this.base.view.get(key)
    return node ? node.value as T : null
  }

  /** Valore di una configurazione di team (`team.config`), o undefined se non impostata. / EN: Value of a team setting (`team.config`), or undefined if not set. */
  async config<T = unknown> (key: string): Promise<T | undefined> {
    const rec = await this.getRecord<{ value: T }>(KEYS.config(key))
    return rec?.value
  }

  /** Tutta la configurazione condivisa del team (`team.config`): chiave → valore. / EN: The whole shared team configuration (`team.config`): key → value. */
  async configs (): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {}
    for await (const { key, value } of this.base.view.createReadStream(RANGES.configs)) out[String(key).slice('config/'.length)] = (value as { value: unknown }).value
    return out
  }

  async team (): Promise<TeamRecord | null> {
    return this.getRecord<TeamRecord>(KEYS.team)
  }

  /** Tutti i membri, compresi gli espulsi (`removed: true`). / EN: All members, including removed ones (`removed: true`). */
  async members (): Promise<MemberRecord[]> {
    return this.scan<MemberRecord>(RANGES.members)
  }

  async memories (): Promise<MemoryRecord[]> {
    return this.scan<MemoryRecord>(RANGES.memories)
  }

  /** Collegamenti espliciti creati dal dreaming. / EN: Explicit links created by dreaming. */
  async links (): Promise<{ from: string, to: string, rel: string }[]> {
    const out: { from: string, to: string, rel: string }[] = []
    for await (const { key, value } of this.base.view.createReadStream(RANGES.links)) {
      const [, from, to] = String(key).split('/')
      out.push({ from, to, rel: (value as { rel: string }).rel })
    }
    return out
  }

  /** Chi ha vinto il sogno di un'epoca (chiave del nodo), o null. / EN: Who won the dream of an epoch (node key), or null. */
  async dreamClaim (epoch: string): Promise<string | null> {
    return (await this.getRecord<{ by: string }>(KEYS.dreamClaim(epoch)))?.by ?? null
  }

  /** Diario dei sogni, dal più recente. / EN: Dream log, newest first. */
  async dreamLogs (): Promise<{ epoch: string, by: string, ts: number, summary: string, stats: Record<string, number> }[]> {
    const out: any[] = []
    for await (const { value } of this.base.view.createReadStream(RANGES.dreamLogs)) out.push(value)
    return out.sort((a, b) => b.ts - a.ts)
  }

  /** Voti per ricordo: somma dei voti di tutti i nodi. / EN: Votes per memory: sum of the votes of all nodes. */
  async votes (): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    for await (const { key, value } of this.base.view.createReadStream(RANGES.votes)) {
      const id = String(key).split('/')[1]
      out.set(id, (out.get(id) ?? 0) + (value as { delta: number }).delta)
    }
    return out
  }

  /** Ricordi fissati (id). / EN: Pinned memories (ids). */
  async pins (): Promise<Set<string>> {
    const out = new Set<string>()
    for await (const { key } of this.base.view.createReadStream(RANGES.pins)) out.add(String(key).split('/')[1])
    return out
  }

  /** Radici (Fase 8): id del ricordo → record (categoria, stato di revisione, segnalazioni). / EN: Roots (Phase 8): memory id → record (category, review status, reports). */
  async roots (): Promise<Map<string, RootRecord>> {
    const out = new Map<string, RootRecord>()
    for await (const { value } of this.base.view.createReadStream(RANGES.roots)) out.set((value as RootRecord).id, value as RootRecord)
    return out
  }

  /** Uso per ricordo, sommato su tutti i nodi: totale e ultimo utilizzo. / EN: Usage per memory, summed over all nodes: total and last use. */
  async usage (): Promise<Map<string, { count: number, last: number }>> {
    const out = new Map<string, { count: number, last: number }>()
    for await (const { key, value } of this.base.view.createReadStream(RANGES.usage)) {
      const id = String(key).split('/')[1]
      const v = value as { count: number, last: number }
      const prev = out.get(id) ?? { count: 0, last: 0 }
      out.set(id, { count: prev.count + v.count, last: Math.max(prev.last, v.last) })
    }
    return out
  }

  /**
   * Sinapsi d'uso (B12): per coppia "idA:idB", sessioni in cui sono serviti insieme (somma su tutti
   * i nodi) e ultima volta.
   *
   * EN: Use synapses (B12): per pair "idA:idB", sessions in which they helped together (sum over all
   * nodes) and the last time.
   */
  async coUse (): Promise<Map<string, { count: number, last: number }>> {
    const out = new Map<string, { count: number, last: number }>()
    for await (const { key, value } of this.base.view.createReadStream(RANGES.couse)) {
      const pair = String(key).split('/')[1]
      const v = value as { count: number, last: number }
      const prev = out.get(pair) ?? { count: 0, last: 0 }
      out.set(pair, { count: prev.count + v.count, last: Math.max(prev.last, v.last) })
    }
    return out
  }

  /** Conferme di redazione (B12): per ricordo, per nodo. / EN: Redaction confirmations (B12): per memory, per node. */
  async redactAcks (): Promise<Map<string, Map<string, RedactAck>>> {
    const out = new Map<string, Map<string, RedactAck>>()
    for await (const { key, value } of this.base.view.createReadStream(RANGES.redactAcks)) {
      const [, id, node] = String(key).split('/')
      if (!out.has(id)) out.set(id, new Map())
      out.get(id)!.set(node, value as RedactAck)
    }
    return out
  }

  /** Volte in cui ogni ricordo è stato utile a un agente, sommate su tutti i nodi (B11). / EN: Times each memory was useful to an agent, summed over all nodes (B11). */
  async useful (): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    for await (const { key, value } of this.base.view.createReadStream(RANGES.useful)) {
      const id = String(key).split('/')[1]
      out.set(id, (out.get(id) ?? 0) + (value as { count: number }).count)
    }
    return out
  }

  /** Il voto di QUESTO nodo su un ricordo (-1, 1), o null se non ha votato. / EN: THIS node's vote on a memory (-1, 1), or null if it has not voted. */
  async myVote (id: string): Promise<number | null> {
    if (!this.localKey) return null
    return (await this.getRecord<{ delta: number }>(KEYS.vote(id, this.localKey)))?.delta ?? null
  }

  /** Lacune di conoscenza segnalate al team (B4). / EN: Knowledge gaps reported to the team (B4). */
  async gaps (): Promise<GapRecord[]> {
    return this.scan<GapRecord>(RANGES.gaps)
  }

  /** Inviti non ancora usati né annullati. / EN: Invites not yet used or revoked. */
  async invites (): Promise<InviteRecord[]> {
    return this.scan<InviteRecord>(RANGES.invites)
  }

  /** Scorre un range di chiavi della vista. / EN: Scans a key range of the view. */
  private async scan<T> (range: { gt: string, lt: string }): Promise<T[]> {
    const out: T[] = []
    for await (const { value } of this.base.view.createReadStream(range)) out.push(value as T)
    return out
  }
}
