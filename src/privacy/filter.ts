// Filtro deterministico locale (DESIGN §6.3). Gira PRIMA di qualunque chiamata LLM, perché le
// CLI inviano il contenuto al provider cloud: ciò che è palesemente sensibile non deve arrivarci.
//
// Due esiti diversi:
// - BLOCCO: argomenti HR/personali (valutazioni, retribuzioni, salute…) → il contenuto resta privato;
// - REDAZIONE: segreti e dati personali puntuali (token, password, IBAN, email…) → vengono
//   sostituiti da segnaposto e il resto prosegue (una sessione tecnica contiene spesso un token).

export interface FilterRules {
  /** Espressioni che, se presenti, bloccano il contenuto (argomenti HR / personali). */
  blockKeywords: string[]
}

export interface FilterResult {
  blocked: boolean
  /** Motivi del blocco (parole chiave trovate). */
  reasons: string[]
  /** Testo con segreti e dati personali sostituiti da segnaposto. */
  text: string
  /** Conteggio delle redazioni per tipo, es. { 'secret:github-token': 1, email: 2 }. */
  redactions: Record<string, number>
}

/**
 * Parole chiave di blocco di default (italiano + inglese). Sono frasi o termini poco ambigui in
 * un contesto tecnico: meglio qualche falso positivo (finisce in privato, l'utente può promuoverlo)
 * che una valutazione HR nel brain del team.
 */
export const DEFAULT_BLOCK_KEYWORDS = [
  'valutazione di fine anno', 'valutazione annuale', 'valutazione della risorsa', 'valutazione del dipendente',
  'colloquio di valutazione', 'scheda di valutazione', 'performance review', 'annual review', 'feedback annuale',
  'aumento di stipendio', 'aumento retributivo', 'stipendio', 'retribuzione', 'busta paga', 'RAL', 'superminimo',
  'licenziamento', 'licenziare', 'provvedimento disciplinare', 'lettera di richiamo', 'contestazione disciplinare',
  'certificato medico', 'malattia', 'maternità', 'paternità', 'legge 104',
  'salary', 'payslip', 'pay raise', 'disciplinary', 'termination letter', 'sick leave'
]

interface SecretPattern { type: string, re: RegExp }

// Ordine importante: i pattern specifici prima di quelli generici.
const SECRET_PATTERNS: SecretPattern[] = [
  { type: 'secret:private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { type: 'secret:anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { type: 'secret:openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { type: 'secret:aws-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: 'secret:github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g },
  { type: 'secret:gitlab-token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { type: 'secret:slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { type: 'secret:google-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: 'secret:jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // Credenziali dentro URL / stringhe di connessione: scheme://utente:password@host
  { type: 'secret:url-credentials', re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi },
  // Password=…; tipico delle connection string .NET / ODBC
  { type: 'secret:connection-password', re: /\b((?:password|pwd)\s*=\s*)[^;'"\s]+/gi },
  // Assegnazioni a variabili sensibili: API_KEY=…, "token": "…", secret: …
  { type: 'secret:assignment', re: /\b((?:[A-Za-z0-9_]*(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|access[_-]?key)[A-Za-z0-9_]*)["']?\s*[:=]\s*["']?)(?!\[REDACTED)[^\s"',;]{6,}/gi }
]

const PII_PATTERNS: SecretPattern[] = [
  { type: 'iban', re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g },
  { type: 'codice-fiscale', re: /\b[A-Z]{6}\d{2}[A-EHLMPR-T]\d{2}[A-Z]\d{3}[A-Z]\b/gi },
  { type: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Telefoni italiani/internazionali con almeno 9 cifre; evita numeri di versione e id.
  { type: 'telefono', re: /(?<![\w.])(?:\+\d{2}[\s.-]?)?3\d{2}[\s.-]?\d{3}[\s.-]?\d{3,4}(?![\w.])/g }
]

function escapeRe (s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function keywordRegex (kw: string): RegExp {
  // Parole intere; le sigle tutte maiuscole (es. RAL) sono case-sensitive per non colpire "ral" nel codice.
  const flags = /^[A-Z0-9]{2,5}$/.test(kw) ? 'g' : 'gi'
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(kw)}(?![\\p{L}\\p{N}_])`, flags + 'u')
}

export function applyFilter (input: string, rules: FilterRules = { blockKeywords: DEFAULT_BLOCK_KEYWORDS }): FilterResult {
  const reasons = new Set<string>()
  for (const kw of rules.blockKeywords) {
    if (keywordRegex(kw).test(input)) reasons.add(kw)
  }

  let text = input
  const redactions: Record<string, number> = {}
  for (const { type, re } of [...SECRET_PATTERNS, ...PII_PATTERNS]) {
    text = text.replace(re, (...m: string[]) => {
      redactions[type] = (redactions[type] ?? 0) + 1
      // Per i pattern con gruppi di contesto (es. "password=") manteniamo il prefisso.
      const prefix = typeof m[1] === 'string' && m[0].startsWith(m[1]) ? m[1] : ''
      const suffix = typeof m[2] === 'string' && m[0].endsWith(m[2]) ? m[2] : ''
      return `${prefix}[REDACTED:${type.replace('secret:', '')}]${suffix}`
    })
  }

  return { blocked: reasons.size > 0, reasons: [...reasons], text, redactions }
}

/** Unisce le regole di default con quelle del team (team.config `filter.blockKeywords`). */
export function mergeRules (teamKeywords: unknown): FilterRules {
  const extra = Array.isArray(teamKeywords) ? teamKeywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 1) : []
  return { blockKeywords: [...new Set([...DEFAULT_BLOCK_KEYWORDS, ...extra.map((k) => k.trim())])] }
}
