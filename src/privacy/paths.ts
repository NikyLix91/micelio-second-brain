/**
 * @file Regole di blocco sui PERCORSI dei documenti (DESIGN §6.3, completate in Fase 4).
 *
 * Un documento che si trova in una cartella "sensibile" (es. .../HR/..., .../contratti/...) non
 * viene nemmeno aperto: resta privato senza leggerne il contenuto né inviarlo a un LLM.
 *
 * I pattern sono glob semplici, confrontati con il percorso RELATIVO alla cartella sorvegliata
 * e senza distinguere maiuscole/minuscole (su Windows i percorsi non le distinguono):
 *   *    qualunque sequenza di caratteri tranne il separatore
 *   **   qualunque sequenza, separatori compresi (anche vuota)
 *   ?    un carattere
 */

/** Cartelle bloccate di default: argomenti personali, HR, contrattuali, retributivi. */
export const DEFAULT_BLOCKED_PATHS = [
  '**/hr/**', '**/risorse umane/**', '**/personale/**', '**/dipendenti/**',
  '**/contratti/**', '**/buste paga/**', '**/cedolini/**', '**/payroll/**',
  '**/valutazioni/**', '**/colloqui/**', '**/candidati/**', '**/curriculum/**', '**/cv/**',
  '**/private/**', '**/privato/**', '**/personal/**'
]

/** Converte un glob in espressione regolare (vedi intestazione per la sintassi). */
export function globToRegExp (glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      // "**/" all'inizio o in mezzo: zero o più cartelle intere
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
 * @param relPath es. "Progetto/HR/valutazione.docx"
 */
export function isBlockedPath (relPath: string, patterns: string[] = DEFAULT_BLOCKED_PATHS): string | null {
  const p = '/' + relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  for (const pattern of patterns) {
    const g = pattern.startsWith('/') || pattern.startsWith('**') ? pattern : '/' + pattern
    if (globToRegExp(g).test(p)) return pattern
  }
  return null
}

/** Pattern in vigore: default + quelli del team (team.config `filter.blockedPaths`). */
export function mergeBlockedPaths (team: unknown): string[] {
  const extra = Array.isArray(team) ? team.filter((p): p is string => typeof p === 'string' && p.trim().length > 0) : []
  return [...new Set([...DEFAULT_BLOCKED_PATHS, ...extra.map((p) => p.trim())])]
}
