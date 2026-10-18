/**
 * @file Lettura delle trascrizioni JSONL di Claude Code (~/.claude/projects/<progetto>/<sessione>.jsonl).
 *
 * Ogni riga del file è un oggetto JSON. Ci interessano solo:
 * - type "user":      message.content è una stringa (domanda) o un array con blocchi "text"
 *                     e "tool_result" (esiti degli strumenti);
 * - type "assistant": message.content è un array di blocchi "text", "tool_use", "thinking".
 * Tutto il resto (snapshot di file, titoli, permessi…) viene ignorato.
 *
 * Ne ricaviamo un testo compatto "UTENTE: … / ASSISTENTE: …" per classificazione e distillazione:
 * - i blocchi "thinking" (ragionamento interno) sono esclusi;
 * - le chiamate agli strumenti sono riassunte (nome + primi 200 caratteri dell'input);
 * - gli esiti degli strumenti sono troncati a 400 caratteri;
 * - i messaggi dei sotto-agenti (isSidechain) e di servizio (isMeta, comandi slash) sono esclusi;
 * - FILE SENSIBILI (Fase 9): se uno strumento legge, scrive o modifica un `.env`, una chiave, un
 *   file di credenziali… (vedi privacy/sensitive-files.ts) si tolgono PER INTERO sia il suo input
 *   (es. il contenuto scritto) sia il suo esito (es. il contenuto letto). Resta solo una nota.
 */
import fs from 'node:fs'
import path from 'node:path'
import { sensitiveInToolInput } from '../privacy/sensitive-files'

/** Risultato dell'estrazione di (una parte di) una trascrizione. */
export interface TranscriptExtract {
  /** Testo della conversazione a partire da `fromLine`. */
  text: string
  /** Numero totale di righe del file: la prossima elaborazione riparte da qui. */
  lines: number
  /** Numero di messaggi dell'utente nella parte nuova. */
  userTurns: number
  /**
   * Istante (ms) del primo e dell'ultimo messaggio della parte nuova, dai campi `timestamp` delle
   * righe; null se assenti. Servono a ritrovare in git le modifiche fatte durante il capitolo.
   */
  firstAt: number | null
  lastAt: number | null
  /** Nomi dei file sensibili il cui contenuto è stato tolto dalla parte nuova (per il registro). */
  omitted: string[]
}

/** Limite di testo inviato al LLM: oltre, si tagliano le parti centrali. */
const MAX_CHARS = 40_000
const TOOL_INPUT_CHARS = 200
const TOOL_RESULT_CHARS = 400

/** Tronca a n caratteri aggiungendo un marcatore. */
function clip (s: string, n: number): string {
  const t = s.replace(/\s+$/g, '')
  return t.length > n ? t.slice(0, n) + ' […]' : t
}

/** Testo di un blocco di contenuto, qualunque sia la sua forma (stringa o array annidato). */
function blockText (block: any): string {
  if (typeof block?.text === 'string') return block.text
  if (typeof block?.content === 'string') return block.content
  if (Array.isArray(block?.content)) return block.content.map(blockText).join('\n')
  return ''
}

/**
 * Estrae il testo della conversazione.
 * @param file     percorso del file .jsonl
 * @param fromLine numero di righe già elaborate in precedenza: si legge solo da lì in avanti
 * @param sensitiveFiles pattern AGGIUNTIVI di file sensibili (quelli del team); i default valgono sempre
 */
export function extractTranscript (file: string, fromLine = 0, sensitiveFiles: string[] = []): TranscriptExtract {
  const all = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
  const parts: string[] = []
  let userTurns = 0
  let firstAt: number | null = null
  let lastAt: number | null = null

  // Strumenti che hanno toccato file sensibili, cercati in TUTTA la trascrizione: la richiesta
  // (tool_use) e il suo esito (tool_result) possono cadere in capitoli diversi.
  // Prefiltro testuale: si analizzano solo le righe che contengono chiamate a strumenti.
  const sensitiveTools = new Map<string, string[]>() // id dello strumento → file sensibili
  for (const raw of all) {
    if (!raw.includes('"tool_use"')) continue
    let row: any
    try { row = JSON.parse(raw) } catch { continue }
    for (const b of Array.isArray(row.message?.content) ? row.message.content : []) {
      if (b?.type !== 'tool_use') continue
      const files = sensitiveInToolInput(b.input, sensitiveFiles)
      if (files.length) sensitiveTools.set(b.id, files)
    }
  }
  const omitted = new Set<string>()
  const note = (files: string[]) => {
    for (const f of files) omitted.add(path.basename(f.replace(/\\/g, '/')))
    return `[contenuto omesso: file sensibile ${files.map((f) => path.basename(f.replace(/\\/g, '/'))).join(', ')}]`
  }

  for (const raw of all.slice(fromLine)) {
    let row: any
    try { row = JSON.parse(raw) } catch { continue }
    // Intervallo temporale del capitolo (anche le righe di sotto-agenti contano: è tempo di lavoro)
    const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN
    if (!Number.isNaN(at)) { firstAt ??= at; lastAt = at }
    if (row.isSidechain || row.isMeta) continue // sotto-agenti e messaggi di servizio
    const content = row.message?.content

    if (row.type === 'user') {
      if (typeof content === 'string') {
        if (content.startsWith('<command-') || content.startsWith('<local-command')) continue
        parts.push(`UTENTE: ${content.trim()}`)
        userTurns++
      } else if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === 'text' && b.text?.trim()) { parts.push(`UTENTE: ${b.text.trim()}`); userTurns++ }
          if (b.type === 'tool_result') {
            const files = sensitiveTools.get(b.tool_use_id)
            parts.push(`  [esito strumento${b.is_error ? ' (errore)' : ''}] ${files ? note(files) : clip(blockText(b), TOOL_RESULT_CHARS)}`)
          }
        }
      }
    } else if (row.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'text' && b.text?.trim()) parts.push(`ASSISTENTE: ${b.text.trim()}`)
        if (b.type === 'tool_use') {
          const files = sensitiveTools.get(b.id)
          parts.push(`  [strumento ${b.name}] ${files ? note(files) : clip(JSON.stringify(b.input ?? {}), TOOL_INPUT_CHARS)}`)
        }
        // i blocchi "thinking" sono ragionamento interno: esclusi
      }
    }
  }

  let text = parts.join('\n')
  if (text.length > MAX_CHARS) {
    // Inizio (il problema) + fine (la soluzione): la parte centrale è spesso tentativi intermedi.
    text = text.slice(0, MAX_CHARS * 0.25) + '\n[… parte centrale omessa …]\n' + text.slice(-MAX_CHARS * 0.75)
  }
  return { text, lines: all.length, userTurns, firstAt, lastAt, omitted: [...omitted] }
}
