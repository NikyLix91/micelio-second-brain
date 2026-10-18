/**
 * @file Identità personale (B3): chi sei, uguale in tutti i team a cui partecipi da questo PC.
 *
 * Perché serve. In un team ogni nodo è identificato dalla chiave del suo feed (il "writer"
 * dell'Autobase), che è diversa in ogni team: è giusto così, perché un team non deve poter
 * collegare i tuoi feed a quelli di un altro team. Ma con più team la stessa persona compare
 * più volte, e senza un legame non si capisce che "Ada" nel team A e "Ada" nel team B sono la
 * stessa persona (o che non lo sono, se due colleghi hanno lo stesso nome).
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
 * Il file va protetto come state.json: chi lo copia può firmare al posto tuo.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import { z } from 'zod'

const hex = (b: Uint8Array) => b4a.toString(b, 'hex') as string

/** Contenuto di identity.json. */
const Identity = z.object({
  /** Nome con cui ti presenti ai team (modificabile per singolo team all'ingresso). */
  name: z.string().min(1).max(100),
  /** Chiave pubblica Ed25519 (hex, 32 byte): l'identificativo della persona. */
  publicKey: z.string().regex(/^[0-9a-f]{64}$/),
  /** Chiave segreta Ed25519 (hex, 64 byte). Non lascia mai il PC. */
  secretKey: z.string().regex(/^[0-9a-f]{128}$/)
})
export type Identity = z.infer<typeof Identity>

/**
 * Prefisso del messaggio firmato: "dominio" della firma, così una firma fatta per questo scopo
 * non vale per nessun altro.
 */
const DOMAIN = 'micelio/person/v1:'

/** Messaggio firmato per legare il feed `writerKeyHex` di un team alla persona. */
function message (writerKeyHex: string): Uint8Array {
  return b4a.from(DOMAIN + writerKeyHex.toLowerCase())
}

/** Legge identity.json; null se manca o non è valido. */
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
 */
export function ensureIdentity (file: string, name: string): Identity {
  const existing = loadIdentity(file)
  if (existing) return existing
  const kp = crypto.keyPair()
  const id: Identity = { name, publicKey: hex(kp.publicKey), secretKey: hex(kp.secretKey) }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // 0o600: leggibile solo dall'utente (su Windows valgono le ACL del profilo, vedi config.ts)
  fs.writeFileSync(file, JSON.stringify(id, null, 2), { mode: 0o600 })
  return id
}

/** Firma il legame fra la persona e il feed di un team. */
export function signMembership (identity: Identity, writerKeyHex: string): string {
  return hex(crypto.sign(message(writerKeyHex), b4a.from(identity.secretKey, 'hex')))
}

/**
 * Verifica che `person` abbia davvero firmato il legame con il feed `writerKeyHex`.
 * Deterministica (nessun orologio, nessuna rete): si può usare in apply.
 */
export function verifyMembership (person: string, writerKeyHex: string, signature: string): boolean {
  try {
    return crypto.verify(message(writerKeyHex), b4a.from(signature, 'hex'), b4a.from(person, 'hex'))
  } catch {
    return false
  }
}
