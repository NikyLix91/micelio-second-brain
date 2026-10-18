/**
 * @file File di istruzioni per gli agenti generati dalle Radici (B4).
 *
 * I team usano già file che gli agenti leggono da soli a ogni sessione: `CLAUDE.md` (Claude Code),
 * `AGENTS.md` (Codex e altri), `.cursor/rules/*.mdc` (Cursor). Micelio ci scrive le RADICI del
 * progetto (il sapere fondante), così arrivano all'agente anche senza MCP, e le tiene aggiornate.
 *
 * Regole:
 * - In CLAUDE.md e AGENTS.md Micelio scrive SOLO fra i marcatori `<!-- micelio:start -->` e
 *   `<!-- micelio:end -->`: il resto del file è di chi lo ha scritto e non si tocca. Se i
 *   marcatori non ci sono, il blocco si aggiunge in fondo.
 * - Il file di Cursor (`.cursor/rules/micelio.mdc`) è tutto di Micelio.
 * - Il contenuto non contiene date: si riscrive solo se le Radici sono davvero cambiate, così
 *   non sporca i diff del repository.
 * - Ogni Radice è compatta (primo paragrafo, con l'id): il testo completo con il tool MCP `get`.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RecallHit } from '../core/model'

/** Formati supportati e file di destinazione (relativo alla cartella del progetto). */
export const AGENT_FILE_FORMATS = {
  claude: 'CLAUDE.md',
  agents: 'AGENTS.md',
  cursor: path.join('.cursor', 'rules', 'micelio.mdc')
} as const
export type AgentFileFormat = keyof typeof AGENT_FILE_FORMATS

export const BLOCK_START = '<!-- micelio:start'
export const BLOCK_END = '<!-- micelio:end -->'

/** Caratteri massimi per Radice e per l'intero blocco: il file lo legge l'agente a ogni sessione. */
const ROOT_CHARS = 700
const BLOCK_CHARS = 15_000

/** Titoli delle categorie, nell'ordine in cui compaiono. */
const CATEGORY_TITLE: Record<string, string> = {
  architecture: 'Architettura', network: 'Rete e infrastruttura', interface: 'Interfacce e contratti',
  domain: 'Dominio', practice: 'Best practice', policy: 'Policy', other: 'Altro'
}

/** Primo paragrafo di un testo Markdown (senza titoli), accorciato. */
function summary (body: string): string {
  const para = body.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#')) ?? body.trim()
  const flat = para.replace(/\s*\n\s*/g, ' ')
  return flat.length > ROOT_CHARS ? flat.slice(0, ROOT_CHARS - 1) + '…' : flat
}

/**
 * Il blocco Markdown con le Radici, raggruppate per categoria.
 * @param roots ricordi-Radice (con `root.category` e `root.status`)
 */
export function renderRootsBlock (o: { team: string, project: string, roots: RecallHit[] }): string {
  const lines: string[] = [
    `${BLOCK_START} · generato da Micelio dalle Radici del team «${o.team}». Non modificarlo a mano: si aggiorna da solo. -->`,
    '## Sapere fondante del team (Micelio)',
    '',
    `Radici del team «${o.team}» per il progetto «${o.project}»: rispettale quando progetti o modifichi il codice. ` +
      'Per il testo completo di una Radice usa il tool MCP di Micelio "get" con l\'id.'
  ]
  if (!o.roots.length) lines.push('', '_Nessuna Radice per questo progetto, per ora._')
  for (const cat of Object.keys(CATEGORY_TITLE)) {
    const list = o.roots.filter((r) => (r.root?.category ?? 'other') === cat).sort((a, b) => a.title.localeCompare(b.title))
    if (!list.length) continue
    lines.push('', `### ${CATEGORY_TITLE[cat]}`)
    for (const r of list) {
      const next = `- **${r.title}**${r.root?.status === 'review' ? ' (da rivedere)' : ''} — ${summary(r.body)} (id: ${r.id.slice(0, 12)})`
      // Meglio meno Radici che un blocco troncato a metà
      if (lines.join('\n').length + next.length > BLOCK_CHARS) { lines.push('- … altre Radici: chiedi a Micelio con il tool "architecture".'); break }
      lines.push(next)
    }
  }
  lines.push(BLOCK_END)
  return lines.join('\n')
}

/** Contenuto completo del file per il formato, partendo dal contenuto attuale (o null se non esiste). */
export function mergeAgentFile (format: AgentFileFormat, current: string | null, block: string): string {
  if (format === 'cursor') {
    // File tutto di Micelio: intestazione delle regole di Cursor + blocco
    return `---\ndescription: Sapere fondante del team (Radici di Micelio)\nalwaysApply: true\n---\n\n${block}\n`
  }
  if (!current) return block + '\n'
  const start = current.indexOf(BLOCK_START)
  const end = current.indexOf(BLOCK_END)
  if (start >= 0 && end > start) return current.slice(0, start) + block + current.slice(end + BLOCK_END.length)
  return current.replace(/\s*$/, '') + '\n\n' + block + '\n'
}

/**
 * Scrive (o aggiorna) il file di un formato nella cartella del progetto.
 * @returns percorso del file e se è stato davvero modificato
 */
export function writeAgentFile (dir: string, format: AgentFileFormat, block: string): { file: string, changed: boolean } {
  const file = path.join(dir, AGENT_FILE_FORMATS[format])
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  const next = mergeAgentFile(format, current, block)
  if (next === current) return { file, changed: false }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, next)
  return { file, changed: true }
}

/** Il file senza il blocco di Micelio (per l'import: non reimportare ciò che Micelio ha scritto). */
export function withoutMicelioBlock (text: string): string {
  const start = text.indexOf(BLOCK_START)
  const end = text.indexOf(BLOCK_END)
  return start >= 0 && end > start ? text.slice(0, start) + text.slice(end + BLOCK_END.length) : text
}
