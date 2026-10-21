/**
 * @file Regole di blocco sui PERCORSI dei documenti (DESIGN §6.3, completate in Fase 4).
 *
 * EN: Blocking rules on document PATHS (DESIGN §6.3, completed in Phase 4).
 *
 * Un documento che si trova in una cartella "sensibile" (es. .../HR/..., .../contratti/...) non
 * viene nemmeno aperto: resta privato senza leggerne il contenuto né inviarlo a un LLM.
 *
 * EN: A document in a "sensitive" folder (e.g. .../HR/..., .../contratti/...) is not
 * even opened: it stays private, without reading its content or sending it to an LLM.
 *
 * I pattern sono glob semplici, confrontati con il percorso RELATIVO alla cartella sorvegliata
 * e senza distinguere maiuscole/minuscole (su Windows i percorsi non le distinguono):
 *   *    qualunque sequenza di caratteri tranne il separatore
 *   **   qualunque sequenza, separatori compresi (anche vuota)
 *   ?    un carattere
 *
 * EN: Patterns are simple globs, matched against the path RELATIVE to the watched folder
 * and case-insensitively (on Windows paths are case-insensitive):
 *   *    any sequence of characters except the separator
 *   **   any sequence, separators included (even empty)
 *   ?    one character
 */

/** Cartelle bloccate di default: argomenti personali, HR, contrattuali, retributivi. / EN: Folders blocked by default: personal, HR, contract and payroll topics. */
export const DEFAULT_BLOCKED_PATHS = [
  '**/hr/**', '**/risorse umane/**', '**/personale/**', '**/dipendenti/**',
  '**/contratti/**', '**/buste paga/**', '**/cedolini/**', '**/payroll/**',
  '**/valutazioni/**', '**/colloqui/**', '**/candidati/**', '**/curriculum/**', '**/cv/**',
  '**/private/**', '**/privato/**', '**/personal/**'
]

/** Converte un glob in espressione regolare (vedi intestazione per la sintassi). / EN: Converts a glob into a regular expression (see the header for the syntax). */
export function globToRegExp (glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      // "**/" all'inizio o in mezzo: zero o più cartelle intere
      // EN: "**/" at the start or in the middle: zero or more whole folders
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i += 1 }
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

/**
 * true se il percorso (relativo alla cartella sorvegliata) corrisponde a un pattern bloccato.
 * I separatori di Windows vengono normalizzati in "/".
 *
 * EN: true if the path (relative to the watched folder) matches a blocked pattern.
 * Windows separators are normalized to "/".
 * @param relPath es. "Progetto/HR/valutazione.docx"
 *        EN: e.g. "Progetto/HR/valutazione.docx"
 */
export function isBlockedPath (relPath: string, patterns: string[] = DEFAULT_BLOCKED_PATHS): string | null {
  const p = '/' + relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  for (const pattern of patterns) {
    const g = pattern.startsWith('/') || pattern.startsWith('**') ? pattern : '/' + pattern
    if (globToRegExp(g).test(p)) return pattern
  }
  return null
}

/** Pattern in vigore: default + quelli del team (team.config `filter.blockedPaths`). / EN: Patterns in force: defaults + the team's ones (team.config `filter.blockedPaths`). */
export function mergeBlockedPaths (team: unknown): string[] {
  const extra = Array.isArray(team) ? team.filter((p): p is string => typeof p === 'string' && p.trim().length > 0) : []
  return [...new Set([...DEFAULT_BLOCKED_PATHS, ...extra.map((p) => p.trim())])]
}
