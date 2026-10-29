#!/usr/bin/env node
/**
 * @file Chiavi e firme Ed25519 degli aggiornamenti automatici (B13 fase 4). Il formato della
 * firma è spiegato in desktop/src/update-signature.ts, che la verifica dentro l'app.
 *
 * EN: Ed25519 keys and signatures for automatic updates (B13 phase 4). The signature format is
 * explained in desktop/src/update-signature.ts, which verifies it inside the app.
 *
 *   node scripts/update-signing.js keygen [--out <file>]
 *     Crea una coppia di chiavi. La privata va in un file FUORI dalla repository (predefinito:
 *     ~/micelio-update-signing-key.pem, leggibile solo dall'utente); la pubblica si aggiunge a
 *     desktop/src/update-keys.ts. Non sovrascrive mai una chiave esistente.
 *     EN: Creates a key pair. The private key goes to a file OUTSIDE the repository (default:
 *     ~/micelio-update-signing-key.pem, readable only by the user); the public key is appended to
 *     desktop/src/update-keys.ts. It never overwrites an existing key.
 *
 *   node scripts/update-signing.js sign --version X.Y.Z [--ephemeral] <file>...
 *     Scrive `<file>.sig` accanto a ogni file. La chiave privata arriva dalla variabile
 *     UPDATE_SIGNING_KEY (PEM) e deve essere fra quelle di desktop/src/update-keys.ts: una chiave
 *     sbagliata nel segreto si scopre qui, non sui PC di chi aggiorna. `--ephemeral` usa una
 *     chiave usa e getta (prove a secco del workflow, senza segreti).
 *     EN: Writes `<file>.sig` next to every file. The private key comes from the UPDATE_SIGNING_KEY
 *     variable (PEM) and must be among those in desktop/src/update-keys.ts: a wrong key in the
 *     secret is caught here, not on the PCs that update. `--ephemeral` uses a throwaway key (dry
 *     runs of the workflow, without secrets).
 *
 * Nessuna dipendenza: gira anche nel job di firma del workflow, che non installa nulla.
 * EN: No dependencies: it also runs in the workflow's signing job, which installs nothing.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const KEYS_FILE = path.join(ROOT, 'desktop', 'src', 'update-keys.ts')

/** Stessa stringa di signedPayload in desktop/src/update-signature.ts. / EN: Same string as signedPayload in desktop/src/update-signature.ts. */
const signedPayload = (file, version, sha256) => `micelio-update:v1:${file}:${version}:${sha256}`

/** Stesso calcolo di keyId in desktop/src/update-signature.ts. / EN: Same computation as keyId in desktop/src/update-signature.ts. */
function keyId (publicKey) {
  const der = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' })
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16)
}

/** Le chiavi pubbliche scritte in update-keys.ts. / EN: The public keys written in update-keys.ts. */
function knownKeys (keysFile = KEYS_FILE) {
  const text = fs.readFileSync(keysFile, 'utf8')
  return [...text.matchAll(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/g)].map((m) => m[0])
}

/** SHA-256 di un file, a pezzi. / EN: SHA-256 of a file, in chunks. */
async function sha256File (file) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/**
 * Firma un file e restituisce il contenuto del suo `.sig`.
 * EN: Signs a file and returns the content of its `.sig`.
 */
async function signFile (file, version, privateKey) {
  const name = path.basename(file)
  const sha256 = await sha256File(file)
  const sig = crypto.sign(null, Buffer.from(signedPayload(name, version, sha256)), privateKey).toString('base64')
  return JSON.stringify({ v: 1, file: name, version, sha256, keyId: keyId(privateKey), sig }, null, 2) + '\n'
}

/** Aggiunge una chiave pubblica all'elenco di update-keys.ts. / EN: Appends a public key to the list in update-keys.ts. */
function addPublicKey (pem, keysFile = KEYS_FILE) {
  const text = fs.readFileSync(keysFile, 'utf8')
  const marker = 'export const UPDATE_PUBLIC_KEYS: string[] = ['
  if (!text.includes(marker)) throw new Error(`${keysFile}: list not found`)
  const entry = `\n  // ${keyId(pem)}, ${new Date().toISOString().slice(0, 10)}\n  \`${pem.trim()}\`,`
  fs.writeFileSync(keysFile, text.replace(marker, marker + entry))
}

function keygen (args) {
  const i = args.indexOf('--out')
  const out = path.resolve(i >= 0 ? args[i + 1] : path.join(os.homedir(), 'micelio-update-signing-key.pem'))
  // Mai dentro la repository: un `git add -A` distratto la pubblicherebbe
  // EN: Never inside the repository: a careless `git add -A` would publish it
  if (!path.relative(ROOT, out).startsWith('..')) throw new Error(`refusing to write the private key inside the repository: ${out}`)
  if (fs.existsSync(out)) throw new Error(`${out} already exists: refusing to overwrite a private key`)
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  fs.writeFileSync(out, privateKey, { mode: 0o600 })
  addPublicKey(publicKey)
  console.log(`Chiave privata / private key: ${out}`)
  console.log(`Chiave pubblica aggiunta a / public key added to: ${path.relative(ROOT, KEYS_FILE)} (id ${keyId(publicKey)})`)
  console.log('\nIT: copia il contenuto del file della chiave privata nel segreto UPDATE_SIGNING_KEY dell\'environment')
  console.log('    "release" su GitHub e in un gestore di password, poi cancella il file. Non va mai in un commit.')
  console.log('EN: copy the content of the private key file into the UPDATE_SIGNING_KEY secret of the GitHub')
  console.log('    "release" environment and into a password manager, then delete the file. It never goes in a commit.')
}

async function sign (args) {
  const i = args.indexOf('--version')
  const version = i >= 0 ? args[i + 1] : undefined
  if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('--version X.Y.Z is required')
  const ephemeral = args.includes('--ephemeral')
  const files = args.filter((a, j) => !a.startsWith('--') && j !== i + 1)
  if (!files.length) throw new Error('no files to sign')
  let privateKey
  if (ephemeral) {
    privateKey = crypto.generateKeyPairSync('ed25519').privateKey
    console.log('Chiave usa e getta (prova a secco) / throwaway key (dry run)')
  } else {
    if (!process.env.UPDATE_SIGNING_KEY) throw new Error('UPDATE_SIGNING_KEY is not set')
    privateKey = crypto.createPrivateKey(process.env.UPDATE_SIGNING_KEY)
    const id = keyId(privateKey)
    if (!knownKeys().some((k) => keyId(k) === id)) throw new Error(`the signing key (${id}) is not in desktop/src/update-keys.ts: the app would reject these updates`)
  }
  for (const f of files) {
    fs.writeFileSync(`${f}.sig`, await signFile(f, version, privateKey))
    console.log(`firmato / signed: ${path.basename(f)} (key ${keyId(privateKey)})`)
  }
}

module.exports = { signedPayload, keyId, signFile, knownKeys, addPublicKey }

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2)
  const run = cmd === 'keygen' ? async () => keygen(args) : cmd === 'sign' ? () => sign(args) : null
  if (!run) {
    console.error('Uso / usage:\n  node scripts/update-signing.js keygen [--out <file>]\n  node scripts/update-signing.js sign --version X.Y.Z [--ephemeral] <file>...')
    process.exit(1)
  }
  run().catch((err) => {
    console.error(`Errore / error: ${err.message}`)
    process.exit(1)
  })
}
