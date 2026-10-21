/**
 * @file Estrazione del testo dai documenti (DESIGN §6.2, Fase 4).
 *
 * EN: Text extraction from documents (DESIGN §6.2, Phase 4).
 *
 * Formati Office/PDF/OpenDocument passano da `officeparser` (puro JavaScript, nessun programma
 * esterno). Testo e Markdown si leggono direttamente, come PlantUML e Mermaid; dei diagrammi
 * draw.io e SVG si estraggono le etichette (diagrams.ts).
 *
 * EN: Office/PDF/OpenDocument formats go through `officeparser` (pure JavaScript, no external
 * program). Text and Markdown are read directly, like PlantUML and Mermaid; from draw.io and SVG
 * diagrams the labels are extracted (diagrams.ts).
 *
 * Il testo estratto serve SOLO alla pipeline (filtro, classificazione, distillazione): non viene
 * salvato né replicato. Nella rete viaggia solo ciò che la distillazione ne ricava.
 *
 * EN: The extracted text is used ONLY by the pipeline (filter, classification, distillation): it is
 * neither saved nor replicated. Only what distillation derives from it travels over the network.
 */
import fs from 'node:fs'
import path from 'node:path'
import { drawioText, svgText } from './diagrams'

/** Estensioni supportate → tipo MIME (usato nel riferimento alla fonte dei ricordi). / EN: Supported extensions → MIME type (used in the memories' source reference). */
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
  '.html': 'text/html',
  // Diagrammi (Fase 8): schemi di architettura e mappe di rete, vedi diagrams.ts
  // EN: Diagrams (Phase 8): architecture diagrams and network maps, see diagrams.ts
  '.drawio': 'application/vnd.jgraph.mxfile',
  '.svg': 'image/svg+xml',
  '.puml': 'text/x-plantuml',
  '.plantuml': 'text/x-plantuml',
  '.mmd': 'text/vnd.mermaid',
  '.mermaid': 'text/vnd.mermaid'
}

/** Documenti più grandi di così vengono ignorati (es. dump, archivi esportati). / EN: Documents larger than this are ignored (e.g. dumps, exported archives). */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

/** Formati letti come testo semplice, senza parser. / EN: Formats read as plain text, without a parser. */
const PLAIN = new Set(['.md', '.txt', '.csv', '.puml', '.plantuml', '.mmd', '.mermaid'])

/** true se il file ha un'estensione supportata e non è un file temporaneo di Office. / EN: true if the file has a supported extension and is not an Office temporary file. */
export function isSupported (file: string): boolean {
  const base = path.basename(file)
  // "~$documento.docx" sono i file di blocco di Word/Excel mentre il documento è aperto.
  // EN: "~$documento.docx" are the Word/Excel lock files while the document is open.
  if (base.startsWith('~$') || base.startsWith('.~')) return false
  return path.extname(file).toLowerCase() in SUPPORTED
}

export function mimeOf (file: string): string {
  return SUPPORTED[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Estrae il testo di un documento.
 *
 * EN: Extracts the text of a document.
 * @throws Error se il formato non è supportato o il file è illeggibile (es. protetto da password)
 *         EN: if the format is not supported or the file is unreadable (e.g. password protected)
 */
export async function extractText (file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase()
  if (!(ext in SUPPORTED)) throw new Error(`formato non supportato: ${ext}`)
  if (PLAIN.has(ext)) return fs.readFileSync(file, 'utf8')
  // Diagrammi XML: solo le etichette, non la geometria
  // EN: XML diagrams: only the labels, not the geometry
  if (ext === '.drawio') return `DIAGRAMMA (draw.io)\n${drawioText(fs.readFileSync(file, 'utf8'))}`
  if (ext === '.svg') return `DIAGRAMMA (SVG)\n${svgText(fs.readFileSync(file, 'utf8'))}`
  // Import pigro: officeparser è grande e serve solo quando ci sono documenti da leggere.
  // EN: Lazy import: officeparser is big and is needed only when there are documents to read.
  const { parseOffice } = require('officeparser') as typeof import('officeparser')
  const ast = await parseOffice(file)
  return ((await ast.to('text')).value as string).replace(/\r\n/g, '\n')
}

/** Parti di testo per la distillazione: ogni parte resta nei limiti del prompt. / EN: Text chunks for distillation: each chunk stays within the prompt limits. */
export const CHUNK_CHARS = 12_000
/** Parti massime per documento: oltre, il resto non viene distillato (limite di budget). / EN: Maximum chunks per document: beyond that, the rest is not distilled (budget limit). */
export const MAX_CHUNKS = 6

/**
 * Divide il testo in parti di al massimo CHUNK_CHARS caratteri, tagliando preferibilmente
 * fra paragrafi (riga vuota) per non spezzare frasi a metà.
 *
 * EN: Splits the text into chunks of at most CHUNK_CHARS characters, cutting preferably
 * between paragraphs (blank line) so sentences are not split in half.
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
