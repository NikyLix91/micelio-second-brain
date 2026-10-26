/**
 * @file Cancello delle connessioni (0.7.0): con la protezione completa del team, un nodo replica
 * i dati del team solo con chi dimostra di essere un membro attivo.
 *
 * EN: Connection gate (0.7.0): with the team's full protection, a node replicates the team's data
 * only with whoever proves to be an active member.
 *
 * Perché: la chiave del registro basta per replicare i core. Un membro rimosso la conserva, e
 * prima di questo cancello continuava a ricevere tutto quello che il team scriveva dopo la sua
 * rimozione (revisione di sicurezza 2026-10-26). Ora ogni nodo, prima di agganciare la replica a
 * una connessione, chiede al peer una prova: la firma, con la chiave del suo feed, dell'hash della
 * sessione Noise di QUESTA connessione (non si può riusare altrove). La chiave del feed è l'hash
 * della chiave di firma (`Hypercore.key(signer)`), quindi la prova si verifica anche senza avere
 * ancora il feed del peer: serve a chi è appena entrato.
 *
 * EN: Why: the log key is enough to replicate the cores. A removed member keeps it, and before this
 * gate kept receiving everything the team wrote after their removal (security review 2026-10-26).
 * Now every node, before attaching replication to a connection, asks the peer for a proof: the
 * signature, with their feed's key, of the Noise session hash of THIS connection (it can't be
 * reused elsewhere). The feed key is the hash of the signing key (`Hypercore.key(signer)`), so the
 * proof can be checked even without having the peer's feed yet: that's needed for whoever has just
 * joined.
 *
 * Regole:
 * - protezione spenta (team esistenti finché un admin non la accende): si replica con tutti, come
 *   prima della 0.7.0, così i nodi 0.6.x continuano a sincronizzarsi;
 * - nodo che non è (ancora) un writer, per esempio durante l'ingresso: non ha niente da proteggere
 *   e replica con tutti, ma gli altri replicano con lui solo dopo la sua prova;
 * - protezione accesa: replica solo dopo una prova valida di un membro attivo. A ogni
 *   aggiornamento del registro si riesaminano le connessioni: chi è stato rimosso viene staccato,
 *   chi è appena entrato viene accolto.
 * Il pairing (blind-pairing) non passa da qui: chi chiede di entrare non è ancora un membro.
 *
 * EN: Rules:
 * - protection off (existing teams until an admin turns it on): replicate with everyone, as before
 *   0.7.0, so 0.6.x nodes keep syncing;
 * - a node that isn't a writer (yet), for example while joining: it has nothing to protect and
 *   replicates with everyone, but the others replicate with it only after its proof;
 * - protection on: replicate only after a valid proof from an active member. On every log update
 *   the connections are re-examined: whoever was removed gets disconnected, whoever has just
 *   joined gets accepted.
 * Pairing (blind-pairing) doesn't go through here: whoever asks to join isn't a member yet.
 */
import Protomux from 'protomux'
import c from 'compact-encoding'
import crypto from 'hypercore-crypto'
import Hypercore from 'hypercore'
import b4a from 'b4a'

const PROTOCOL = 'micelio/member/v1'

export interface MemberGateDeps {
  /** Attende che il registro del team sia aperto (le decisioni dipendono dalla sua vista). / EN: Waits for the team log to be open (decisions depend on its view). */
  ready: () => Promise<void>
  /** Protezione completa accesa per il team. / EN: Full protection on for the team. */
  strict: () => Promise<boolean>
  /** true se il feed (hex) è di un membro attivo. / EN: true if the feed (hex) belongs to an active member. */
  isActiveMember: (writerHex: string) => Promise<boolean>
  /** Chiavi del feed locale per firmare la prova; null se il nodo non è (ancora) un writer. / EN: Local feed keys to sign the proof; null if the node isn't a writer (yet). */
  localWriter: () => { memberKey: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array } | null
  /** Aggancia la replica dei dati del team alla connessione (chiamata al massimo una volta). / EN: Attaches the team data replication to the connection (called at most once). */
  replicate: (conn: any) => void
  log: (m: string) => void
}

