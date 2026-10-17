/**
 * @file Documento originale su richiesta (DESIGN §12-bis, decisioni D10–D11).
 *
 * Protocollo `micelio/file/v1`, un canale `protomux` sulle connessioni Hyperswarm già aperte
 * (quindi già cifrate con Noise). Tre messaggi JSON:
 *   request  { id, hash, writer, signer, sig }  chi chiede → tutti i peer connessi
 *   response { id, ok, reason?, name?, size? }  ogni peer risponde (sì / no / non ce l'ho)
 *   chunk    { id, seq, data(base64), done }    il proprietario invia il file a pezzi
 *
 * Chi può chiedere: solo un MEMBRO ATTIVO del team. Il richiedente dimostra la propria identità
 * firmando, con la chiave segreta del suo feed (writer), l'hash della sessione Noise di QUESTA
 * connessione più l'hash del file. La firma vale solo su questa connessione: non si può
 * intercettare e riusare altrove. In Hypercore 11 la chiave del feed (`writer`, l'identità nel
 * team) e la chiave che firma (`signer`) sono diverse: il proprietario verifica che `signer` sia
 * davvero la chiave di firma del feed `writer` (dal suo manifest).
 *
 * Chi risponde "sì": solo il nodo PROPRIETARIO, e solo se il file sta in una cartella
 * condivisibile, esiste ancora e ha ancora lo stesso contenuto (D10). Le copie scaricate da altri
 * nodi non vengono mai ri-servite (D11): se il proprietario è offline, il file non è disponibile.
 *
 * All'arrivo il file viene verificato con il suo hash SHA-256: un peer non può spacciare un
 * contenuto diverso.
 */
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import Protomux from 'protomux'
import c from 'compact-encoding'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'

const PROTOCOL = 'micelio/file/v1'
/** Dimensione dei pezzi inviati: 64 KB (in base64 circa 87 KB per messaggio). */
const CHUNK_BYTES = 64 * 1024
/** Tempo massimo per ricevere un file. */
const FETCH_TIMEOUT_MS = 60_000

export interface FileShareDeps {
  /** true se  è un membro attivo e  è la chiave di firma del suo feed. */
  isMember: (writerKeyHex: string, signerHex: string) => Promise<boolean>
  /** Il file locale da servire per un hash, oppure il motivo del rifiuto. */
  resolve: (hash: string) => Promise<{ file: string, name: string, size: number } | { denied: string }>
  /** Chiave pubblica e segreta del feed locale (per firmare le richieste); null se non writer. */
  localWriter: () => { memberKey: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array } | null
  log: (m: string) => void
}

interface Channel { ch: any, request: any, response: any, chunk: any, conn: any }

interface Pending {
  hash: string
  resolve: (r: { data: Buffer, name: string }) => void
  reject: (e: Error) => void
  /** Risposte ricevute (per capire quando tutti hanno detto no). */
  answers: number
  asked: number
  denials: string[]
  /** Peer scelto (il primo che ha detto sì) e pezzi ricevuti. */
  from: any | null
  name: string
  parts: Buffer[]
  timer: NodeJS.Timeout
}

/** Messaggio da firmare: hash della sessione Noise + hash del file. */
const signedPayload = (handshakeHash: Uint8Array, hash: string) => b4a.concat([handshakeHash, b4a.from(hash, 'hex')])

export class FileShare {
  private readonly channels = new Set<Channel>()
  private readonly pending = new Map<string, Pending>()

  constructor (private readonly deps: FileShareDeps) {}

  /**
   * Prepara il protocollo su una nuova connessione (chiamato per ogni peer connesso).
   *
   * Due cose, entrambe necessarie (bug trovato nei test della Fase 4):
   * - `pair`: se il peer apre il canale per primo, lo creiamo noi in risposta;
   * - `open`: proviamo comunque ad aprirlo subito.
   * Senza `pair`, se un lato apriva il canale quando l'altro non era ancora pronto, l'apertura
   * veniva rifiutata e il canale si chiudeva su entrambi i lati: nessun download possibile.
   */
  attach (conn: any): void {
    const mux = Protomux.from(conn)
    if (!conn.__micelioFilePaired) {
      conn.__micelioFilePaired = true
      mux.pair({ protocol: PROTOCOL }, () => this.open(conn))
      conn.once('close', () => mux.unpair({ protocol: PROTOCOL }))
    }
    this.open(conn)
  }

  /** Crea e apre il canale su una connessione, se non esiste già. */
  private open (conn: any): void {
    const mux = Protomux.from(conn)
    const ch = mux.createChannel({ protocol: PROTOCOL, unique: true, onclose: () => this.channels.delete(entry) })
    if (!ch) return // canale già esistente su questa connessione
    const entry: Channel = {
      ch,
      conn,
      request: ch.addMessage({ encoding: c.json, onmessage: (m: any) => { this.onRequest(entry, m).catch((e) => this.deps.log(`richiesta file: ${e.message}`)) } }),
      response: ch.addMessage({ encoding: c.json, onmessage: (m: any) => this.onResponse(entry, m) }),
      chunk: ch.addMessage({ encoding: c.json, onmessage: (m: any) => this.onChunk(entry, m) })
    }
    ch.open()
    this.channels.add(entry)
  }

