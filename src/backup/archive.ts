/**
 * @file Backup del sapere di un team (B7): contenuto, formato del file e cifratura.
 *
 * EN: Backup of a team's knowledge (B7): content, file format and encryption.
 *
 * Il backup è un FILE che contiene il sapere del team e si ripristina in un team nuovo o in uno
 * esistente (src/backup/restore-plan.ts). Non è una copia dei dati del nodo: niente chiavi,
 * membri o inviti (un team ripristinato ha chiavi nuove, i colleghi rientrano con un invito),
 * niente archivio privato, Inbox o ricordi personali (stanno su un solo PC).
 *
 * EN: The backup is a FILE that holds the team's knowledge and is restored into a new or an
 * existing team (src/backup/restore-plan.ts). It is not a copy of the node's data: no keys,
 * members or invites (a restored team has new keys, colleagues rejoin with an invite),
 * no private store, Inbox or personal memories (they live on a single PC).
 *
 * Formato del file (`.micelio-backup`), un JSON leggibile con la sola parte cifrata opaca:
 *
 * EN: File format (`.micelio-backup`), a readable JSON where only the encrypted part is opaque:
 *
 *   {
 *     "format": "micelio-backup", "version": 1,
 *     "manifest": { team, createdAt, createdBy, counts },      ← in chiaro: si mostra prima di
 *                                                                  chiedere la password
 *                                                                  (EN: in clear text: shown before
 *                                                                  asking for the password)
 *     "kdf":    { "name": "scrypt", "N": 32768, "r": 8, "p": 1, "salt": "<base64>" },
 *     "cipher": { "name": "aes-256-gcm", "iv": "<base64>", "tag": "<base64>" },
 *     "data":   "<base64 di gzip(JSON del contenuto), cifrato>"
 *               (EN: "<base64 of gzip(content JSON), encrypted>")
 *   }
 *
 * - Password obbligatoria (decisione dell'utente): il file contiene tutto il sapere del team.
 * - scrypt rende costoso provare password a tappeto (~0,1 s e 32 MB per tentativo).
 * - AES-256-GCM autentica il contenuto: un file modificato o una password sbagliata danno lo
 *   stesso errore, e nulla di alterato viene ripristinato.
 * - Il manifesto è anche autenticato (dato aggiuntivo di GCM): non si può cambiare il nome del
 *   team o i conteggi mostrati senza rendere il file illeggibile.
 *
 * EN:
 * - Password required (user's decision): the file holds all the team's knowledge.
 * - scrypt makes brute-forcing passwords expensive (~0.1 s and 32 MB per attempt).
 * - AES-256-GCM authenticates the content: a modified file or a wrong password give the
 *   same error, and nothing tampered with is restored.
 * - The manifest is authenticated too (GCM additional data): you cannot change the team name
 *   or the displayed counts without making the file unreadable.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { LocalizedError } from '../core/errors'
import type { GapRecord, MemoryRecord, RootRecord } from '../core/model'

export const BACKUP_FORMAT = 'micelio-backup'
export const BACKUP_VERSION = 1
/** Estensione dei file di backup. / EN: Backup file extension. */
export const BACKUP_EXT = '.micelio-backup'
/** Lunghezza minima della password. / EN: Minimum password length. */
export const MIN_PASSWORD = 8

/** Parametri di scrypt: N = 2^15 (32 MB di memoria). Salvati nel file: si possono alzare in futuro. / EN: scrypt parameters: N = 2^15 (32 MB of memory). Saved in the file: they can be raised in the future. */
const SCRYPT = { N: 32768, r: 8, p: 1 }

/** Ricordo nel backup: il record della vista più nome dell'autore originale (non è un membro del team nuovo). / EN: Memory in the backup: the view record plus the original author's name (not a member of the new team). */
export interface BackupMemory extends MemoryRecord {
  /** Nome dell'autore nel team d'origine. / EN: Author's name in the original team. */
  authorName: string | null
}

/** Il sapere del team, come finisce (cifrato) nel file. / EN: The team's knowledge, as it ends up (encrypted) in the file. */
export interface BackupContent {
  /** Ricordi attivi E storico (archiviati, sostituiti). Mai i redatti. / EN: Active memories AND history (archived, superseded). Never redacted ones. */
  memories: BackupMemory[]
  /** Radici: id del ricordo → categoria, stato, segnalazioni. / EN: Roots: memory id → category, status, flags. */
  roots: RootRecord[]
  /** Collegamenti espliciti fra ricordi (dreaming). / EN: Explicit links between memories (dreaming). */
  links: { from: string, to: string, rel: string }[]
  /** Somma dei voti per ricordo (solo quelli diversi da zero). / EN: Vote total per memory (only non-zero ones). */
  votes: Record<string, number>
  /** Ricordi fissati. / EN: Pinned memories. */
  pins: string[]
  /** Uso dei ricordi, sommato su tutti i nodi. / EN: Memory usage, summed over all nodes. */
  usage: Record<string, { count: number, last: number }>
  /** Lacune di conoscenza. / EN: Knowledge gaps. */
  gaps: GapRecord[]
  /** Configurazione condivisa del team (es. memory.language). / EN: Shared team configuration (e.g. memory.language). */
  config: Record<string, unknown>
}

