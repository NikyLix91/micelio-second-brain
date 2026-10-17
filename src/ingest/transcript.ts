// Lettura delle trascrizioni JSONL di Claude Code (~/.claude/projects/<progetto>/<sessione>.jsonl).
// Ne ricaviamo un testo compatto "UTENTE / ASSISTENTE" adatto a classificazione e distillazione:
// niente ragionamenti interni, chiamate agli strumenti riassunte, output degli strumenti troncati.
import fs from 'node:fs'

export interface TranscriptExtract {
  /** Testo della conversazione a partire da `fromLine`. */
  text: string
  /** Numero totale di righe del file: la prossima elaborazione riparte da qui. */
  lines: number
  /** Numero di messaggi dell'utente nella parte nuova. */
  userTurns: number
}

const MAX_CHARS = 40_000
const TOOL_INPUT_CHARS = 200
const TOOL_RESULT_CHARS = 400

function clip (s: string, n: number): string {
  const t = s.replace(/\s+$/g, '')
  return t.length > n ? t.slice(0, n) + ' […]' : t
}

function blockText (block: any): string {
  if (typeof block?.text === 'string') return block.text
  if (typeof block?.content === 'string') return block.content
  if (Array.isArray(block?.content)) return block.content.map(blockText).join('\n')
  return ''
}

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
