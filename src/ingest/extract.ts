/**
 * @file Estrazione del testo dai documenti (DESIGN §6.2, Fase 4).
 *
 * Formati Office/PDF/OpenDocument passano da `officeparser` (puro JavaScript, nessun programma
 * esterno). Testo e Markdown si leggono direttamente.
 *
 * Il testo estratto serve SOLO alla pipeline (filtro, classificazione, distillazione): non viene
 * salvato né replicato. Nella rete viaggia solo ciò che la distillazione ne ricava.
 */
import fs from 'node:fs'
import path from 'node:path'

/** Estensioni supportate → tipo MIME (usato nel riferimento alla fonte dei ricordi). */
export const SUPPORTED: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.rtf': 'application/rtf',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.html': 'text/html'
}

/** Documenti più grandi di così vengono ignorati (es. dump, archivi esportati). */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

/** Formati letti come testo semplice, senza parser. */
const PLAIN = new Set(['.md', '.txt', '.csv'])

/** true se il file ha un'estensione supportata e non è un file temporaneo di Office. */
export function isSupported (file: string): boolean {
  const base = path.basename(file)
  // "~$documento.docx" sono i file di blocco di Word/Excel mentre il documento è aperto.
  if (base.startsWith('~$') || base.startsWith('.~')) return false
  return path.extname(file).toLowerCase() in SUPPORTED
}

export function mimeOf (file: string): string {
  return SUPPORTED[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Estrae il testo di un documento.
 * @throws Error se il formato non è supportato o il file è illeggibile (es. protetto da password)
 */
export async function extractText (file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase()
  if (!(ext in SUPPORTED)) throw new Error(`formato non supportato: ${ext}`)
  if (PLAIN.has(ext)) return fs.readFileSync(file, 'utf8')
  // Import pigro: officeparser è grande e serve solo quando ci sono documenti da leggere.
  const { parseOffice } = require('officeparser') as typeof import('officeparser')
  const ast = await parseOffice(file)
  return ((await ast.to('text')).value as string).replace(/\r\n/g, '\n')
}

/** Parti di testo per la distillazione: ogni parte resta nei limiti del prompt. */
export const CHUNK_CHARS = 12_000
/** Parti massime per documento: oltre, il resto non viene distillato (limite di budget). */
export const MAX_CHUNKS = 6

/**
 * Divide il testo in parti di al massimo CHUNK_CHARS caratteri, tagliando preferibilmente
 * fra paragrafi (riga vuota) per non spezzare frasi a metà.
 */
export function chunkText (text: string, size = CHUNK_CHARS, max = MAX_CHUNKS): string[] {
  const chunks: string[] = []
  let rest = text.trim()
  while (rest.length > 0 && chunks.length < max) {
    if (rest.length <= size) { chunks.push(rest); break }
    let cut = rest.lastIndexOf('\n\n', size)
    if (cut < size * 0.5) cut = rest.lastIndexOf('\n', size)
    if (cut < size * 0.5) cut = size
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  return chunks
}
