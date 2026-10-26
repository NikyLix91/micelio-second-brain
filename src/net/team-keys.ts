/**
 * @file Portachiavi del team su questo nodo (protezione completa, 0.7.0).
 *
 * EN: The team's keyring on this node (full protection, 0.7.0).
 *
 * Tiene in memoria le chiavi di generazione che questo nodo sa aprire (mai su disco: si
 * ricavano a ogni avvio dalle consegne nella vista, con la chiave X25519 del nodo), cifra quello
 * che il nodo scrive e decifra quello che legge. Le primitive sono in src/core/team-crypto.ts.
 *
 * EN: It keeps in memory the generation keys this node can open (never on disk: they are derived at
 * every start from the grants in the view, with the node's X25519 key), encrypts what the node
 * writes and decrypts what it reads. The primitives are in src/core/team-crypto.ts.
 *
 * Cosa si cifra (il resto è protetto dalla cifratura del registro e dal cancello delle connessioni):
 * - il contenuto dei ricordi (titolo, testo, tag, sorgente) in `memory.add` e `memory.supersede`;
 * - la domanda delle lacune (`gap.report`), il motivo delle segnalazioni delle Radici
 *   (`root.flag`) e il riassunto dei sogni (`dream.complete`), che possono citare il contenuto.
 * Restano in chiaro id, tipi, autori, date, voti, ruoli e nomi: servono a chi applica gli eventi,
 * che deve dare lo stesso risultato su ogni nodo senza aprire niente.
 *
 * EN: What gets encrypted (the rest is protected by the log encryption and the connection gate):
 * - memory content (title, body, tags, source) in `memory.add` and `memory.supersede`;
 * - the question of gaps (`gap.report`), the reason of Root flags (`root.flag`) and the dream
 *   summary (`dream.complete`), which may quote the content.
 * Ids, kinds, authors, dates, votes, roles and names stay in clear: whoever applies the events
 * needs them, and must get the same result on every node without opening anything.
 */
import { memoryId, type EventPayload } from '../core/events'
import type { KeyGeneration } from '../core/model'
import { type BoxKeyPair, chainLink, fingerprint, grantTo, isSealed, newGenerationKey, open, openChainLink, openGrant, seal, sealedFingerprint } from '../core/team-crypto'

/** Testo mostrato al posto di un contenuto che questo nodo non sa aprire. / EN: Text shown instead of content this node can't open. */
export const LOCKED_TEXT = '[cifrato: chiave non disponibile su questo nodo]'

export class TeamKeys {
  /** Impronta → chiave: tutte quelle che questo nodo sa aprire, anche delle rotazioni perdenti. / EN: Fingerprint → key: every key this node can open, including losing rotations. */
  private keys = new Map<string, Buffer>()
  /** Generazione → chiave VINCENTE (quella con cui si scrive). / EN: Generation → WINNING key (the one used to write). */
  private winners = new Map<number, Buffer>()
  private currentGen = 0

  /**
   * @param box coppia X25519 di questo nodo
   *        EN: this node's X25519 pair
   * @param me feed (hex) di questo nodo nel team
   *        EN: this node's feed (hex) in the team
   */
  constructor (readonly box: BoxKeyPair, private readonly me: () => string | null) {}

  /**
   * Ricalcola da zero le chiavi dalla vista: apre le consegne per questo nodo, delle generazioni
   * vincenti e delle rotazioni perdenti (`alternates`), e risale la catena (`prev`) delle vincenti.
   * Da zero perché un riordino del registro può cambiare quale rotazione ha vinto: nessuna chiave
   * resta in memoria per una generazione sbagliata.
   *
   * EN: Recomputes the keys from scratch from the view: opens the grants for this node, of the
   * winning generations and of the losing rotations (`alternates`), and walks the chain (`prev`)
   * of the winning ones. From scratch because a reorder of the log can change which rotation won:
   * no key stays in memory for the wrong generation.
   */
  refresh (generations: KeyGeneration[], current: number, alternates: KeyGeneration[] = []): void {
    this.currentGen = current
    const me = this.me()
    const keys = new Map<string, Buffer>()
    const winners = new Map<number, Buffer>()
    const mine = (g: KeyGeneration) => {
      const grant = me ? g.grants[me] : undefined
      return grant ? openGrant(grant, this.box) : null
    }
    for (const g of alternates) {
      const key = mine(g)
      if (key) keys.set(fingerprint(key), key)
    }
    const byGen = new Map(generations.map((g) => [g.gen, g]))
    for (const g of generations) {
      const key = mine(g)
      if (key) { winners.set(g.gen, key); keys.set(fingerprint(key), key) }
    }
    // Catena: dalla più alta nota si scende finché ci sono anelli
    // EN: Chain: from the highest known one we go down while there are links
    for (let gen = Math.max(0, ...winners.keys()); gen > 1; gen--) {
      const key = winners.get(gen)
      const link = byGen.get(gen)?.prev
      if (!key || !link || winners.has(gen - 1)) continue
      const prev = openChainLink(link, key)
      if (prev) { winners.set(gen - 1, prev); keys.set(fingerprint(prev), prev) }
    }
    this.keys = keys
    this.winners = winners
  }

  /** Generazione corrente del team e se questo nodo ne ha la chiave. / EN: The team's current generation and whether this node holds its key. */
  get current (): { gen: number, ready: boolean } {
    return { gen: this.currentGen, ready: this.winners.has(this.currentGen) }
  }

