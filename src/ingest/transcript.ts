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
 * - i messaggi dei sotto-agenti (isSidechain) e di servizio (isMeta, comandi slash) sono esclusi.
 */
import fs from 'node:fs'

/** Risultato dell'estrazione di (una parte di) una trascrizione. */
export interface TranscriptExtract {
  /** Testo della conversazione a partire da `fromLine`. */
  text: string
  /** Numero totale di righe del file: la prossima elaborazione riparte da qui. */
  lines: number
  /** Numero di messaggi dell'utente nella parte nuova. */
  userTurns: number
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
 */
export function extractTranscript (file: string, fromLine = 0): TranscriptExtract {
  const all = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
  const parts: string[] = []
  let userTurns = 0

  for (const raw of all.slice(fromLine)) {
    let row: any
    try { row = JSON.parse(raw) } catch { continue }
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
          if (b.type === 'tool_result') parts.push(`  [esito strumento${b.is_error ? ' (errore)' : ''}] ${clip(blockText(b), TOOL_RESULT_CHARS)}`)
        }
      }
    } else if (row.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'text' && b.text?.trim()) parts.push(`ASSISTENTE: ${b.text.trim()}`)
        if (b.type === 'tool_use') parts.push(`  [strumento ${b.name}] ${clip(JSON.stringify(b.input ?? {}), TOOL_INPUT_CHARS)}`)
        // i blocchi "thinking" sono ragionamento interno: esclusi
      }
    }
  }

  let text = parts.join('\n')
  if (text.length > MAX_CHARS) {
    // Inizio (il problema) + fine (la soluzione): la parte centrale è spesso tentativi intermedi.
    text = text.slice(0, MAX_CHARS * 0.25) + '\n[… parte centrale omessa …]\n' + text.slice(-MAX_CHARS * 0.75)
  }
  return { text, lines: all.length, userTurns }
}
