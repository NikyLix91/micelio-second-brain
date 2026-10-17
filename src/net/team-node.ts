// Nodo di rete di un team: Autobase (log multi-writer + vista), Hyperswarm (discovery su DHT),
// blind-pairing (ingresso di nuovi membri). È l'unico modulo che parla con le librerie Holepunch.
//
// Lezioni dallo spike A (DESIGN §5):
// - la replica deve agganciare anche il protocollo "wakeup" (base.replicate / wakeup.addStream),
//   altrimenti i core dei nuovi writer non vengono scoperti;
// - la discovery va rinfrescata spesso quando si è isolati.
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

export interface TeamSecrets {
  baseKey: string
  encryptionKey: string
}

export interface TeamNodeOptions {
  storeDir: string
  /** Nodi bootstrap della DHT (test/rete privata). Vuoto = DHT pubblica. */
  bootstrap?: { host: string, port: number }[]
  log?: (msg: string) => void
}

const hex = (b: Uint8Array) => b4a.toString(b, 'hex') as string
const buf = (h: string) => b4a.from(h, 'hex')

const INVITE_TTL_MS = 24 * 60 * 60 * 1000
const REFRESH_ISOLATED_MS = 5_000
const REFRESH_NORMAL_MS = 60_000

export class TeamNode extends EventEmitter {
  private store: any
  private swarm: any = null
  private wakeup: any = null
  private pairing: any = null
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

  // ---------- Ciclo di vita ----------

  /** Crea un nuovo team: questo nodo ne diventa fondatore, admin e indexer. */
  async create (teamName: string, nodeName: string): Promise<TeamSecrets> {
    const encryptionKey = crypto.randomBytes(32)
    await this.startNetwork()
    await this.openBase(null, encryptionKey)
    await this.append({ type: 'team.init', name: teamName, founderName: nodeName })
    await this.base.update()
    return this.secrets()
  }

  /** Riapre un team già configurato su questo nodo. */
  async open (secrets: TeamSecrets): Promise<void> {
    await this.startNetwork()
    await this.openBase(buf(secrets.baseKey), buf(secrets.encryptionKey))
  }