interface Proof { writer: string, signer: string, sig: string }

interface Entry {
  conn: any
  channel: any
  message: any
  /** Prova ricevuta dal peer (valida per firma, da riesaminare per l'appartenenza). / EN: Proof received from the peer (valid by signature, to re-examine for membership). */
  proof: Proof | null
  /** Replica agganciata. / EN: Replication attached. */
  replicating: boolean
  /** Agganciata senza prova (protezione spenta o nodo non writer). / EN: Attached without proof (protection off or non-writer node). */
  unproven: boolean
  /** Abbiamo già mandato la nostra prova. / EN: We already sent our proof. */
  sent: boolean
}

/** Messaggio firmato: prefisso del protocollo + hash della sessione Noise. / EN: Signed message: protocol prefix + Noise session hash. */
export const memberPayload = (handshakeHash: Uint8Array) => b4a.concat([b4a.from('micelio-member/v1'), handshakeHash])

/**
 * Verifica crittografica di una prova (senza l'appartenenza, che dipende dalla vista).
 *
 * EN: Cryptographic check of a proof (without membership, which depends on the view).
 */
export function validProof (handshakeHash: Uint8Array, p: unknown): p is Proof {
  if (!p || typeof p !== 'object') return false
  const { writer, signer, sig } = p as Record<string, unknown>
  if (typeof writer !== 'string' || typeof signer !== 'string' || typeof sig !== 'string') return false
  if (!/^[0-9a-f]{64}$/.test(writer) || !/^[0-9a-f]{64}$/.test(signer) || !/^[0-9a-f]{128}$/.test(sig)) return false
  try {
    // Il feed dichiarato deve essere proprio quello della chiave di firma
    // EN: The declared feed must really be the one of the signing key
    if (b4a.toString(Hypercore.key(b4a.from(signer, 'hex')), 'hex') !== writer) return false
    return crypto.verify(memberPayload(handshakeHash), b4a.from(sig, 'hex'), b4a.from(signer, 'hex'))
  } catch {
    return false
  }
}

export class MemberGate {
  private readonly entries = new Set<Entry>()
  /** Una riesaminazione alla volta. / EN: One re-examination at a time. */
  private rechecking: Promise<void> = Promise.resolve()

  constructor (private readonly deps: MemberGateDeps) {}

  /** Nuova connessione dello swarm. / EN: New swarm connection. */
  attach (conn: any): void {
    const mux = Protomux.from(conn)
    const entry: Entry = { conn, channel: null, message: null, proof: null, replicating: false, unproven: false, sent: false }
    this.entries.add(entry)
    // Come per i documenti (src/net/file-share.ts): se il peer apre il canale per primo lo creiamo
    // in risposta (`pair`), e intanto proviamo ad aprirlo noi. Senza `pair`, un'apertura arrivata
    // quando l'altro lato non era pronto veniva rifiutata: nessuna prova, nessuna replica (trovato
    // nei test del cambio di rete).
    // EN: As for documents (src/net/file-share.ts): if the peer opens the channel first we create
    //     it in response (`pair`), and meanwhile we try to open it ourselves. Without `pair`, an
    //     open arriving when the other side wasn't ready was rejected: no proof, no replication
    //     (found in the network switch tests).
    mux.pair({ protocol: PROTOCOL }, () => this.openChannel(entry))
    // E se l'apertura si perde comunque (aperture incrociate durante il riallacciamento dopo un
    // cambio di rete), si riprova ogni secondo finché il canale non è aperto, per al massimo 30 s
    // EN: And if the open gets lost anyway (crossed opens while reconnecting after a network
    //     switch), retry every second until the channel is open, for at most 30 s
    let tries = 0
    const retry = setInterval(() => {
      if (entry.channel?.opened || ++tries > 30 || !this.entries.has(entry)) { clearInterval(retry); return }
      this.openChannel(entry)
    }, 1000)
    retry.unref()
    conn.once('close', () => { clearInterval(retry); this.entries.delete(entry); mux.unpair({ protocol: PROTOCOL }) })
    this.openChannel(entry)
    this.decide(entry).catch((e) => this.deps.log(`cancello: ${(e as Error).message}`))
  }

