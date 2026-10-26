/**
 * @file Documento originale su richiesta (DESIGN §12-bis, decisioni D10–D11).
 *
 * EN: Original document on request (DESIGN §12-bis, decisions D10–D11).
 *
 * Protocollo `micelio/file/v1`, un canale `protomux` sulle connessioni Hyperswarm già aperte
 * (quindi già cifrate con Noise). Tre messaggi JSON:
 *   request  { id, hash, writer, signer, sig }  chi chiede → tutti i peer connessi
 *   response { id, ok, reason?, name?, size?, writer?, signer?, sig? }
 *                                               ogni peer risponde (sì / no / non ce l'ho);
 *                                               il «sì» è firmato dal proprietario (dalla 0.6.2)
 *   chunk    { id, seq, data(base64), done }    il proprietario invia il file a pezzi
 *
 * EN: Protocol `micelio/file/v1`, a `protomux` channel over the Hyperswarm connections already
 * open (so already encrypted with Noise). Three JSON messages:
 *   request  { id, hash, writer, signer, sig }  requester → all connected peers
 *   response { id, ok, reason?, name?, size?, writer?, signer?, sig? }
 *                                               each peer answers (yes / no / I don't have it);
 *                                               the "yes" is signed by the owner (since 0.6.2)
 *   chunk    { id, seq, data(base64), done }    the owner sends the file in pieces
 *
 * Chi può chiedere: solo un MEMBRO ATTIVO del team. Il richiedente dimostra la propria identità
 * firmando, con la chiave segreta del suo feed (writer), l'hash della sessione Noise di QUESTA
 * connessione più l'hash del file. La firma vale solo su questa connessione: non si può
 * intercettare e riusare altrove. In Hypercore 11 la chiave del feed (`writer`, l'identità nel
 * team) e la chiave che firma (`signer`) sono diverse: il proprietario verifica che `signer` sia
 * davvero la chiave di firma del feed `writer` (dal suo manifest).
 *
 * EN: Who can ask: only an ACTIVE MEMBER of the team. The requester proves their identity by
 * signing, with the secret key of their feed (writer), the Noise session hash of THIS connection
 * plus the file hash. The signature is valid only on this connection: it can't be intercepted
 * and reused elsewhere. In Hypercore 11 the feed key (`writer`, the identity in the team) and the
 * signing key (`signer`) are different: the owner checks that `signer` really is the signing
 * key of the `writer` feed (from its manifest).
 *
 * Chi risponde "sì": solo il nodo PROPRIETARIO, e solo se il file sta in una cartella
 * condivisibile, esiste ancora e ha ancora lo stesso contenuto (D10). Le copie scaricate da altri
 * nodi non vengono mai ri-servite (D11): se il proprietario è offline, il file non è disponibile.
 *
 * EN: Who answers "yes": only the OWNER node, and only if the file is in a shareable folder,
 * still exists and still has the same content (D10). Copies downloaded by other nodes are never
 * served again (D11): if the owner is offline, the file is not available.
 *
 * All'arrivo il file viene verificato con il suo hash SHA-256: un peer non può spacciare un
 * contenuto diverso.
 *
 * EN: On arrival the file is checked against its SHA-256 hash: a peer can't pass off different
 * content.
 */
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import Protomux from 'protomux'
import c from 'compact-encoding'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'

const PROTOCOL = 'micelio/file/v1'
/** Dimensione dei pezzi inviati: 64 KB (in base64 circa 87 KB per messaggio). / EN: Size of the pieces sent: 64 KB (about 87 KB per message in base64). */
const CHUNK_BYTES = 64 * 1024
/** Tempo massimo per ricevere un file. / EN: Maximum time to receive a file. */
const FETCH_TIMEOUT_MS = 60_000

export interface FileShareDeps {
  /** true se `writerKeyHex` è un membro attivo e `signerHex` è la chiave di firma del suo feed. / EN: true if `writerKeyHex` is an active member and `signerHex` is the signing key of their feed. */
  isMember: (writerKeyHex: string, signerHex: string) => Promise<boolean>
  /** Il file locale da servire per un hash, oppure il motivo del rifiuto. / EN: The local file to serve for a hash, or the reason for refusing. */
  resolve: (hash: string) => Promise<{ file: string, name: string, size: number } | { denied: string }>
  /** Chiave pubblica e segreta del feed locale (per firmare le richieste); null se non writer. / EN: Public and secret key of the local feed (to sign requests); null if not a writer. */
  localWriter: () => { memberKey: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array } | null
  log: (m: string) => void
}

