/**
 * @file Nodo di rete di un team: l'UNICO modulo che parla con le librerie Holepunch.
 *
 * Mette insieme tre pezzi:
 * - **Autobase**: log multi-writer. Ogni membro scrive sul proprio feed; Autobase li ordina e
 *   calcola la vista tramite `applyNodes` (src/net/apply.ts).
 * - **Hyperswarm**: trova gli altri membri su internet tramite una DHT (nessun server) e apre
 *   connessioni cifrate (Noise) attraverso i NAT.
 * - **blind-pairing**: protocollo d'ingresso. Il nuovo nodo presenta un codice d'invito, un
 *   membro online lo verifica e gli consegna, su canale cifrato, le chiavi del team (D2).
 *
 * Lezioni dallo spike A (DESIGN §5) applicate qui:
 * - la replica deve agganciare anche il protocollo "wakeup", che segnala i core dei writer
 *   attivi; senza, i nuovi membri non vengono mai scoperti;
 * - Hyperswarm rifà la ricerca dei peer di rado: va rinfrescata spesso quando si è isolati.
 *
 * Il resto del codice usa solo i metodi tipizzati di questa classe: le librerie Holepunch non
 * hanno tipi TypeScript (sono `any`, vedi src/types/holepunch.d.ts) e la loro API evolve.
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
import type { InviteRecord, MemberRecord, MemoryRecord, TeamRecord } from '../core/model'
import { KEYS, RANGES, applyNodes, openView } from './apply'

/**
 * Le due chiavi che identificano un team. Vanno salvate (state.json) e protette:
 * chi ha `encryptionKey` può leggere tutto il sapere del team.
 */
export interface TeamSecrets {
  /** Chiave pubblica dell'Autobase (identifica il team). */
  baseKey: string
  /** Chiave simmetrica con cui sono cifrati i blocchi di tutti i feed. */
  encryptionKey: string
}

export interface TeamNodeOptions {
  /** Cartella del Corestore (i feed replicati). */
  storeDir: string
  /** Nodi bootstrap della DHT (test o rete privata). Vuoto = DHT pubblica di Holepunch. */
  bootstrap?: { host: string, port: number }[]
  /** Funzione di log; di default silenziosa. */
  log?: (msg: string) => void
}

const hex = (b: Uint8Array) => b4a.toString(b, 'hex') as string
const buf = (h: string) => b4a.from(h, 'hex')

/** Validità di un invito. */
const INVITE_TTL_MS = 24 * 60 * 60 * 1000
/** Ogni quanto rinfrescare la discovery quando non abbiamo nessun peer. */
const REFRESH_ISOLATED_MS = 5_000
/** Ogni quanto rinfrescarla comunque (per scoprire peer nuovi anche se ne abbiamo già). */
const REFRESH_NORMAL_MS = 60_000

/**
 * Un nodo connesso a un team. Ciclo di vita: `create` | `open` | `join` → uso → `close`.
 *
 * Eventi emessi:
 * - `update`: la vista è cambiata (nuovi blocchi applicati);
 * - `peers` (n): il numero di connessioni è cambiato;
 * - `connection` (conn): nuova connessione P2P cifrata, per protocolli aggiuntivi.
 */
export class TeamNode extends EventEmitter {
  private store: any
  private swarm: any = null
  private wakeup: any = null
  private pairing: any = null
  /** Registrazione come "membro" di blind-pairing: risponde alle richieste d'ingresso. */
  private member: any = null
  private discovery: any = null
  private refreshTimer: NodeJS.Timeout | null = null
  private base: any = null
  private readonly log: (msg: string) => void

  constructor (private readonly opts: TeamNodeOptions) {
    super()
    this.log = opts.log ?? (() => {})
    this.store = new Corestore(opts.storeDir)
  }

  // ═══════════════════════════════ Ciclo di vita ═══════════════════════════════

  /**
   * Crea un nuovo team. Questo nodo diventa il primo writer, quindi fondatore, admin e indexer.
   * @param teamName nome leggibile del team
   * @param nodeName nome di questo nodo
   * @returns le chiavi del team, da salvare in state.json
   */
  async create (teamName: string, nodeName: string): Promise<TeamSecrets> {
    // La chiave di cifratura nasce qui e lascerà questo nodo solo via pairing cifrato.
    const encryptionKey = crypto.randomBytes(32)
    await this.startNetwork()
    // bootstrap = null: Autobase crea una base nuova il cui primo writer è il nostro feed locale.
    await this.openBase(null, encryptionKey)
    await this.append({ type: 'team.init', name: teamName, founderName: nodeName })
    await this.base.update()
    return this.secrets()
  }

  /** Riapre un team già configurato (avvio del daemon). */
  async open (secrets: TeamSecrets): Promise<void> {
    await this.startNetwork()
    await this.openBase(buf(secrets.baseKey), buf(secrets.encryptionKey))
  }

