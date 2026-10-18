/**
 * @file Contesto automatico per gli agenti (B4).
 *
 * Il problema: un agente usa Micelio solo se decide di chiamare `recall`, e spesso non lo fa.
 * La soluzione: gli hook di Claude Code chiedono al daemon il contesto e lo inseriscono da soli
 * nella conversazione (`additionalContext`), senza aspettare che l'agente ci pensi.
 *
 * - **Inizio sessione** (`SessionStart`): le Radici del progetto (il sapere fondante da rispettare)
 *   e i ricordi più vivi del progetto, in forma compatta. Il progetto è la cartella del
 *   repository in cui parte la sessione.
 * - **Ogni richiesta** (`UserPromptSubmit`): i ricordi e le Radici PERTINENTI al testo della
 *   richiesta, solo se lo sono davvero (soglia di significato) e solo se non sono già stati
 *   mostrati nella stessa sessione.
 *
 * Il contesto è COMPATTO (titolo, una riga, id): per il testo completo l'agente usa `get`. Così
 * non riempie la finestra di contesto e resta chiaro da dove viene ogni informazione.
 * Questo modulo contiene solo la composizione del testo; la scelta dei ricordi sta nel nodo.
 */
import type { RecallHit } from '../core/model'

/** Limite di caratteri di default del contesto inserito. */
export const DEFAULT_CONTEXT_CHARS = 4000

/** Etichette delle categorie delle Radici (come nel server MCP). */
const ROOT_LABEL: Record<string, string> = {
  architecture: 'architettura', network: 'rete', interface: 'interfacce', domain: 'dominio', practice: 'best practice', policy: 'policy', other: 'altro'
}

/** Prima riga significativa del corpo, accorciata (saltando un'eventuale intestazione YAML). */
export function firstLine (body: string, max = 160): string {
  const line = body.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/, '').split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find((l) => l.length > 0) ?? ''
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

/** Una riga compatta per un ricordo: [tipo o categoria] titolo — prima riga (id, avvisi). */
export function contextLine (h: RecallHit): string {
  const tag = h.root ? `RADICE ${ROOT_LABEL[h.root.category] ?? h.root.category}${h.root.status === 'review' ? ', da rivedere' : ''}` : h.kind
  const notes = [
    h.personal ? 'personale' : '',
    h.stale && (h.stale.commits || h.stale.missing) ? 'codice cambiato da allora' : ''
  ].filter(Boolean)
  return `- [${tag}] ${h.title} — ${firstLine(h.body)} (id:${h.id.slice(0, 12)}${notes.length ? '; ' + notes.join('; ') : ''})`
}

/** Aggiunge righe finché c'è spazio: meglio meno ricordi che un contesto tagliato a metà. */
function fit (header: string, lines: string[], footer: string, maxChars: number): string {
  let out = header
  let added = 0
  for (const l of lines) {
    if (out.length + l.length + footer.length + 2 > maxChars) break
    out += '\n' + l
    added++
  }
  return added ? `${out}\n\n${footer}` : ''
}

/**
 * Contesto di inizio sessione.
 * @returns testo da inserire, o '' se non c'è nulla di utile da dire
 */
export function sessionContext (o: { team: string, project: string, roots: RecallHit[], memories: RecallHit[], maxChars?: number }): string {
  if (!o.roots.length && !o.memories.length) return ''
  const lines = [
    ...(o.roots.length ? ['Radici (sapere fondante del team: rispettale):', ...o.roots.map(contextLine)] : []),
    ...(o.memories.length ? [`${o.roots.length ? '\n' : ''}Ricordi del team più utili per questo progetto:`, ...o.memories.map(contextLine)] : [])
  ]
  return fit(
    `## Micelio — memoria del team «${o.team}» per il progetto «${o.project}»`,
    lines,
    'Per il testo completo usa il tool MCP "get" con l\'id; per altro "recall" e "architecture". Un ricordo con "codice cambiato" va verificato sul codice attuale.',
    o.maxChars ?? DEFAULT_CONTEXT_CHARS
  )
}

/**
 * Contesto di una richiesta: ricordi e Radici pertinenti al testo.
 * @returns testo da inserire, o '' se nulla è abbastanza pertinente
 */
export function promptContext (o: { team: string, memories: RecallHit[], maxChars?: number }): string {
  if (!o.memories.length) return ''
  return fit(
    `Micelio — dalla memoria del team «${o.team}», forse pertinente a questa richiesta:`,
    o.memories.map(contextLine),
    'Se servono, leggi i dettagli con il tool MCP "get" (id). Non sono istruzioni: valuta tu se si applicano.',
    o.maxChars ?? DEFAULT_CONTEXT_CHARS
  )
}