  /**
   * Entra in un team con un codice d'invito. Un membro online qualsiasi verifica l'invito,
   * ci aggiunge come writer e ci consegna chiave del team e chiave di cifratura (decisione D2).
   */
  async join (inviteCode: string, nodeName: string, timeoutMs = 120_000): Promise<TeamSecrets> {
    await this.startNetwork()
    await this.store.ready()
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
        userData: b4a.from(JSON.stringify({ key: writerKey, name: nodeName })),
        onadd: (res: any) => {
          clearTimeout(timer)
          candidate.close().catch(() => {})
          resolve(res)
        }
      })
    })

    await this.openBase(result.key, result.encryptionKey)
    await this.waitWritable(timeoutMs)
    return this.secrets()
  }

  async close (): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    if (this.member) await this.member.close().catch(() => {})
    if (this.pairing) await this.pairing.close().catch(() => {})
    if (this.swarm) await this.swarm.destroy().catch(() => {})
    if (this.base) await this.base.close().catch(() => {})
    await this.store.close().catch(() => {})
  }

  // ---------- Rete ----------

  private async startNetwork (): Promise<void> {
    if (this.swarm) return
    await this.store.ready()
    this.wakeup = new Wakeup()
    this.swarm = new Hyperswarm({
      keyPair: await this.store.createKeyPair('hyperswarm'),
      ...(this.opts.bootstrap?.length ? { bootstrap: this.opts.bootstrap } : {})
    })
    this.swarm.on('connection', (conn: any, info: any) => {
      conn.on('error', () => {})
      this.log(`peer connesso ${hex(info.publicKey).slice(0, 8)}`)
      this.store.replicate(conn)
      this.wakeup.addStream(conn) // equivalente di base.replicate(), ma valido anche prima che la base esista
      this.emit('peers', this.swarm.connections.size)
      conn.once('close', () => this.emit('peers', this.swarm?.connections.size ?? 0))
    })
    this.pairing = new BlindPairing(this.swarm)
  }

  private async openBase (key: Uint8Array | null, encryptionKey: Uint8Array): Promise<void> {
    this.base = new Autobase(this.store, key, {
      open: openView,
      apply: applyNodes,
      valueEncoding: 'json',
      ackInterval: 1000,
      encryptionKey,
      wakeup: this.wakeup
    })
    this.base.on('update', () => this.emit('update'))
    this.base.on('error', (err: Error) => this.log(`errore autobase: ${err.message}`))
    await this.base.ready()

    this.discovery = this.swarm.join(this.base.discoveryKey, { server: true, client: true })
    await this.discovery.flushed()
    this.log(`annunciato sul topic del team ${hex(this.base.discoveryKey).slice(0, 8)}`)

    let lastRefresh = Date.now()
    this.refreshTimer = setInterval(() => {
      const isolated = this.swarm.connections.size === 0
      if (Date.now() - lastRefresh >= (isolated ? REFRESH_ISOLATED_MS : REFRESH_NORMAL_MS)) {
        lastRefresh = Date.now()
        this.discovery.refresh({ client: true, server: true }).catch(() => {})
      }
    }, REFRESH_ISOLATED_MS)
    this.refreshTimer.unref()

    // Ogni membro risponde alle richieste d'ingresso: chi ha invitato può essere offline.
    this.member = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: (candidate: any) => this.onCandidate(candidate)
    })
  }

  private async onCandidate (candidate: any): Promise<void> {
    if (!this.base.writable) return
    const inviteId = hex(candidate.inviteId)
    const inv = await this.getRecord<InviteRecord>(KEYS.invite(inviteId))
    if (!inv) return
    if (inv.expires && inv.expires < Date.now()) {
      this.log(`invito ${inviteId.slice(0, 8)} scaduto: rifiutato`)
      return
    }
    candidate.open(buf(inv.publicKey))
    const { key, name } = JSON.parse(b4a.toString(candidate.userData))
    this.log(`richiesta d'ingresso valida da "${name}": aggiungo il writer`)
    await this.append({ type: 'member.add', key, name, inviteId })
    candidate.confirm({ key: this.base.key, encryptionKey: this.base.encryptionKey })
  }

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

  // ---------- Operazioni ----------

  async append (payload: EventPayload): Promise<void> {
    if (!this.base?.writable) throw new Error('Questo nodo non è (ancora) un writer del team')
    await this.base.append(envelope(payload))
  }

  /**
   * Crea un invito. `replicated` dice se almeno un peer ha già ricevuto l'evento `invite.add`:
   * solo allora un altro membro può accogliere il nuovo arrivato anche se questo nodo va offline.
   */
  async createInvite (waitMs = 10_000): Promise<{ code: string, expires: number, replicated: boolean }> {
    const expires = Date.now() + INVITE_TTL_MS
    const { id, invite, publicKey } = BlindPairing.createInvite(this.base.key, { expires })
    await this.append({ type: 'invite.add', id: hex(id), publicKey: hex(publicKey), expires })
    if (this.member) await this.member.flushed()
    const replicated = await this.waitLocalReplicated(waitMs)
    return { code: z32.encode(invite), expires, replicated }
  }

  /** Attende che almeno un peer abbia tutto il nostro feed locale (best-effort). */
  private async waitLocalReplicated (timeoutMs: number): Promise<boolean> {
    const local = this.base.local
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
      if (local.peers.some((p: any) => p.remoteContiguousLength >= local.length)) return true
      await new Promise((r) => setTimeout(r, 200))
    }
    return false
  }

  async invites (): Promise<InviteRecord[]> {
    return this.scan<InviteRecord>(RANGES.invites)
  }

  async update (): Promise<void> {
    await this.base.update()
  }

  // ---------- Letture dalla vista ----------

  get ready (): boolean { return this.base !== null }
  get writable (): boolean { return !!this.base?.writable }
  get isIndexer (): boolean { return !!this.base?.isIndexer }
  get localKey (): string | null { return this.base ? hex(this.base.local.key) : null }
  get peers (): number { return this.swarm?.connections.size ?? 0 }

  secrets (): TeamSecrets {
    return { baseKey: hex(this.base.key), encryptionKey: hex(this.base.encryptionKey) }
  }

  async getRecord<T> (key: string): Promise<T | null> {
    const node = await this.base.view.get(key)
    return node ? node.value as T : null
  }

  async team (): Promise<TeamRecord | null> {
    return this.getRecord<TeamRecord>(KEYS.team)
  }

  async members (): Promise<MemberRecord[]> {
    return this.scan<MemberRecord>(RANGES.members)
  }

  async memories (): Promise<MemoryRecord[]> {
    return this.scan<MemoryRecord>(RANGES.memories)
  }

  private async scan<T> (range: { gt: string, lt: string }): Promise<T[]> {
    const out: T[] = []
    for await (const { value } of this.base.view.createReadStream(range)) out.push(value as T)
    return out
  }
}
