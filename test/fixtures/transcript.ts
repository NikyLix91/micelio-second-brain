/**
 * Costruttore di trascrizioni finte nel formato JSONL di Claude Code, per i test.
 * Riproduce solo i campi che `extractTranscript` usa (type, message.content, isSidechain…).
 *
 * EN: Builder of fake transcripts in the Claude Code JSONL format, for tests.
 * It reproduces only the fields `extractTranscript` uses (type, message.content, isSidechain…).
 */
import fs from 'node:fs'
import path from 'node:path'

type Turn =
  | { user: string }
  | { assistant: string, thinking?: string, tool?: { name: string, input: unknown, result: string } }
  | { sidechain: string }

/**
 * Converte una sequenza di turni nelle righe JSONL corrispondenti.
 *
 * EN: Converts a sequence of turns into the matching JSONL lines.
 * @param cwd cartella di lavoro registrata nei messaggi dell'utente (come fa Claude Code)
 *            EN: working directory recorded in the user messages (as Claude Code does)
 * @param at  se indicato, istante (ms) del primo messaggio: ogni riga riceve un `timestamp`
 *            a un minuto di distanza dalla precedente, come nelle trascrizioni reali
 *            EN: if given, time (ms) of the first message: each line gets a `timestamp`
 *            one minute after the previous one, as in real transcripts
 */
export function transcriptLines (turns: Turn[], cwd?: string, at?: number): string[] {
  const lines: string[] = []
  for (const t of turns) {
    if ('user' in t) {
      lines.push(JSON.stringify({ type: 'user', ...(cwd ? { cwd } : {}), message: { role: 'user', content: t.user } }))
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
    // EN: Service lines the parser must ignore
    lines.push(JSON.stringify({ type: 'file-history-snapshot', snapshot: {} }))
  }
  if (at === undefined) return lines
  return lines.map((l, i) => JSON.stringify({ ...JSON.parse(l), timestamp: new Date(at + i * 60_000).toISOString() }))
}

/** Scrive (o estende) un file di trascrizione e ne restituisce il percorso. / EN: Writes (or appends to) a transcript file and returns its path. */
export function writeTranscript (dir: string, sessionId: string, turns: Turn[], append = false, cwd?: string, at?: number): string {
  const file = path.join(dir, `${sessionId}.jsonl`)
  const data = transcriptLines(turns, cwd, at).join('\n') + '\n'
  if (append) fs.appendFileSync(file, data)
  else fs.writeFileSync(file, data)
  return file
}
