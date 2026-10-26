/**
 * @file Cifratura del contenuto per generazione (0.7.0): primitive pure, senza rete né vista.
 *
 * EN: Per-generation content encryption (0.7.0): pure primitives, no network and no view.
 *
 * Il team ha una catena di CHIAVI DI GENERAZIONE (32 byte casuali ciascuna). Il contenuto dei
 * ricordi si cifra con la chiave della generazione corrente (XSalsa20-Poly1305, `secretbox` di
 * libsodium) e viaggia come TESTO SIGILLATO: `mc1:<generazione>:<nonce>:<cifrato>` in base64.
 * Ogni chiave di generazione viene consegnata a ogni membro attivo cifrandola con la sua chiave
 * pubblica X25519 (`crypto_box_seal`): solo quel membro la apre. Chi è stato rimosso non riceve la
 * chiave delle generazioni successive alla sua rimozione.
 *
 * EN: The team has a chain of GENERATION KEYS (32 random bytes each). Memory content is encrypted
 * with the current generation's key (XSalsa20-Poly1305, libsodium `secretbox`) and travels as
 * SEALED TEXT: `mc1:<generation>:<nonce>:<ciphertext>` in base64. Every generation key is handed
 * to every active member by encrypting it with their X25519 public key (`crypto_box_seal`): only
 * that member opens it. Whoever was removed doesn't get the keys of the generations after their
 * removal.
 *
 * La chiave X25519 di un membro si ricava dalla coppia Ed25519 che il Corestore del nodo genera in
 * modo deterministico (`store.createKeyPair('micelio-box')`): nessun file segreto in più, e la
 * stessa chiave a ogni avvio.
 *
 * EN: A member's X25519 key is derived from the Ed25519 pair that the node's Corestore generates
 * deterministically (`store.createKeyPair('micelio-box')`): no extra secret file, and the same key
 * at every start.
 *
 * Catena: ogni generazione porta anche la chiave PRECEDENTE cifrata con la nuova (`prev`). Chi ha
 * la chiave più recente risale a tutte le altre, quindi a chi entra basta consegnare l'ultima.
 *
 * EN: Chain: every generation also carries the PREVIOUS key encrypted with the new one (`prev`).
 * Whoever has the latest key can walk back to all the others, so a newcomer only needs the last one.
 */
import sodium from 'sodium-universal'

/** Prefisso del testo sigillato (versione 1 del formato). / EN: Prefix of sealed text (format version 1). */
export const SEALED_PREFIX = 'mc1:'
/** Forma di un testo sigillato. / EN: Shape of a sealed text. */
export const SEALED_RE = /^mc1:\d{1,9}:[A-Za-z0-9+/=]{32}:[A-Za-z0-9+/=]+$/

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
const unb64 = (s: string) => Buffer.from(s, 'base64')

/** true se la stringa è un testo sigillato. / EN: true if the string is a sealed text. */
export function isSealed (s: unknown): s is string {
  return typeof s === 'string' && s.startsWith(SEALED_PREFIX)
}

/** Nuova chiave di generazione casuale. / EN: New random generation key. */
export function newGenerationKey (): Buffer {
  const k = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES)
  sodium.randombytes_buf(k)
  return k
}

/** Cifra un testo con la chiave di una generazione. / EN: Encrypts a text with a generation's key. */
export function seal (gen: number, key: Uint8Array, text: string): string {
  const nonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES)
  sodium.randombytes_buf(nonce)
  const msg = Buffer.from(text, 'utf8')
  const out = Buffer.alloc(msg.length + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(out, msg, nonce, key)
  return `${SEALED_PREFIX}${gen}:${b64(nonce)}:${b64(out)}`
}

/** Generazione di un testo sigillato (null se il formato non torna). / EN: Generation of a sealed text (null if the format doesn't match). */
export function sealedGeneration (s: string): number | null {
  if (!SEALED_RE.test(s)) return null
  return Number(s.split(':')[1])
}

/**
 * Apre un testo sigillato con la chiave della sua generazione.
 *
 * EN: Opens a sealed text with its generation's key.
 * @returns il testo, o null se la chiave è sbagliata o il testo è stato manomesso
 *          EN: the text, or null if the key is wrong or the text was tampered with
 */
export function open (sealed: string, key: Uint8Array): string | null {
  if (!SEALED_RE.test(sealed)) return null
  const [, , n, c] = sealed.split(':')
  const nonce = unb64(n)
  const cipher = unb64(c)
  if (nonce.length !== sodium.crypto_secretbox_NONCEBYTES || cipher.length < sodium.crypto_secretbox_MACBYTES) return null
  const out = Buffer.alloc(cipher.length - sodium.crypto_secretbox_MACBYTES)
  return sodium.crypto_secretbox_open_easy(out, cipher, nonce, key) ? out.toString('utf8') : null
}

/** Coppia X25519 di un membro, ricavata dalla sua coppia Ed25519. / EN: A member's X25519 pair, derived from their Ed25519 pair. */
export interface BoxKeyPair { publicKey: Buffer, secretKey: Buffer }

export function boxKeyPairFrom (ed: { publicKey: Uint8Array, secretKey: Uint8Array }): BoxKeyPair {
  const publicKey = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES)
  const secretKey = Buffer.alloc(sodium.crypto_box_SECRETKEYBYTES)
  sodium.crypto_sign_ed25519_pk_to_curve25519(publicKey, ed.publicKey)
  sodium.crypto_sign_ed25519_sk_to_curve25519(secretKey, ed.secretKey)
  return { publicKey, secretKey }
}

/** Consegna una chiave a un membro: solo il proprietario della chiave pubblica la apre. / EN: Hands a key to a member: only the owner of the public key opens it. */
export function grantTo (boxPublicKey: Uint8Array, key: Uint8Array): string {
  const out = Buffer.alloc(key.length + sodium.crypto_box_SEALBYTES)
  sodium.crypto_box_seal(out, key, boxPublicKey)
  return b64(out)
}

/** Apre una consegna destinata a noi (null se non è per noi o è manomessa). / EN: Opens a grant meant for us (null if it isn't for us or was tampered with). */
export function openGrant (grant: string, box: BoxKeyPair): Buffer | null {
  const c = unb64(grant)
  if (c.length !== sodium.crypto_secretbox_KEYBYTES + sodium.crypto_box_SEALBYTES) return null
  const out = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES)
  return sodium.crypto_box_seal_open(out, c, box.publicKey, box.secretKey) ? out : null
}

/** La chiave precedente, cifrata con la nuova (anello della catena). / EN: The previous key, encrypted with the new one (a link of the chain). */
export function chainLink (newGen: number, newKey: Uint8Array, prevKey: Uint8Array): string {
  return seal(newGen, newKey, Buffer.from(prevKey).toString('base64'))
}

/** Apre un anello della catena: la chiave della generazione precedente. / EN: Opens a link of the chain: the previous generation's key. */
export function openChainLink (link: string, newKey: Uint8Array): Buffer | null {
  const t = open(link, newKey)
  if (t === null) return null
  const k = Buffer.from(t, 'base64')
  return k.length === sodium.crypto_secretbox_KEYBYTES ? k : null
}