  // ═══════════════════════════════ Lato proprietario ═══════════════════════════════

  /** Gestisce una richiesta: verifica identità, appartenenza al team e disponibilità del file. */
  private async onRequest (entry: Channel, m: { id: string, hash: string, writer: string, signer: string, sig: string }): Promise<void> {
    const deny = (reason: string) => entry.response.send({ id: m.id, ok: false, reason })
    // 1) Firma valida su QUESTA connessione: il richiedente possiede davvero la chiave che dichiara.
    const valid = typeof m.writer === 'string' && typeof m.signer === 'string' && typeof m.sig === 'string' &&
      crypto.verify(signedPayload(entry.conn.handshakeHash, m.hash), b4a.from(m.sig, 'hex'), b4a.from(m.signer, 'hex'))
    if (!valid) return deny('firma non valida')
    // 2) È un membro attivo del team, e la chiave di firma è proprio quella del suo feed.
    if (!(await this.deps.isMember(m.writer, m.signer))) return deny('non sei un membro attivo del team')
    // 3) Il file c'è, è condivisibile ed è invariato.
    const r = await this.deps.resolve(m.hash)
    if ('denied' in r) return deny(r.denied)
    const data = fs.readFileSync(r.file)
    entry.response.send({ id: m.id, ok: true, name: r.name, size: data.length })
    for (let seq = 0, off = 0; off < data.length || seq === 0; seq++, off += CHUNK_BYTES) {
      const part = data.subarray(off, off + CHUNK_BYTES)
      entry.chunk.send({ id: m.id, seq, data: part.toString('base64'), done: off + CHUNK_BYTES >= data.length })
    }
    this.deps.log(`documento ${r.name} inviato a ${m.writer.slice(0, 8)}`)
  }

  // ═══════════════════════════════ Lato richiedente ═══════════════════════════════

  /**
   * Chiede un file a tutti i peer connessi e attende il primo che lo fornisce.
   * @throws Error con il motivo (nessun peer, rifiuto, timeout, contenuto non corrispondente)
   */
  fetch (hash: string): Promise<{ data: Buffer, name: string }> {
    const me = this.deps.localWriter()
    if (!me) return Promise.reject(new Error('questo nodo non è un membro attivo del team'))
    const open = [...this.channels].filter((e) => e.ch.opened)
    if (open.length === 0) return Promise.reject(new Error('nessun collega connesso: il proprietario del documento deve essere online'))
    const id = randomBytes(8).toString('hex')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(id, new Error('nessuna risposta entro 60 secondi')), FETCH_TIMEOUT_MS)
      this.pending.set(id, { hash, resolve, reject, answers: 0, asked: open.length, denials: [], from: null, name: '', parts: [], timer })
      for (const e of open) {
        const sig = crypto.sign(signedPayload(e.conn.handshakeHash, hash), me.secretKey)
        e.request.send({ id, hash, writer: b4a.toString(me.memberKey, 'hex'), signer: b4a.toString(me.publicKey, 'hex'), sig: b4a.toString(sig, 'hex') })
      }
    })
  }

  private onResponse (entry: Channel, m: { id: string, ok: boolean, reason?: string, name?: string }): void {
    const p = this.pending.get(m.id)
    if (!p) return
    p.answers++
    if (m.ok && !p.from) {
      p.from = entry // il primo "sì" vince; gli altri vengono ignorati
      p.name = m.name ?? 'documento'
    } else if (!m.ok && m.reason) {
      p.denials.push(m.reason)
    }
    if (!p.from && p.answers >= p.asked) {
      // Tutti hanno risposto e nessuno ha il file. "non trovato" è la risposta dei nodi che non
      // ne sono proprietari: se c'è un rifiuto più specifico, mostriamo quello.
      const specific = p.denials.find((d) => d !== 'documento non disponibile su questo nodo')
      this.fail(m.id, new Error(specific ?? 'il proprietario del documento non è online (o il file non è più disponibile)'))
    }
  }

  private onChunk (entry: Channel, m: { id: string, seq: number, data: string, done: boolean }): void {
    const p = this.pending.get(m.id)
    if (!p || p.from !== entry) return
    p.parts[m.seq] = Buffer.from(m.data, 'base64')
    if (!m.done) return
    const data = Buffer.concat(p.parts)
    // Verifica di integrità: il contenuto deve corrispondere esattamente all'hash richiesto.
    if (createHash('sha256').update(data).digest('hex') !== p.hash) return this.fail(m.id, new Error('il file ricevuto non corrisponde all\'originale (hash diverso)'))
    clearTimeout(p.timer)
    this.pending.delete(m.id)
    p.resolve({ data, name: p.name })
  }

  private fail (id: string, err: Error): void {
    const p = this.pending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(id)
    p.reject(err)
  }
}
