/**
 * Firma degli aggiornamenti (B13 fase 4): lo script che firma (scripts/update-signing.js) e l'app
 * che verifica (desktop/src/update-signature.ts) devono parlare lo stesso formato, e ogni
 * manomissione va rifiutata.
 *
 * EN: Update signatures (B13 phase 4): the script that signs (scripts/update-signing.js) and the
 * app that verifies (desktop/src/update-signature.ts) must speak the same format, and every
 * tampering must be rejected.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { keyId, signedPayload, verifyUpdate, withIds } from '../../desktop/src/update-signature'

const signing = createRequire(__filename)('../../scripts/update-signing.js') as {
  signedPayload: (f: string, v: string, h: string) => string
  keyId: (k: crypto.KeyLike) => string
  signFile: (file: string, version: string, key: crypto.KeyObject) => Promise<string>
  knownKeys: (file: string) => string[]
  addPublicKey: (pem: string, file: string) => void
}

const pair = () => crypto.generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })

describe('firma degli aggiornamenti', () => {
  let dir: string, file: string
  const main = pair()
  const other = pair()
  const keys = withIds([main.publicKey])
  const expected = { file: 'Micelio-Setup-0.8.0.exe', version: '0.8.0' }
  const sign = (f = file, v = '0.8.0', k = main.privateKey) => signing.signFile(f, v, crypto.createPrivateKey(k))

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micelio-sig-'))
    file = path.join(dir, 'Micelio-Setup-0.8.0.exe')
    fs.writeFileSync(file, crypto.randomBytes(300_000))
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('script e app usano la stessa stringa firmata e lo stesso id di chiave', () => {
    expect(signing.signedPayload('a', '1.0.0', 'ff')).toBe(signedPayload('a', '1.0.0', 'ff'))
    expect(signing.keyId(main.publicKey)).toBe(keyId(main.publicKey))
    expect(signing.keyId(crypto.createPrivateKey(main.privateKey))).toBe(keyId(main.publicKey))
  })

  it('accetta un pacchetto firmato con una chiave nota', async () => {
    await expect(verifyUpdate(file, await sign(), expected, keys)).resolves.toBeUndefined()
  })

  it('rifiuta una chiave che l\'app non conosce', async () => {
    await expect(verifyUpdate(file, await sign(file, '0.8.0', other.privateKey), expected, keys)).rejects.toMatchObject({ code: 'unknown-key' })
  })

  it('rifiuta un pacchetto vecchio spacciato per una versione nuova', async () => {
    await expect(verifyUpdate(file, await sign(file, '0.7.9'), expected, keys)).rejects.toMatchObject({ code: 'mismatch' })
  })

  it('rifiuta campi cambiati dopo la firma', async () => {
    const s = JSON.parse(await sign())
    // Versione riscritta a mano: i campi tornano, la firma no / EN: Version rewritten by hand: fields match, signature doesn't
    await expect(verifyUpdate(file, JSON.stringify({ ...s, version: '0.8.0', sha256: 'a'.repeat(64) }), expected, keys)).rejects.toMatchObject({ code: 'bad-signature' })
  })

  it('rifiuta un file cambiato dopo la firma', async () => {
    const sig = await sign()
    const copy = path.join(dir, 'copy.exe')
    fs.copyFileSync(file, copy)
    fs.appendFileSync(copy, 'x')
    await expect(verifyUpdate(copy, sig, expected, keys)).rejects.toMatchObject({ code: 'hash' })
  })

  it('rifiuta un .sig malformato o assente', async () => {
    await expect(verifyUpdate(file, 'not json', expected, keys)).rejects.toMatchObject({ code: 'malformed' })
    await expect(verifyUpdate(file, '{}', expected, keys)).rejects.toMatchObject({ code: 'malformed' })
  })

  it('senza chiavi note non accetta nulla', async () => {
    await expect(verifyUpdate(file, await sign(), expected, [])).rejects.toMatchObject({ code: 'unknown-key' })
  })

  it('keygen aggiunge la chiave pubblica a update-keys.ts e lo script la ritrova', () => {
    const keysFile = path.join(dir, 'update-keys.ts')
    fs.copyFileSync(path.join(__dirname, '..', '..', 'desktop', 'src', 'update-keys.ts'), keysFile)
    signing.addPublicKey(main.publicKey, keysFile)
    signing.addPublicKey(other.publicKey, keysFile)
    expect(signing.knownKeys(keysFile).map((k) => keyId(k))).toEqual([other.publicKey, main.publicKey].map((k) => keyId(k)))
  })
})