interface Channel { ch: any, request: any, response: any, chunk: any, conn: any }

interface Pending {
  hash: string
  resolve: (r: { data: Buffer, name: string }) => void
  reject: (e: Error) => void
  /** Risposte ricevute (per capire quando tutti hanno detto no). / EN: Answers received (to know when everyone said no). */
  answers: number
  asked: number
  denials: string[]
  /** Feed (writer) dell'autore del ricordo: solo lui può rispondere «sì». / EN: Feed (writer) of the memory's author: only they can answer "yes". */
  owner: string
  /** Peer scelto (il primo «sì» firmato dal proprietario) e pezzi ricevuti per ogni peer. / EN: Chosen peer (the first "yes" signed by the owner) and pieces received per peer. */
  from: Channel | null
  name: string
  /** Peer che hanno detto «sì», in attesa della verifica della firma. / EN: Peers that said "yes", waiting for the signature check. */
  offers: Set<Channel>
  parts: Map<Channel, Buffer[]>
  done: Set<Channel>
  timer: NodeJS.Timeout
}

/** Messaggio da firmare: hash della sessione Noise + hash del file. / EN: Message to sign: Noise session hash + file hash. */
const signedPayload = (handshakeHash: Uint8Array, hash: string) => b4a.concat([handshakeHash, b4a.from(hash, 'hex')])

/**
 * Messaggio che firma il proprietario nel suo «sì»: diverso da quello della richiesta (il prefisso),
 * così una firma di richiesta non si può rigiocare come risposta.
 *
 * EN: Message the owner signs in their "yes": different from the request one (the prefix), so a
 * request signature can't be replayed as an answer.
 */
const answerPayload = (handshakeHash: Uint8Array, hash: string) => b4a.concat([b4a.from('micelio-file-answer'), handshakeHash, b4a.from(hash, 'hex')])

export class FileShare {
  private readonly channels = new Set<Channel>()
  private readonly pending = new Map<string, Pending>()

  constructor (private readonly deps: FileShareDeps) {}