/** Parte in chiaro del file: si legge senza password. / EN: Clear-text part of the file: readable without the password. */
export interface BackupManifest {
  team: string
  createdAt: number
  /** Nome del nodo che ha fatto il backup. / EN: Name of the node that made the backup. */
  createdBy: string
  counts: { memories: number, active: number, roots: number, links: number, gaps: number }
}

interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  manifest: BackupManifest
  kdf: { name: 'scrypt', N: number, r: number, p: number, salt: string }
  cipher: { name: 'aes-256-gcm', iv: string, tag: string }
  data: string
}

/** Errore per l'utente (italiano e inglese, vedi LocalizedError), con un codice stabile per i test. / EN: User-facing error (Italian and English, see LocalizedError), with a stable code for tests. */
export class BackupError extends LocalizedError {
  constructor (readonly code: 'not-a-backup' | 'newer-version' | 'wrong-password' | 'weak-password', message: string, en: string) {
    super(message, en)
  }
}

/** Conteggi del manifesto, dal contenuto. / EN: Manifest counts, from the content. */
export function countsOf (c: BackupContent): BackupManifest['counts'] {
  return {
    memories: c.memories.length,
    active: c.memories.filter((m) => m.status === 'active').length,
    roots: c.roots.length,
    links: c.links.length,
    gaps: c.gaps.length
  }
}

/**
 * Cifra il contenuto e produce il file di backup.
 *
 * EN: Encrypts the content and produces the backup file.
 * @throws BackupError('weak-password') se la password è più corta di MIN_PASSWORD
 *         EN: if the password is shorter than MIN_PASSWORD
 */
export function encodeBackup (content: BackupContent, manifest: BackupManifest, password: string): Buffer {
  if (password.length < MIN_PASSWORD) throw new BackupError('weak-password', `La password deve avere almeno ${MIN_PASSWORD} caratteri`, `The password must be at least ${MIN_PASSWORD} characters long`)
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(password, salt, 32, { ...SCRYPT, maxmem: 64 * 1024 * 1024 })
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(JSON.stringify(manifest)))
  const data = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(content)))), cipher.final()])
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    manifest,
    kdf: { name: 'scrypt', ...SCRYPT, salt: salt.toString('base64') },
    cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
    data: data.toString('base64')
  }
  return Buffer.from(JSON.stringify(file))
}

/**
 * Legge il manifesto (in chiaro) senza la password: per mostrare cosa si sta per ripristinare.
 *
 * EN: Reads the (clear-text) manifest without the password: to show what is about to be restored.
 * @throws BackupError se il file non è un backup di Micelio o è di una versione futura
 *         EN: if the file is not a Micelio backup or comes from a future version
 */
export function readManifest (file: Buffer): BackupManifest {
  return parseFile(file).manifest
}

/**
 * Decifra il file e restituisce manifesto e contenuto.
 *
 * EN: Decrypts the file and returns manifest and content.
 * @throws BackupError('wrong-password') se la password è sbagliata o il file è stato alterato
 *         EN: if the password is wrong or the file was tampered with
 */
export function decodeBackup (file: Buffer, password: string): { manifest: BackupManifest, content: BackupContent } {
  const f = parseFile(file)
  try {
    const key = scryptSync(password, Buffer.from(f.kdf.salt, 'base64'), 32, { N: f.kdf.N, r: f.kdf.r, p: f.kdf.p, maxmem: 256 * 1024 * 1024 })
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(f.cipher.iv, 'base64'))
    decipher.setAAD(Buffer.from(JSON.stringify(f.manifest)))
    decipher.setAuthTag(Buffer.from(f.cipher.tag, 'base64'))
    const plain = Buffer.concat([decipher.update(Buffer.from(f.data, 'base64')), decipher.final()])
    return { manifest: f.manifest, content: JSON.parse(gunzipSync(plain).toString('utf8')) as BackupContent }
  } catch {
    // GCM non distingue "password sbagliata" da "file alterato": in entrambi i casi non si ripristina nulla
    // EN: GCM cannot tell "wrong password" from "tampered file": in both cases nothing is restored
    throw new BackupError('wrong-password', 'Password sbagliata, o file di backup danneggiato', 'Wrong password, or damaged backup file')
  }
}

function parseFile (file: Buffer): BackupFile {
  let f: BackupFile
  try { f = JSON.parse(file.toString('utf8')) } catch { throw new BackupError('not-a-backup', 'Il file non è un backup di Micelio', 'The file is not a Micelio backup') }
  if (f?.format !== BACKUP_FORMAT || !f.manifest || !f.data) throw new BackupError('not-a-backup', 'Il file non è un backup di Micelio', 'The file is not a Micelio backup')
  if (f.version > BACKUP_VERSION) throw new BackupError('newer-version', 'Backup creato da una versione più recente di Micelio: aggiorna Micelio per ripristinarlo', 'Backup made by a newer version of Micelio: update Micelio to restore it')
  return f
}

/** Nome del file di un backup: `<team>-<AAAA-MM-GG-hhmm>.micelio-backup`, senza caratteri problematici. / EN: File name of a backup: `<team>-<AAAA-MM-GG-hhmm>.micelio-backup`, without problematic characters. */
export function backupFileName (team: string, at = new Date()): string {
  // "Acme - Team" → "Acme-Team" (non "Acme---Team"): trattini consecutivi ridotti a uno
  // EN: "Acme - Team" → "Acme-Team" (not "Acme---Team"): consecutive dashes collapsed into one
  const safe = team.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'team'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${safe}-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${BACKUP_EXT}`
}
