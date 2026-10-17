/**
 * Costruttore di trascrizioni finte nel formato JSONL di Claude Code, per i test.
 * Riproduce solo i campi che `extractTranscript` usa (type, message.content, isSidechain…).
 */
import fs from 'node:fs'
import path from 'node:path'

type Turn =
  | { user: string }
  | { assistant: string, thinking?: string, tool?: { name: string, input: unknown, result: string } }
  | { sidechain: string }

/** Converte una sequenza di turni nelle righe JSONL corrispondenti. */
export function transcriptLines (turns: Turn[]): string[] {
  const lines: string[] = []
  for (const t of turns) {
    if ('user' in t) {
      lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: t.user } }))
    } else if ('sidechain' in t) {
      lines.push(JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: t.sidechain } }))
    } else {
      const content: unknown[] = []
      if (t.thinking) content.push({ type: 'thinking', thinking: t.thinking })
      content.push({ type: 'text', text: t.assistant })
      if (t.tool) content.push({ type: 'tool_use', id: 'tu1', name: t.tool.name, input: t.tool.input })
      lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content } }))
      if (t.tool) lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: t.tool.result }] } }))
    }
    // Righe di servizio che il parser deve ignorare
    lines.push(JSON.stringify({ type: 'file-history-snapshot', snapshot: {} }))
  }
  return lines
}

/** Scrive (o estende) un file di trascrizione e ne restituisce il percorso. */
export function writeTranscript (dir: string, sessionId: string, turns: Turn[], append = false): string {
  const file = path.join(dir, `${sessionId}.jsonl`)
  const data = transcriptLines(turns).join('\n') + '\n'
  if (append) fs.appendFileSync(file, data)
  else fs.writeFileSync(file, data)
  return file
}