  /** Quante chiavi questo nodo sa aprire. / EN: How many keys this node can open. */
  get count (): number {
    return this.keys.size
  }

  hasKey (gen: number): boolean {
    return this.winners.has(gen)
  }

  /** Apre un testo sigillato con la chiave della sua impronta; LOCKED_TEXT se manca. / EN: Opens a sealed text with its fingerprint's key; LOCKED_TEXT if missing. */
  openText (s: string): string {
    const fp = sealedFingerprint(s)
    const key = fp === null ? undefined : this.keys.get(fp)
    return (key && open(s, key)) ?? LOCKED_TEXT
  }

  /**
   * Apre tutti i testi sigillati di un valore letto dalla vista. Un ricordo cifrato (`sealed`)
   * torna con titolo, testo, tag e sorgente; se non si apre resta `locked: true`.
   *
   * EN: Opens every sealed text of a value read from the view. An encrypted memory (`sealed`)
   * comes back with title, body, tags and source; if it can't be opened it stays `locked: true`.
   */
  openDeep<T> (value: T): T {
    if (typeof value === 'string') return (isSealed(value) ? this.openText(value) : value) as T
    if (Array.isArray(value)) return value.map((v) => this.openDeep(v)) as T
    if (!value || typeof value !== 'object') return value
    const obj = value as Record<string, unknown>
    if (typeof obj.sealed === 'string') {
      const { sealed, ...rest } = obj
      const text = this.openText(sealed)
      if (text === LOCKED_TEXT) return { ...rest, title: LOCKED_TEXT, locked: true } as T
      try {
        const m = JSON.parse(text) as Record<string, unknown>
        return { ...rest, title: m.title, body: m.body, tags: m.tags ?? [], source: m.source ?? rest.source } as T
      } catch {
        return { ...rest, title: LOCKED_TEXT, locked: true } as T
      }
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) out[k] = this.openDeep(v)
    return out as T
  }

  /**
   * Cifra un evento prima di scriverlo, con la chiave della generazione corrente. Gli eventi senza
   * contenuto da proteggere passano così come sono.
   *
   * EN: Encrypts an event before writing it, with the current generation's key. Events without
   * content to protect pass as they are.
   * @throws se il team ha una generazione ma questo nodo non ne ha ancora la chiave
   *         EN: if the team has a generation but this node doesn't hold its key yet
   */
  sealEvent (p: EventPayload): EventPayload {
    if (!needsSealing(p)) return p
    const key = this.winners.get(this.currentGen)
    if (!key) throw new Error('Chiave del team non ancora ricevuta: un membro online la consegna entro pochi secondi')
    const s = (t: string) => seal(this.currentGen, key, t)
    switch (p.type) {
      case 'memory.add':
      case 'memory.supersede': {
        const m = p.memory
        if ('sealed' in m) return p
        const id = memoryId({ kind: m.kind ?? 'fact', title: m.title, body: m.body })
        return { ...p, id, memory: { kind: m.kind ?? 'fact', sealed: s(JSON.stringify({ title: m.title, body: m.body, tags: m.tags, source: m.source })) } } as EventPayload
      }
      case 'gap.report': return isSealed(p.question) ? p : { ...p, question: s(p.question) }
      case 'root.flag': return isSealed(p.reason) ? p : { ...p, reason: s(p.reason) }
      case 'dream.complete': return isSealed(p.summary) ? p : { ...p, summary: s(p.summary) }
      default: return p
    }
  }

  /**
   * Prepara una nuova generazione (rotazione): chiave nuova, consegnata a ogni membro con chiave
   * pubblica nota, e anello verso la precedente. Serve la chiave della generazione corrente,
   * altrimenti la storia resterebbe illeggibile ai membri futuri.
   *
   * EN: Prepares a new generation (rotation): a new key, handed to every member with a known public
   * key, and a link to the previous one. The current generation's key is required, otherwise the
   * history would stay unreadable to future members.
   * @param recipients feed (hex) → chiave pubblica X25519 (hex) dei membri attivi
   *        EN: feed (hex) → X25519 public key (hex) of the active members
   */
  newGeneration (recipients: Record<string, string>): { gen: number, grants: Record<string, string>, prev?: string } {
    const gen = this.currentGen + 1
    const prevKey = this.winners.get(this.currentGen)
    if (this.currentGen > 0 && !prevKey) throw new Error('Per cambiare la chiave serve quella attuale, che questo nodo non ha ancora')
    const key = newGenerationKey()
    const grants: Record<string, string> = {}
    for (const [writer, pk] of Object.entries(recipients)) grants[writer] = grantTo(Buffer.from(pk, 'hex'), key)
    return { gen, grants, ...(prevKey ? { prev: chainLink(gen, key, prevKey) } : {}) }
  }

  /** Consegne della chiave corrente per membri che non l'hanno. / EN: Grants of the current key for members who lack it. */
  grantsFor (recipients: Record<string, string>): Record<string, string> {
    const key = this.winners.get(this.currentGen)
    if (!key) return {}
    const grants: Record<string, string> = {}
    for (const [writer, pk] of Object.entries(recipients)) grants[writer] = grantTo(Buffer.from(pk, 'hex'), key)
    return grants
  }
}

/** Eventi con contenuto da cifrare. / EN: Events with content to encrypt. */
function needsSealing (p: EventPayload): boolean {
  return p.type === 'memory.add' || p.type === 'memory.supersede' || p.type === 'gap.report' || p.type === 'root.flag' || p.type === 'dream.complete'
}