  /**
   * Prepara il protocollo su una nuova connessione (chiamato per ogni peer connesso).
   *
   * EN: Sets up the protocol on a new connection (called for each connected peer).
   *
   * Due cose, entrambe necessarie (bug trovato nei test della Fase 4):
   * - `pair`: se il peer apre il canale per primo, lo creiamo noi in risposta;
   * - `open`: proviamo comunque ad aprirlo subito.
   * Senza `pair`, se un lato apriva il canale quando l'altro non era ancora pronto, l'apertura
   * veniva rifiutata e il canale si chiudeva su entrambi i lati: nessun download possibile.
   *
   * EN: Two things, both required (bug found in the Phase 4 tests):
   * - `pair`: if the peer opens the channel first, we create it in response;
   * - `open`: we try to open it right away anyway.
   * Without `pair`, if one side opened the channel when the other wasn't ready yet, the open was
   * rejected and the channel closed on both sides: no download possible.
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

  /** Crea e apre il canale su una connessione, se non esiste già. / EN: Creates and opens the channel on a connection, if it doesn't exist yet. */
  private open (conn: any): void {
    const mux = Protomux.from(conn)
    const ch = mux.createChannel({ protocol: PROTOCOL, unique: true, onclose: () => this.channels.delete(entry) })
    if (!ch) return // canale già esistente su questa connessione / EN: channel already exists on this connection
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
  // EN: ═══ Owner side ═══

  /** Gestisce una richiesta: verifica identità, appartenenza al team e disponibilità del file. / EN: Handles a request: checks identity, team membership and file availability. */
  private async onRequest (entry: Channel, m: { id: string, hash: string, writer: string, signer: string, sig: string }): Promise<void> {
    const deny = (reason: string) => entry.response.send({ id: m.id, ok: false, reason })
    // 1) Firma valida su QUESTA connessione: il richiedente possiede davvero la chiave che dichiara.
    // EN: 1) Valid signature on THIS connection: the requester really owns the key it claims.
    const valid = typeof m.writer === 'string' && typeof m.signer === 'string' && typeof m.sig === 'string' &&
      crypto.verify(signedPayload(entry.conn.handshakeHash, m.hash), b4a.from(m.sig, 'hex'), b4a.from(m.signer, 'hex'))
    if (!valid) return deny('firma non valida')
    // 2) È un membro attivo del team, e la chiave di firma è proprio quella del suo feed.
    // EN: 2) It's an active team member, and the signing key really is the one of its feed.
    if (!(await this.deps.isMember(m.writer, m.signer))) return deny('non sei un membro attivo del team')
    // 3) Il file c'è, è condivisibile ed è invariato.
    // EN: 3) The file exists, is shareable and is unchanged.
    const r = await this.deps.resolve(m.hash)
    if ('denied' in r) return deny(r.denied)
    const me = this.deps.localWriter()
    if (!me) return deny('questo nodo non è un membro attivo del team')
    const data = fs.readFileSync(r.file)
    // Il «sì» è firmato con la chiave del nostro feed: il richiedente accetta il file solo
    // dall'autore del ricordo (un peer qualunque connesso al topic non può rispondere al suo posto).
    // EN: The "yes" is signed with our feed's key: the requester accepts the file only from the
    //     memory's author (any peer connected to the topic can't answer in their place).
    const proof = crypto.sign(answerPayload(entry.conn.handshakeHash, m.hash), me.secretKey)
    entry.response.send({ id: m.id, ok: true, name: r.name, size: data.length, writer: b4a.toString(me.memberKey, 'hex'), signer: b4a.toString(me.publicKey, 'hex'), sig: b4a.toString(proof, 'hex') })
    for (let seq = 0, off = 0; off < data.length || seq === 0; seq++, off += CHUNK_BYTES) {
      const part = data.subarray(off, off + CHUNK_BYTES)
      entry.chunk.send({ id: m.id, seq, data: part.toString('base64'), done: off + CHUNK_BYTES >= data.length })
    }
    this.deps.log(`documento ${r.name} inviato a ${m.writer.slice(0, 8)}`)
  }

  // ═══════════════════════════════ Lato richiedente ═══════════════════════════════
  // EN: ═══ Requester side ═══

  /**
   * Chiede un file a tutti i peer connessi e attende il primo «sì» firmato dal proprietario.
   *
   * EN: Asks all connected peers for a file and waits for the first "yes" signed by the owner.
   *
   * Revisione di sicurezza 2026-10-26: prima vinceva il primo «sì» di chiunque, e un peer
   * connesso al topic (anche non membro) poteva rispondere per primo e far fallire il download.
   * Ora un «sì» conta solo se è firmato dal feed `owner` (l'autore del ricordo) di un membro attivo.
   *
   * EN: Security review 2026-10-26: before, the first "yes" from anyone won, and a peer connected
   * to the topic (even a non-member) could answer first and make the download fail. Now a "yes"
   * counts only if it is signed by the `owner` feed (the memory's author) of an active member.
   * @param owner feed (writer, esadecimale) dell'autore del ricordo
   *        EN: feed (writer, hex) of the memory's author
   * @throws Error con il motivo (nessun peer, rifiuto, timeout, contenuto non corrispondente)
   *         EN: with the reason (no peers, refusal, timeout, mismatched content)
   */
  fetch (hash: string, owner: string): Promise<{ data: Buffer, name: string }> {
    const me = this.deps.localWriter()
    if (!me) return Promise.reject(new Error('questo nodo non è un membro attivo del team'))
    const open = [...this.channels].filter((e) => e.ch.opened)
    if (open.length === 0) return Promise.reject(new Error('nessun collega connesso: il proprietario del documento deve essere online'))
    const id = randomBytes(8).toString('hex')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(id, new Error('nessuna risposta entro 60 secondi')), FETCH_TIMEOUT_MS)
      this.pending.set(id, { hash, owner, resolve, reject, answers: 0, asked: open.length, denials: [], from: null, name: '', offers: new Set(), parts: new Map(), done: new Set(), timer })
      for (const e of open) {
        const sig = crypto.sign(signedPayload(e.conn.handshakeHash, hash), me.secretKey)
        e.request.send({ id, hash, writer: b4a.toString(me.memberKey, 'hex'), signer: b4a.toString(me.publicKey, 'hex'), sig: b4a.toString(sig, 'hex') })
      }
    })
  }

  private onResponse (entry: Channel, m: { id: string, ok: boolean, reason?: string, name?: string, writer?: string, signer?: string, sig?: string }): void {
    const p = this.pending.get(m.id)
    if (!p) return
    if (!m.ok) {
      p.answers++
      if (m.reason) p.denials.push(m.reason)
      this.checkAllAnswered(m.id, p)
      return
    }
    // Un «sì»: i pezzi possono arrivare mentre verifichiamo la firma, quindi li teniamo da parte
    // per questo peer (onChunk) e scegliamo il peer solo a verifica fatta.
    // EN: A "yes": pieces may arrive while we check the signature, so we keep them aside for this
    //     peer (onChunk) and choose the peer only once the check is done.
    p.offers.add(entry)
    this.verifyAnswer(entry, p, m).then((ok) => {
      if (this.pending.get(m.id) !== p) return
      p.answers++
      if (ok && !p.from) {
        p.from = entry // il primo «sì» verificato vince / EN: the first verified "yes" wins
        p.name = m.name ?? 'documento'
        this.tryFinish(m.id, p)
        return
      }
      if (!ok) {
        p.denials.push('risposta non firmata dall\'autore del documento')
        p.offers.delete(entry)
        p.parts.delete(entry)
      }
      this.checkAllAnswered(m.id, p)
    }).catch(() => {})
  }

  /** Il «sì» è firmato su questa connessione dal feed dell'autore, membro attivo? / EN: Is the "yes" signed on this connection by the author's feed, an active member? */
  private async verifyAnswer (entry: Channel, p: Pending, m: { writer?: string, signer?: string, sig?: string }): Promise<boolean> {
    if (typeof m.writer !== 'string' || typeof m.signer !== 'string' || typeof m.sig !== 'string') return false
    if (m.writer !== p.owner) return false
    try {
      if (!crypto.verify(answerPayload(entry.conn.handshakeHash, p.hash), b4a.from(m.sig, 'hex'), b4a.from(m.signer, 'hex'))) return false
    } catch { return false }
    return await this.deps.isMember(m.writer, m.signer)
  }

  /** Tutti hanno risposto e nessun «sì» valido: errore con il motivo più utile. / EN: Everyone answered and no valid "yes": error with the most useful reason. */
  private checkAllAnswered (id: string, p: Pending): void {
    if (p.from || p.answers < p.asked) return
    // "non trovato" è la risposta dei nodi che non ne sono proprietari: se c'è un rifiuto più
    // specifico, mostriamo quello.
    // EN: "not found" is the answer of the nodes that don't own it: if there's a more specific
    //     refusal, we show that one.
    const specific = p.denials.find((d) => d !== 'documento non disponibile su questo nodo')
    this.fail(id, new Error(specific ?? 'il proprietario del documento non è online (o il file non è più disponibile)'))
  }

  private onChunk (entry: Channel, m: { id: string, seq: number, data: string, done: boolean }): void {
    const p = this.pending.get(m.id)
    // Solo pezzi di un peer che ha detto «sì» (verificato o in verifica), con un indice sensato
    // EN: Only pieces from a peer that said "yes" (verified or being verified), with a sane index
    if (!p || !p.offers.has(entry) || !Number.isInteger(m.seq) || m.seq < 0 || typeof m.data !== 'string') return
    let parts = p.parts.get(entry)
    if (!parts) p.parts.set(entry, parts = [])
    parts[m.seq] = Buffer.from(m.data, 'base64')
    if (m.done) p.done.add(entry)
    this.tryFinish(m.id, p)
  }

  /** Se il peer scelto ha mandato tutto, verifica il contenuto e chiude. / EN: If the chosen peer sent everything, checks the content and closes. */
  private tryFinish (id: string, p: Pending): void {
    if (!p.from || !p.done.has(p.from)) return
    const data = Buffer.concat(p.parts.get(p.from) ?? [])
    // Verifica di integrità: il contenuto deve corrispondere esattamente all'hash richiesto.
    // EN: Integrity check: the content must match the requested hash exactly.
    if (createHash('sha256').update(data).digest('hex') !== p.hash) return this.fail(id, new Error('il file ricevuto non corrisponde all\'originale (hash diverso)'))
    clearTimeout(p.timer)
    this.pending.delete(id)
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
