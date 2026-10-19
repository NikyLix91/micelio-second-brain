/**
 * @file Backup del sapere di un team (B7): contenuto, formato del file e cifratura.
 *
 * Il backup è un FILE che contiene il sapere del team e si ripristina in un team nuovo o in uno
 * esistente (src/backup/restore-plan.ts). Non è una copia dei dati del nodo: niente chiavi,
 * membri o inviti (un team ripristinato ha chiavi nuove, i colleghi rientrano con un invito),
 * niente archivio privato, Inbox o ricordi personali (stanno su un solo PC).
 *
 * Formato del file (`.micelio-backup`), un JSON leggibile con la sola parte cifrata opaca:
 *
 *   {
 *     "format": "micelio-backup", "version": 1,
 *     "manifest": { team, createdAt, createdBy, counts },      ← in chiaro: si mostra prima di
 *                                                                  chiedere la password
 *     "kdf":    { "name": "scrypt", "N": 32768, "r": 8, "p": 1, "salt": "<base64>" },
 *     "cipher": { "name": "aes-256-gcm", "iv": "<base64>", "tag": "<base64>" },
 *     "data":   "<base64 di gzip(JSON del contenuto), cifrato>"
 *   }
 *
 * - Password obbligatoria (decisione dell'utente): il file contiene tutto il sapere del team.
 * - scrypt rende costoso provare password a tappeto (~0,1 s e 32 MB per tentativo).
 * - AES-256-GCM autentica il contenuto: un file modificato o una password sbagliata danno lo
 *   stesso errore, e nulla di alterato viene ripristinato.
 * - Il manifesto è anche autenticato (dato aggiuntivo di GCM): non si può cambiare il nome del
 *   team o i conteggi mostrati senza rendere il file illeggibile.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { LocalizedError } from '../core/errors'
import type { GapRecord, MemoryRecord, RootRecord } from '../core/model'

export const BACKUP_FORMAT = 'micelio-backup'
export const BACKUP_VERSION = 1
/** Estensione dei file di backup. */
export const BACKUP_EXT = '.micelio-backup'
/** Lunghezza minima della password. */
export const MIN_PASSWORD = 8

/** Parametri di scrypt: N = 2^15 (32 MB di memoria). Salvati nel file: si possono alzare in futuro. */
const SCRYPT = { N: 32768, r: 8, p: 1 }

/** Ricordo nel backup: il record della vista più nome dell'autore originale (non è un membro del team nuovo). */
export interface BackupMemory extends MemoryRecord {
  /** Nome dell'autore nel team d'origine. */
  authorName: string | null
}

/** Il sapere del team, come finisce (cifrato) nel file. */
export interface BackupContent {
  /** Ricordi attivi E storico (archiviati, sostituiti). Mai i redatti. */
  memories: BackupMemory[]
  /** Radici: id del ricordo → categoria, stato, segnalazioni. */
  roots: RootRecord[]
  /** Collegamenti espliciti fra ricordi (dreaming). */
  links: { from: string, to: string, rel: string }[]
  /** Somma dei voti per ricordo (solo quelli diversi da zero). */
  votes: Record<string, number>
  /** Ricordi fissati. */
  pins: string[]
  /** Uso dei ricordi, sommato su tutti i nodi. */
  usage: Record<string, { count: number, last: number }>
  /** Lacune di conoscenza. */
  gaps: GapRecord[]
  /** Configurazione condivisa del team (es. memory.language). */
  config: Record<string, unknown>
}

/** Parte in chiaro del file: si legge senza password. */
export interface BackupManifest {
  team: string
  createdAt: number
  /** Nome del nodo che ha fatto il backup. */
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

/** Errore per l'utente (italiano e inglese, vedi LocalizedError), con un codice stabile per i test. */
export class BackupError extends LocalizedError {
  constructor (readonly code: 'not-a-backup' | 'newer-version' | 'wrong-password' | 'weak-password', message: string, en: string) {
    super(message, en)
  }
}

/** Conteggi del manifesto, dal contenuto. */
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
 * @throws BackupError('weak-password') se la password è più corta di MIN_PASSWORD
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
 * @throws BackupError se il file non è un backup di Micelio o è di una versione futura
 */
export function readManifest (file: Buffer): BackupManifest {
  return parseFile(file).manifest
}

/**
 * Decifra il file e restituisce manifesto e contenuto.
 * @throws BackupError('wrong-password') se la password è sbagliata o il file è stato alterato
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

/** Nome del file di un backup: `<team>-<AAAA-MM-GG-hhmm>.micelio-backup`, senza caratteri problematici. */
export function backupFileName (team: string, at = new Date()): string {
  // "Acme - Team" → "Acme-Team" (non "Acme---Team"): trattini consecutivi ridotti a uno
  const safe = team.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'team'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${safe}-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${BACKUP_EXT}`
}
