/**
 * @file Identità personale (B3): chi sei, uguale in tutti i team a cui partecipi da questo PC.
 *
 * EN: Personal identity (B3): who you are, the same in every team you join from this PC.
 *
 * Perché serve. In un team ogni nodo è identificato dalla chiave del suo feed (il "writer"
 * dell'Autobase), che è diversa in ogni team: è giusto così, perché un team non deve poter
 * collegare i tuoi feed a quelli di un altro team. Ma con più team la stessa persona compare
 * più volte, e senza un legame non si capisce che "Ada" nel team A e "Ada" nel team B sono la
 * stessa persona (o che non lo sono, se due colleghi hanno lo stesso nome).
 *
 * EN: Why it's needed. In a team each node is identified by the key of its feed (the Autobase
 * "writer"), which differs in every team: that's intended, because a team must not be able to
 * link your feeds to those of another team. But with several teams the same person shows up
 * several times, and without a link you can't tell that "Ada" in team A and "Ada" in team B are
 * the same person (or that they aren't, if two colleagues share a name).
 *
 * Come funziona.
 * - Al primo `init`/`join` nasce `identity.json`: un nome e una coppia di chiavi Ed25519.
 *   La chiave SEGRETA non lascia mai il PC.
 * - In ogni team il nodo pubblica un evento `member.identity` con la chiave PUBBLICA della
 *   persona e una FIRMA, fatta con la chiave segreta, sulla chiave del proprio feed in quel team.
 * - Chiunque nel team verifica la firma (in apply, src/net/apply.ts): nessuno può attribuire il
 *   proprio feed all'identità di un altro, né copiare l'evento di un altro team (la firma copre
 *   la chiave del feed, che è diversa in ogni team).
 * - Un membro di due team vede quindi che una persona del team A è la stessa del team B solo se
 *   anche lui è in entrambi: chi è in un solo team vede una chiave pubblica e basta.
 *
 * EN: How it works.
 * - On the first `init`/`join` `identity.json` is created: a name and an Ed25519 key pair.
 *   The SECRET key never leaves the PC.
 * - In every team the node publishes a `member.identity` event with the person's PUBLIC key
 *   and a SIGNATURE, made with the secret key, over its own feed key in that team.
 * - Anyone in the team verifies the signature (in apply, src/net/apply.ts): nobody can assign
 *   their own feed to someone else's identity, nor copy the event from another team (the
 *   signature covers the feed key, which differs in every team).
 * - So a member of two teams sees that a person in team A is the same as in team B only if
 *   they are in both: someone in a single team just sees a public key.
 *
 * Il file va protetto come state.json: chi lo copia può firmare al posto tuo.
 *
 * EN: The file must be protected like state.json: whoever copies it can sign on your behalf.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import { z } from 'zod'

const hex = (b: Uint8Array) => b4a.toString(b, 'hex') as string

/** Contenuto di identity.json. / EN: Content of identity.json. */
const Identity = z.object({
  /** Nome con cui ti presenti ai team (modificabile per singolo team all'ingresso). / EN: Name you introduce yourself with to teams (can be changed per team when joining). */
  name: z.string().min(1).max(100),
  /** Chiave pubblica Ed25519 (hex, 32 byte): l'identificativo della persona. / EN: Ed25519 public key (hex, 32 bytes): the person's identifier. */
  publicKey: z.string().regex(/^[0-9a-f]{64}$/),
  /** Chiave segreta Ed25519 (hex, 64 byte). Non lascia mai il PC. / EN: Ed25519 secret key (hex, 64 bytes). It never leaves the PC. */
  secretKey: z.string().regex(/^[0-9a-f]{128}$/)
})
export type Identity = z.infer<typeof Identity>

/**
 * Prefisso del messaggio firmato: "dominio" della firma, così una firma fatta per questo scopo
 * non vale per nessun altro.
 *
 * EN: Prefix of the signed message: the signature "domain", so a signature made for this purpose
 * is not valid for any other.
 */
const DOMAIN = 'micelio/person/v1:'

