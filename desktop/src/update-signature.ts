/**
 * @file Verifica della firma Ed25519 di un aggiornamento (B13 fase 4).
 *
 * EN: Verification of an update's Ed25519 signature (B13 phase 4).
 *
 * PERCHÉ. electron-updater controlla che il file scaricato abbia lo SHA-512 scritto in
 * `latest.yml`: protegge da un download rotto, non da chi riesce a cambiare i file della release
 * (cambierebbe anche `latest.yml`). La nostra firma la fa il workflow di release con una chiave
 * privata che sta solo in un segreto di GitHub; la chiave pubblica è dentro l'app
 * (update-keys.ts). Senza firma valida l'aggiornamento non si installa.
 *
 * EN: WHY. electron-updater checks that the downloaded file has the SHA-512 written in
 * `latest.yml`: it protects against a broken download, not against someone able to change the
 * release files (they would change `latest.yml` too). Our signature is made by the release
 * workflow with a private key that lives only in a GitHub secret; the public key is inside the
 * app (update-keys.ts). Without a valid signature the update isn't installed.
 *
 * FORMATO. Accanto a ogni pacchetto, `<file>.sig` è un JSON:
 *   { "v": 1, "file": "Micelio-Setup-0.8.0.exe", "version": "0.8.0", "sha256": "<hex>",
 *     "keyId": "<16 hex>", "sig": "<base64>" }
 * La firma copre la stringa `micelio-update:v1:<file>:<version>:<sha256>`: nome e versione dentro
 * la firma impediscono di spacciare un pacchetto vecchio (firmato davvero) per una versione nuova.
 * La stessa stringa la produce scripts/update-signing.js; un test controlla che i due lati
 * coincidano.
 *
 * EN: FORMAT. Next to every package, `<file>.sig` is a JSON:
 *   { "v": 1, "file": "Micelio-Setup-0.8.0.exe", "version": "0.8.0", "sha256": "<hex>",
 *     "keyId": "<16 hex>", "sig": "<base64>" }
 * The signature covers the string `micelio-update:v1:<file>:<version>:<sha256>`: name and version
 * inside the signature prevent passing off an old package (genuinely signed) as a new version.
 * scripts/update-signing.js produces the same string; a test checks that the two sides match.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'

/** Una chiave pubblica accettata: id breve (da keyId) e chiave in PEM (SPKI). / EN: An accepted public key: short id (from keyId) and key in PEM (SPKI). */
export interface UpdateKey { id: string, pem: string }

/** Contenuto di un file `.sig`. / EN: Content of a `.sig` file. */
export interface UpdateSignature { v: 1, file: string, version: string, sha256: string, keyId: string, sig: string }

/** La stringa firmata. / EN: The signed string. */
export const signedPayload = (file: string, version: string, sha256: string): string =>
  `micelio-update:v1:${file}:${version}:${sha256}`

/** Id di una chiave pubblica: i primi 8 byte (16 hex) dello SHA-256 della chiave in DER. / EN: Id of a public key: the first 8 bytes (16 hex) of the SHA-256 of the DER key. */
export function keyId (pem: string): string {
  const der = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' })
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16)
}

/** Le chiavi di update-keys.ts con il loro id, calcolato e non scritto a mano. / EN: The keys of update-keys.ts with their id, computed rather than written by hand. */
export const withIds = (pems: string[]): UpdateKey[] => pems.map((pem) => ({ id: keyId(pem), pem }))

/** SHA-256 di un file, a pezzi (un installer pesa centinaia di MB). / EN: SHA-256 of a file, in chunks (an installer weighs hundreds of MB). */
export async function sha256File (file: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Errore di verifica, con un codice per i messaggi nelle due lingue. / EN: Verification error, with a code for the messages in both languages. */
export class UpdateSignatureError extends Error {
  constructor (readonly code: 'malformed' | 'mismatch' | 'unknown-key' | 'bad-signature' | 'hash', message: string) {
    super(message)
  }
}

/**
 * Controlla che `file` sia il pacchetto `expected.file` della versione `expected.version`, firmato
 * da una delle `keys`. Lancia UpdateSignatureError se qualcosa non torna; non restituisce nulla
 * se va tutto bene.
 *
 * EN: Checks that `file` is the package `expected.file` of version `expected.version`, signed by
 * one of the `keys`. Throws UpdateSignatureError if anything is off; returns nothing if all is well.
 * @param sigText contenuto del file `.sig` (testo scaricato, non fidato)
 *        EN: content of the `.sig` file (downloaded text, untrusted)
 */
export async function verifyUpdate (file: string, sigText: string, expected: { file: string, version: string }, keys: UpdateKey[]): Promise<void> {
  let s: UpdateSignature
  try {
    s = JSON.parse(sigText)
  } catch {
    throw new UpdateSignatureError('malformed', 'signature file is not valid JSON')
  }
  if (s?.v !== 1 || typeof s.file !== 'string' || typeof s.version !== 'string' || typeof s.sha256 !== 'string' ||
      typeof s.keyId !== 'string' || typeof s.sig !== 'string' || !/^[0-9a-f]{64}$/.test(s.sha256)) {
    throw new UpdateSignatureError('malformed', 'signature file has an unexpected shape')
  }
  // Prima i campi dichiarati, poi la firma: la firma copre proprio questi valori
  // EN: First the declared fields, then the signature: the signature covers exactly these values
  if (s.file !== expected.file || s.version !== expected.version) {
    throw new UpdateSignatureError('mismatch', `signature is for ${s.file} ${s.version}, expected ${expected.file} ${expected.version}`)
  }
  const key = keys.find((k) => k.id === s.keyId)
  if (!key) throw new UpdateSignatureError('unknown-key', `signed with unknown key ${s.keyId}`)
  const ok = crypto.verify(null, Buffer.from(signedPayload(s.file, s.version, s.sha256)), key.pem, Buffer.from(s.sig, 'base64'))
  if (!ok) throw new UpdateSignatureError('bad-signature', 'signature does not match')
  // Ultimo: il file sul disco deve essere quello firmato
  // EN: Last: the file on disk must be the signed one
  const actual = await sha256File(file)
  if (actual !== s.sha256) throw new UpdateSignatureError('hash', 'downloaded file differs from the signed one')
}
