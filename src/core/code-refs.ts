/**
 * @file Presentazione testuale dei riferimenti al codice di un ricordo (`source.code`).
 *
 * Un solo formato per tutti i posti in cui un ricordo si legge come testo: risultati MCP (per gli
 * agenti), `micelio get`/`recall` da terminale ed export Markdown. Così chi legge vede sempre
 * nello stesso modo dove approfondire: progetto, repository, branch, file, simboli, commit.
 * L'app React ha un suo componente (ui/src/components/MemoryPanel.tsx) con lo stesso contenuto.
 */
import type { CodeRefs } from './events'

/** Numero massimo di file/simboli/commit elencati nelle forme compatte (il resto è "+N"). */
const COMPACT = 6

/** Elenca al massimo `n` voci, segnalando quante ne restano fuori. */
function list (xs: string[], n: number, fmt: (x: string) => string = (x) => x): string {
  const shown = xs.slice(0, n).map(fmt).join(', ')
  return xs.length > n ? `${shown} (+${xs.length - n})` : shown
}

/**
 * Righe Markdown con i riferimenti al codice, o [] se il ricordo non ne ha.
 * Esempio:
 *   Progetto: ordini (branch feature/conferma) · https://dev.azure.com/org/prj/_git/ordini
 *   File: `src/orders/order.service.ts`, `src/orders/orders.controller.ts`
 *   Simboli: class OrderService, POST /orders/confirm
 *   Commit: 1a2b3c4d, 5e6f7a8b
 * @param full true = tutte le voci (dettaglio, export); false = forma compatta (risultati di ricerca)
 */
export function formatCodeRefs (code: CodeRefs | undefined, full = true): string[] {
  if (!code) return []
  const n = full ? Infinity : COMPACT
  const lines: string[] = []
  const where = [code.project, code.branch ? `(branch ${code.branch})` : ''].filter(Boolean).join(' ')
  if (where || code.repo) lines.push(`Progetto: ${[where, code.repo].filter(Boolean).join(' · ')}`)
  if (code.files.length) lines.push(`File: ${list(code.files, n, (f) => `\`${f}\``)}`)
  if (code.symbols.length) lines.push(`Simboli: ${list(code.symbols, n)}`)
  if (code.commits.length) lines.push(`Commit: ${list(code.commits, n, (c) => c.slice(0, 8))}`)
  return lines
}