/** Messaggio firmato per legare il feed `writerKeyHex` di un team alla persona. / EN: Signed message binding a team's `writerKeyHex` feed to the person. */
function message (writerKeyHex: string): Uint8Array {
  return b4a.from(DOMAIN + writerKeyHex.toLowerCase())
}

/** Legge identity.json; null se manca o non è valido. / EN: Reads identity.json; null if missing or invalid. */
export function loadIdentity (file: string): Identity | null {
  try {
    const parsed = Identity.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Restituisce l'identità esistente o ne crea una nuova con il nome indicato.
 * Se esiste già, il nome NON cambia: un nome diverso in un team vale solo per quel team.
 *
 * EN: Returns the existing identity or creates a new one with the given name.
 * If it already exists, the name does NOT change: a different name in a team applies only to that team.
 */
export function ensureIdentity (file: string, name: string): Identity {
  const existing = loadIdentity(file)
  if (existing) return existing
  const kp = crypto.keyPair()
  const id: Identity = { name, publicKey: hex(kp.publicKey), secretKey: hex(kp.secretKey) }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // 0o600: leggibile solo dall'utente (su Windows valgono le ACL del profilo, vedi config.ts)
  // EN: 0o600: readable only by the user (on Windows the profile ACLs apply, see config.ts)
  fs.writeFileSync(file, JSON.stringify(id, null, 2), { mode: 0o600 })
  return id
}

/** Firma il legame fra la persona e il feed di un team. / EN: Signs the binding between the person and a team feed. */
export function signMembership (identity: Identity, writerKeyHex: string): string {
  return hex(crypto.sign(message(writerKeyHex), b4a.from(identity.secretKey, 'hex')))
}

/**
 * Verifica che `person` abbia davvero firmato il legame con il feed `writerKeyHex`.
 * Deterministica (nessun orologio, nessuna rete): si può usare in apply.
 *
 * EN: Checks that `person` really signed the binding with the `writerKeyHex` feed.
 * Deterministic (no clock, no network): it can be used in apply.
 */
export function verifyMembership (person: string, writerKeyHex: string, signature: string): boolean {
  try {
    return crypto.verify(message(writerKeyHex), b4a.from(signature, 'hex'), b4a.from(person, 'hex'))
  } catch {
    return false
  }
}

// ── Ricevuta di redazione (B12) ─────────────────────────────────────────────────────
// EN: ── Redaction receipt (B12) ──

/** Dominio delle conferme di redazione: una firma di appartenenza non vale come conferma. / EN: Domain of redaction confirmations: a membership signature doesn't count as a confirmation. */
const ACK_DOMAIN = 'micelio/redact-ack/v1:'

/**
 * Testo firmato da una persona per confermare di aver tolto un ricordo redatto dal proprio PC:
 * ricordo, feed del nodo nel team e istante. È lo stesso testo che compare nella ricevuta, così
 * chiunque può verificare la firma con la chiave pubblica della persona.
 *
 * EN: Text signed by a person to confirm they removed a redacted memory from their PC: memory,
 * the node's feed in the team and time. It's the same text shown in the receipt, so anyone can
 * verify the signature with the person's public key.
 */
export function redactAckMessage (memoryId: string, writerKeyHex: string, ts: number): string {
  return `${ACK_DOMAIN}${memoryId.toLowerCase()}:${writerKeyHex.toLowerCase()}:${ts}`
}

/** Firma una conferma di redazione con l'identità personale. / EN: Signs a redaction confirmation with the personal identity. */
export function signRedactAck (identity: Identity, memoryId: string, writerKeyHex: string, ts: number): string {
  return hex(crypto.sign(b4a.from(redactAckMessage(memoryId, writerKeyHex, ts)), b4a.from(identity.secretKey, 'hex')))
}

/** Verifica una conferma di redazione (puro calcolo: usabile anche in apply). / EN: Verifies a redaction confirmation (pure computation: usable in apply too). */
export function verifyRedactAck (person: string, memoryId: string, writerKeyHex: string, ts: number, signature: string): boolean {
  try {
    return crypto.verify(b4a.from(redactAckMessage(memoryId, writerKeyHex, ts)), b4a.from(signature, 'hex'), b4a.from(person, 'hex'))
  } catch {
    return false
  }
}