  /**
   * Entra in un team con un codice d'invito (decisione D2).
   *
   * Sequenza:
   * 1. calcoliamo la chiave del NOSTRO futuro feed (serve al membro per aggiungerci come writer);
   * 2. ci presentiamo come "candidato" blind-pairing: la richiesta viaggia cifrata con il
   *    segreto dell'invito, quindi solo chi conosce l'invito (i membri) può leggerla;
   * 3. un membro online qualsiasi verifica l'invito, pubblica `member.add` e ci "conferma"
   *    consegnandoci chiave dell'Autobase e chiave di cifratura;
   * 4. apriamo la base e aspettiamo che il nostro permesso di scrittura sia replicato.
   *
   * @param inviteCode codice z32 prodotto da `createInvite`
   * @param nodeName   nome di questo nodo, visibile agli altri
   * @param timeoutMs  quanto aspettare un membro online prima di arrendersi
   */
  async join (inviteCode: string, nodeName: string, timeoutMs = 120_000): Promise<TeamSecrets> {
    await this.startNetwork()
    await this.store.ready()
    // Il "local core" è il feed su cui scriveremo. Ne apriamo solo la chiave e lo richiudiamo:
    // Autobase lo riaprirà quando creeremo la base.
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
        userData: b4a.from(JSON.stringify({ key: writerKey, name: nodeName })),
        onadd: (res: any) => {
          clearTimeout(timer)
          candidate.close().catch(() => {})
          resolve(res) // res.key = chiave Autobase, res.encryptionKey = chiave di cifratura
        }
      })
    })

    await this.openBase(result.key, result.encryptionKey)
    await this.waitWritable(timeoutMs)
    return this.secrets()
  }

  /** Chiude tutto in ordine inverso di apertura. Gli errori di chiusura sono ignorati. */
  async close (): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    if (this.member) await this.member.close().catch(() => {})
    if (this.pairing) await this.pairing.close().catch(() => {})
    if (this.swarm) await this.swarm.destroy().catch(() => {})
    if (this.base) await this.base.close().catch(() => {})
    await this.store.close().catch(() => {})
  }

  // ═══════════════════════════════════ Rete ════════════════════════════════════

  /**
   * Avvia Hyperswarm e il protocollo di pairing. Idempotente.
   * Separato da `openBase` perché durante `join` la rete serve PRIMA che la base esista.
   */
  private async startNetwork (): Promise<void> {
    if (this.swarm) return
    await this.store.ready()
    this.wakeup = new Wakeup()
    this.swarm = new Hyperswarm({
      // Chiave stabile del nodo sulla DHT, conservata nel Corestore.
      keyPair: await this.store.createKeyPair('hyperswarm'),
      ...(this.opts.bootstrap?.length ? { bootstrap: this.opts.bootstrap } : {})
    })
    this.swarm.on('connection', (conn: any, info: any) => {
      // Un errore su una singola connessione (peer che cade) non deve far crashare il nodo.
      conn.on('error', () => {})
      this.log(`peer connesso ${hex(info.publicKey).slice(0, 8)}`)
      // Replica di tutti i core del Corestore su questa connessione…
      this.store.replicate(conn)
      // …più il protocollo wakeup. Insieme equivalgono a `base.replicate(conn)` (lezione dello
      // spike A), ma funzionano anche per le connessioni aperte prima che la base esista.
      this.wakeup.addStream(conn)
      this.emit('peers', this.swarm.connections.size)
      // Altri protocolli (es. il download dei documenti, src/net/file-share.ts) si agganciano qui.
      this.emit('connection', conn)
      conn.once('close', () => this.emit('peers', this.swarm?.connections.size ?? 0))
    })
    // BlindPairing si aggancia da solo alle connessioni dello swarm.
    this.pairing = new BlindPairing(this.swarm)
  }

  /**
   * Apre l'Autobase del team, si annuncia sulla DHT e si registra come "membro" di pairing.
   * @param key           chiave dell'Autobase; null per crearne una nuova
   * @param encryptionKey chiave di cifratura dei blocchi
   */
  private async openBase (key: Uint8Array | null, encryptionKey: Uint8Array): Promise<void> {
    this.base = new Autobase(this.store, key, {
      open: openView,
      apply: applyNodes,
      valueEncoding: 'json',
      // Ack automatici: aiutano l'ordinamento a convergere quando ci sono fork causali.
      ackInterval: 1000,
      encryptionKey,
      // Lo stesso protocollo wakeup agganciato alle connessioni in startNetwork.
      wakeup: this.wakeup
    })
    this.base.on('update', () => this.emit('update'))
    this.base.on('error', (err: Error) => this.log(`errore autobase: ${err.message}`))
    await this.base.ready()

    // Il topic DHT è la discoveryKey della base: un hash della chiave, che non la rivela.
    this.discovery = this.swarm.join(this.base.discoveryKey, { server: true, client: true })
    await this.discovery.flushed()
    this.log(`annunciato sul topic del team ${hex(this.base.discoveryKey).slice(0, 8)}`)

    // Refresh della discovery: frequente se isolati, raro altrimenti (spike A).
    let lastRefresh = Date.now()
    this.refreshTimer = setInterval(() => {
      const isolated = this.swarm.connections.size === 0
      if (Date.now() - lastRefresh >= (isolated ? REFRESH_ISOLATED_MS : REFRESH_NORMAL_MS)) {
        lastRefresh = Date.now()
        this.discovery.refresh({ client: true, server: true }).catch(() => {})
      }
    }, REFRESH_ISOLATED_MS)
    this.refreshTimer.unref() // il timer non deve tenere vivo il processo da solo

    // OGNI membro risponde alle richieste d'ingresso: chi ha invitato può essere offline.
    this.member = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: (candidate: any) => this.onCandidate(candidate)
    })
  }

  /**
   * Gestisce una richiesta d'ingresso arrivata via blind-pairing.
   * Se l'invito non è valido NON rispondiamo affatto: il candidato andrà in timeout, senza
   * ricevere informazioni su perché è stato rifiutato.
   */
  private async onCandidate (candidate: any): Promise<void> {
    // Un nodo non (più) writer non può pubblicare member.add: lasciamo rispondere gli altri.
    if (!this.base.writable) return
    const inviteId = hex(candidate.inviteId)
    const inv = await this.getRecord<InviteRecord>(KEYS.invite(inviteId))
    // L'invito deve essere nella nostra vista: se chi l'ha creato è andato offline prima di
    // replicarlo a noi, non possiamo verificarlo (vedi createInvite → `replicated`).
    if (!inv) return
    // La scadenza si controlla QUI e non in apply: qui possiamo usare l'orologio locale.
    if (inv.expires && inv.expires < Date.now()) {
      this.log(`invito ${inviteId.slice(0, 8)} scaduto: rifiutato`)
      return
    }
    // "open" decifra la richiesta con la chiave pubblica dell'invito e ne verifica la firma.
    candidate.open(buf(inv.publicKey))
    const { key, name } = JSON.parse(b4a.toString(candidate.userData))
    this.log(`richiesta d'ingresso valida da "${name}": aggiungo il writer`)
    await this.append({ type: 'member.add', key, name, inviteId })
    // Consegna delle chiavi sul canale cifrato del pairing.
    candidate.confirm({ key: this.base.key, encryptionKey: this.base.encryptionKey })
  }

  /** Attende che questo nodo diventi writer (il member.add che ci riguarda è replicato). */
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

  /**
   * Appende un evento al feed locale (verrà replicato a tutti).
   * @throws se il nodo non è writer (non ancora accettato, o espulso)
   */
  async append (payload: EventPayload): Promise<void> {
    if (!this.base?.writable) throw new Error('Questo nodo non è (ancora) un writer del team')
    await this.base.append(envelope(payload))
  }

  /**
   * Crea un invito monouso valido 24 ore.
   *
   * `replicated` indica se almeno un peer ha già ricevuto l'evento `invite.add`. Solo in quel
   * caso un ALTRO membro può accogliere il nuovo arrivato se questo nodo va offline.
   *
   * @param waitMs quanto attendere al massimo la replica dell'invito
   */
  async createInvite (waitMs = 10_000): Promise<{ code: string, expires: number, replicated: boolean }> {
    const expires = Date.now() + INVITE_TTL_MS
    const { id, invite, publicKey } = BlindPairing.createInvite(this.base.key, { expires })
    await this.append({ type: 'invite.add', id: hex(id), publicKey: hex(publicKey), expires })
    if (this.member) await this.member.flushed()
    const replicated = await this.waitLocalReplicated(waitMs)
    // Il codice contiene il seed dell'invito (segreto) e la discoveryKey: NON la chiave di cifratura.
    return { code: z32.encode(invite), expires, replicated }
  }

  /**
   * Attende che almeno un peer abbia scaricato tutto il nostro feed locale (best-effort).
   * Usa `remoteContiguousLength`: quanti blocchi contigui il peer dichiara di avere.
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

  /** Forza Autobase a scaricare e applicare ciò che è disponibile dai peer. */
  async update (): Promise<void> {
    await this.base.update()
  }

  // ═════════════════════════════ Letture dalla vista ═══════════════════════════

  /** true quando la base è aperta (dopo create/open/join). */
  get ready (): boolean { return this.base !== null }
  get writable (): boolean { return !!this.base?.writable }
  get isIndexer (): boolean { return !!this.base?.isIndexer }
  /** Chiave del feed locale (hex): è l'identità di questo nodo nel team. */
  get localKey (): string | null { return this.base ? hex(this.base.local.key) : null }
  get peers (): number { return this.swarm?.connections.size ?? 0 }

  /**
   * Coppia di chiavi del feed locale: la pubblica è l'identità del nodo nel team, la segreta
   * serve a firmare (es. le richieste di documenti). null se la base non è aperta.
   */
  get localKeyPair (): { memberKey: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array } | null {
    const kp = this.base?.local?.keyPair
    // memberKey = chiave del feed (identità nel team); publicKey/secretKey = coppia di firma.
    return kp?.secretKey ? { memberKey: this.base.local.key, publicKey: kp.publicKey, secretKey: kp.secretKey } : null
  }

  /**
   * Chiave pubblica di FIRMA (hex) del feed di un membro, letta dal manifest del suo core.
   *
   * In Hypercore 11 la chiave di un feed (quella con cui un membro è registrato nel team) è
   * l'hash del suo manifest, NON la chiave che firma. Per verificare una firma "a nome di" un
   * membro bisogna quindi risalire alla chiave di firma dal manifest (che abbiamo, perché
   * replichiamo i feed di tutti i membri). null se il feed non è (ancora) disponibile.
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

  /** Connessioni P2P aperte in questo momento (per agganciare protocolli a quelle già esistenti). */
  get connections (): any[] { return this.swarm ? [...this.swarm.connections] : [] }

  /** Chiavi del team, da salvare in state.json. */
  secrets (): TeamSecrets {
    return { baseKey: hex(this.base.key), encryptionKey: hex(this.base.encryptionKey) }
  }

  /** Legge un record qualsiasi della vista; null se assente. */
  async getRecord<T> (key: string): Promise<T | null> {
    const node = await this.base.view.get(key)
    return node ? node.value as T : null
  }

  /** Valore di una configurazione di team (`team.config`), o undefined se non impostata. */
  async config<T = unknown> (key: string): Promise<T | undefined> {
    const rec = await this.getRecord<{ value: T }>(KEYS.config(key))
    return rec?.value
  }

  async team (): Promise<TeamRecord | null> {
    return this.getRecord<TeamRecord>(KEYS.team)
  }

  /** Tutti i membri, compresi gli espulsi (`removed: true`). */
  async members (): Promise<MemberRecord[]> {
    return this.scan<MemberRecord>(RANGES.members)
  }

  async memories (): Promise<MemoryRecord[]> {
    return this.scan<MemoryRecord>(RANGES.memories)
  }

  /** Collegamenti espliciti creati dal dreaming. */
  async links (): Promise<{ from: string, to: string, rel: string }[]> {
    const out: { from: string, to: string, rel: string }[] = []
    for await (const { key, value } of this.base.view.createReadStream(RANGES.links)) {
      const [, from, to] = String(key).split('/')
      out.push({ from, to, rel: (value as { rel: string }).rel })
    }
    return out
  }

  /** Chi ha vinto il sogno di un'epoca (chiave del nodo), o null. */
  async dreamClaim (epoch: string): Promise<string | null> {
    return (await this.getRecord<{ by: string }>(KEYS.dreamClaim(epoch)))?.by ?? null
  }

  /** Diario dei sogni, dal più recente. */
  async dreamLogs (): Promise<{ epoch: string, by: string, ts: number, summary: string, stats: Record<string, number> }[]> {
    const out: any[] = []
    for await (const { value } of this.base.view.createReadStream(RANGES.dreamLogs)) out.push(value)
    return out.sort((a, b) => b.ts - a.ts)
  }

  /** Voti per ricordo: somma dei voti di tutti i nodi. */
  async votes (): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    for await (const { key, value } of this.base.view.createReadStream(RANGES.votes)) {
      const id = String(key).split('/')[1]
      out.set(id, (out.get(id) ?? 0) + (value as { delta: number }).delta)
    }
    return out
  }

  /** Ricordi fissati (id). */
  async pins (): Promise<Set<string>> {
    const out = new Set<string>()
    for await (const { key } of this.base.view.createReadStream(RANGES.pins)) out.add(String(key).split('/')[1])
    return out
  }

  /** Uso per ricordo, sommato su tutti i nodi: totale e ultimo utilizzo. */
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

  /** Inviti non ancora usati né annullati. */
  async invites (): Promise<InviteRecord[]> {
    return this.scan<InviteRecord>(RANGES.invites)
  }

  /** Scorre un range di chiavi della vista. */
  private async scan<T> (range: { gt: string, lt: string }): Promise<T[]> {
    const out: T[] = []
    for await (const { value } of this.base.view.createReadStream(range)) out.push(value as T)
    return out
  }
}