  /** Crea e apre il canale della prova, se non c'è già. / EN: Creates and opens the proof channel, if it isn't there yet. */
  private openChannel (entry: Entry): void {
    const mux = Protomux.from(entry.conn)
    const channel = mux.createChannel({
      protocol: PROTOCOL,
      unique: true,
      // Dentro `onopen` il canale non risulta ancora aperto: la prova parte subito dopo
      // EN: Inside `onopen` the channel doesn't look open yet: the proof goes right after
      onopen: () => { entry.sent = false; setImmediate(() => this.sendProof(entry)) },
      onclose: () => { if (entry.channel === channel) { entry.channel = null; entry.message = null } }
    })
    if (!channel) return // già aperto su questa connessione / EN: already open on this connection
    entry.channel = channel
    entry.message = channel.addMessage({
      encoding: c.json,
      onmessage: (m: unknown) => { this.onProof(entry, m).catch((e) => this.deps.log(`prova di appartenenza: ${(e as Error).message}`)) }
    })
    channel.open()
  }

  /**
   * Il registro è cambiato (membri, protezione) o il nodo è diventato writer: si rimanda la prova a
   * chi non l'ha ancora avuta e si riesaminano tutte le connessioni.
   *
   * EN: The log changed (members, protection) or the node became a writer: the proof is sent to
   * whoever hasn't had it yet and every connection is re-examined.
   */
  recheck (): Promise<void> {
    this.rechecking = this.rechecking.then(async () => {
      for (const e of [...this.entries]) {
        this.sendProof(e)
        await this.decide(e).catch(() => {})
      }
    })
    return this.rechecking
  }

  /** Connessioni con la replica agganciata (per i test e la diagnostica). / EN: Connections with replication attached (for tests and diagnostics). */
  get replicating (): number {
    return [...this.entries].filter((e) => e.replicating).length
  }

  private sendProof (entry: Entry): void {
    if (entry.sent || !entry.message || !entry.channel?.opened) return
    const me = this.deps.localWriter()
    if (!me) return
    const sig = crypto.sign(memberPayload(entry.conn.handshakeHash), me.secretKey)
    entry.message.send({ writer: b4a.toString(me.memberKey, 'hex'), signer: b4a.toString(me.publicKey, 'hex'), sig: b4a.toString(sig, 'hex') })
    entry.sent = true
  }

  private async onProof (entry: Entry, m: unknown): Promise<void> {
    if (!validProof(entry.conn.handshakeHash, m)) {
      this.deps.log('prova di appartenenza non valida: ignorata')
      return
    }
    entry.proof = { writer: m.writer, signer: m.signer, sig: m.sig }
    await this.decide(entry)
  }

  /** Aggancia, aspetta o stacca una connessione. / EN: Attaches, waits for or drops a connection. */
  private async decide (entry: Entry): Promise<void> {
    await this.deps.ready()
    if (!this.entries.has(entry)) return
    const strict = await this.deps.strict()
    const writer = this.deps.localWriter() !== null
    const member = entry.proof ? await this.deps.isActiveMember(entry.proof.writer) : false
    if (!strict || !writer) {
      // Come prima della 0.7.0 / EN: As before 0.7.0
      this.start(entry, !member)
      return
    }
    if (member) {
      entry.unproven = false
      this.start(entry, false)
      return
    }
    // Protezione accesa e nessuna prova valida di un membro attivo: se la replica era già
    // agganciata (protezione appena accesa, o membro appena rimosso) la connessione si chiude.
    // EN: Protection on and no valid proof from an active member: if replication was already
    //     attached (protection just turned on, or member just removed) the connection is closed.
    if (entry.replicating) {
      this.deps.log(`connessione chiusa: il peer non è un membro attivo${entry.proof ? ` (${entry.proof.writer.slice(0, 8)})` : ''}`)
      entry.conn.destroy()
    }
  }

  private start (entry: Entry, unproven: boolean): void {
    entry.unproven = unproven
    if (entry.replicating) return
    entry.replicating = true
    this.deps.replicate(entry.conn)
  }
}
