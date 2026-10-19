// Filtro deterministico locale (DESIGN §6.3). Gira PRIMA di qualunque chiamata LLM, perché le
// CLI inviano il contenuto al provider cloud: ciò che è palesemente sensibile non deve arrivarci.
//
// Due esiti diversi:
// - BLOCCO: argomenti HR/personali (valutazioni, retribuzioni, salute…) → il contenuto resta privato;
// - REDAZIONE: segreti e dati personali puntuali (token, password, IBAN, email…) → vengono
//   sostituiti da segnaposto e il resto prosegue (una sessione tecnica contiene spesso un token).
//
// Fase 9 (sicurezza dei segreti): più formati riconosciuti, stringhe ad alta entropia, e regole
// del TEAM decise dall'admin: pattern di segreti aggiuntivi ed ECCEZIONI per i falsi positivi.

/** Pattern di segreto aggiuntivo definito dal team (`security.secretPatterns`). */
export interface TeamSecretPattern { name: string, regex: string }

export interface FilterRules {
  /** Espressioni che, se presenti, bloccano il contenuto (argomenti HR / personali). */
  blockKeywords: string[]
  /** Pattern di segreti aggiuntivi del team, già compilati (vedi compileTeamPatterns). */
  secretPatterns?: SecretPattern[]
  /**
   * Eccezioni: valori da NON redigere anche se sembrano segreti (falsi positivi noti, es. un id
   * pubblico). Testo letterale, oppure espressione regolare se scritta fra barre: /^demo-.*$/
   */
  allow?: string[]
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

export interface SecretPattern {
  type: string
  re: RegExp
  /** Descrizione leggibile, mostrata nella schermata Sicurezza. */
  label?: string
}

// Ordine importante: i pattern specifici prima di quelli generici.
// Per i pattern con un gruppo di CONTESTO (es. "password=") il gruppo 1 resta nel testo e viene
// redatto solo il valore; un eventuale gruppo 2 finale (es. "@" di un URL) viene mantenuto.
export const SECRET_PATTERNS: SecretPattern[] = [
  { type: 'secret:private-key', label: 'Chiavi private (PEM, anche dentro JSON)', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { type: 'secret:anthropic-key', label: 'Chiavi Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { type: 'secret:stripe-key', label: 'Chiavi Stripe', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { type: 'secret:openai-key', label: 'Chiavi OpenAI', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { type: 'secret:aws-key', label: 'Chiavi di accesso AWS', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: 'secret:github-token', label: 'Token GitHub', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g },
  { type: 'secret:gitlab-token', label: 'Token GitLab', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { type: 'secret:npm-token', label: 'Token npm', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { type: 'secret:pypi-token', label: 'Token PyPI', re: /\bpypi-[A-Za-z0-9_-]{50,}/g },
  { type: 'secret:sendgrid-key', label: 'Chiavi SendGrid', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
  { type: 'secret:slack-token', label: 'Token Slack', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { type: 'secret:google-key', label: 'Chiavi API Google', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: 'secret:jwt', label: 'Token JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // Azure: chiave dell'account nelle connection string dello storage, firma dei token SAS
  { type: 'secret:azure-account-key', label: 'Chiavi degli account di storage Azure', re: /\b(AccountKey=)[A-Za-z0-9+/=]{40,}/g },
  { type: 'secret:azure-sas', label: 'Firme SAS di Azure', re: /\b(sig=)[A-Za-z0-9%+/=]{20,}/gi },
  // Header HTTP di autenticazione e "Bearer <token>" incollati nei log
  { type: 'secret:auth-header', label: 'Header Authorization (Bearer/Basic)', re: /\b(Authorization:\s*(?:Bearer|Basic|Token)\s+)[A-Za-z0-9._~+/=-]{8,}/gi },
  { type: 'secret:bearer', label: 'Token "Bearer"', re: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/g },
  // Credenziali dentro URL / stringhe di connessione: scheme://utente:password@host
  { type: 'secret:url-credentials', label: 'Credenziali dentro gli URL', re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi },
  // Password=…; tipico delle connection string .NET / ODBC
  { type: 'secret:connection-password', label: 'Password nelle stringhe di connessione', re: /\b((?:password|pwd)\s*=\s*)[^;'"\s]+/gi },
  // Assegnazioni a variabili sensibili: API_KEY=…, "token": "…", secret: …, private_key: …
  {
    type: 'secret:assignment',
    label: 'Variabili sensibili (API_KEY=…, "token": …, password: …)',
    re: /\b((?:[A-Za-z0-9_]*(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|access[_-]?key|private[_-]?key|credential)[A-Za-z0-9_]*)["']?\s*[:=]\s*["']?)(?!\[REDACTED)[^\s"',;]{6,}/gi
  }
]

export const PII_PATTERNS: SecretPattern[] = [
  { type: 'iban', label: 'IBAN', re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g },
  { type: 'codice-fiscale', label: 'Codici fiscali', re: /\b[A-Z]{6}\d{2}[A-EHLMPR-T]\d{2}[A-Z]\d{3}[A-Z]\b/gi },
  { type: 'email', label: 'Indirizzi email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Telefoni italiani/internazionali con almeno 9 cifre; evita numeri di versione e id.
  { type: 'telefono', label: 'Numeri di telefono', re: /(?<![\w.])(?:\+\d{2}[\s.-]?)?3\d{2}[\s.-]?\d{3}[\s.-]?\d{3,4}(?![\w.])/g }
]

/**
 * Stringhe ad ALTA ENTROPIA: token "anonimi" che nessun pattern specifico riconosce (chiavi
 * generate, segreti di app). Candidate: almeno 32 caratteri del tipo base64/url-safe, con
 * maiuscole, minuscole e cifre, ed entropia di Shannon ≥ HIGH_ENTROPY_BITS bit per carattere.
 * Esclusi per costruzione: hash e id ESADECIMALI (commit git, id dei ricordi) e parole normali.
 */
export const HIGH_ENTROPY_MIN_LENGTH = 32
export const HIGH_ENTROPY_BITS = 4.0
const HIGH_ENTROPY_CANDIDATE = /(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+/_=-]{32,}(?![A-Za-z0-9+/_=-])/g

/** Entropia di Shannon (bit per carattere) di una stringa. */
export function shannonEntropy (s: string): number {
  const freq = new Map<string, number>()
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1)
  let h = 0
  for (const n of freq.values()) { const p = n / s.length; h -= p * Math.log2(p) }
  return h
}

/** true se la stringa sembra un segreto generato (vedi HIGH_ENTROPY_*). */
export function looksLikeSecret (s: string): boolean {
  if (s.length < HIGH_ENTROPY_MIN_LENGTH) return false
  if (/^[0-9a-f]+$/i.test(s)) return false // hash ed id esadecimali (commit, sha256…)
  if (/^[A-Za-z_-]+$/.test(s) || /^[0-9_-]+$/.test(s)) return false // parole, identificatori, numeri
  if (!/[a-z]/.test(s) || !/[A-Z]/.test(s) || !/[0-9]/.test(s)) return false
  if (s.includes('REDACTED')) return false
  // Opzioni e identificatori composti, es. `NODE_OPTIONS=--max-old-space-size=6144`: parole intere
  // (tutte minuscole, tutte maiuscole o tutte cifre) separate da - _ = /. In un token generato
  // invece i pezzi mescolano maiuscole, minuscole e cifre. Falso positivo visto in un ricordo reale.
  const parts = s.split(/[-_=/+]+/).filter(Boolean)
  if (parts.length >= 3 && parts.every((p) => /^([a-z]+|[A-Z]+|[0-9]+|[A-Z][a-z]+)$/.test(p))) return false
  return shannonEntropy(s) >= HIGH_ENTROPY_BITS
}

/** Tipi riconosciuti dal motore, con la descrizione: elenco mostrato nella schermata Sicurezza. */
export function builtinDetectors (): { type: string, label: string }[] {
  return [
    ...[...SECRET_PATTERNS, ...PII_PATTERNS].map((p) => ({ type: p.type, label: p.label ?? p.type })),
    { type: 'secret:high-entropy', label: `Stringhe casuali ad alta entropia (≥ ${HIGH_ENTROPY_MIN_LENGTH} caratteri, hash esclusi)` }
  ]
}

function escapeRe (s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function keywordRegex (kw: string): RegExp {
  // Parole intere; le sigle tutte maiuscole (es. RAL) sono case-sensitive per non colpire "ral" nel codice.
  const flags = /^[A-Z0-9]{2,5}$/.test(kw) ? 'g' : 'gi'
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(kw)}(?![\\p{L}\\p{N}_])`, flags + 'u')
}

/**
 * Funzione che dice se un valore è un'ECCEZIONE del team (da non redigere).
 * Voci fra barre ("/…/") sono espressioni regolari; le altre testo letterale contenuto nel valore.
 */
function allowMatcher (allow: string[] = []): (value: string) => boolean {
  const tests = allow.map((a) => {
    if (a.length > 2 && a.startsWith('/') && a.endsWith('/')) {
      try { const re = new RegExp(a.slice(1, -1)); return (v: string) => re.test(v) } catch { return () => false }
    }
    return (v: string) => v.includes(a)
  })
  return (v) => tests.some((t) => t(v))
}

export function applyFilter (input: string, rules: FilterRules = { blockKeywords: DEFAULT_BLOCK_KEYWORDS }): FilterResult {
  const reasons = new Set<string>()
  for (const kw of rules.blockKeywords) {
    if (keywordRegex(kw).test(input)) reasons.add(kw)
  }

  let text = input
  const redactions: Record<string, number> = {}
  const allowed = allowMatcher(rules.allow)
  const count = (type: string) => { redactions[type] = (redactions[type] ?? 0) + 1 }

  // 1) Pattern noti (prima quelli del team: sono i più specifici per il contesto aziendale)
  for (const { type, re } of [...(rules.secretPatterns ?? []), ...SECRET_PATTERNS, ...PII_PATTERNS]) {
    text = text.replace(re, (...m: string[]) => {
      if (allowed(m[0])) return m[0]
      // Per i pattern con gruppi di contesto (es. "password=") manteniamo il prefisso.
      const prefix = typeof m[1] === 'string' && m[0].startsWith(m[1]) ? m[1] : ''
      const suffix = typeof m[2] === 'string' && m[0].endsWith(m[2]) ? m[2] : ''
      // IDEMPOTENZA: un valore già sostituito da un segnaposto non è un segreto. Senza questo
      // controllo "postgres://app:[REDACTED:…]@host" verrebbe riconosciuto di nuovo, e la
      // scansione dei ricordi segnalerebbe come sporchi ricordi già puliti.
      if (m[0].slice(prefix.length, m[0].length - suffix.length).includes('[REDACTED')) return m[0]
      count(type)
      return `${prefix}[REDACTED:${type.replace('secret:', '')}]${suffix}`
    })
  }

  // 2) Ciò che resta e "sembra" un segreto generato
  text = text.replace(HIGH_ENTROPY_CANDIDATE, (s) => {
    if (!looksLikeSecret(s) || allowed(s)) return s
    count('secret:high-entropy')
    return '[REDACTED:high-entropy]'
  })

  return { blocked: reasons.size > 0, reasons: [...reasons], text, redactions }
}

/**
 * Compila i pattern del team. Quelli non validi (o troppo lunghi) vengono scartati: una regola
 * sbagliata non deve fermare la pipeline. Il tipo diventa `secret:team:<nome>`.
 */
export function compileTeamPatterns (raw: unknown): SecretPattern[] {
  if (!Array.isArray(raw)) return []
  const out: SecretPattern[] = []
  for (const p of raw) {
    if (!p || typeof p.name !== 'string' || typeof p.regex !== 'string' || p.regex.length > 300 || !p.name.trim()) continue
    try {
      out.push({ type: `secret:team:${p.name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`, label: p.name.trim(), re: new RegExp(p.regex, 'g') })
    } catch { /* espressione non valida: ignorata (la UI la rifiuta già in inserimento) */ }
  }
  return out
}

/**
 * Regole in vigore: default + quelle del team.
 * @param teamKeywords `filter.blockKeywords`
 * @param teamPatterns `security.secretPatterns` ({ name, regex }[])
 * @param teamAllow    `security.allow` (eccezioni)
 */
export function mergeRules (teamKeywords: unknown, teamPatterns?: unknown, teamAllow?: unknown): FilterRules {
  const extra = Array.isArray(teamKeywords) ? teamKeywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 1) : []
  const allow = Array.isArray(teamAllow) ? teamAllow.filter((a): a is string => typeof a === 'string' && a.trim().length > 0).map((a) => a.trim()) : []
  return {
    blockKeywords: [...new Set([...DEFAULT_BLOCK_KEYWORDS, ...extra.map((k) => k.trim())])],
    secretPatterns: compileTeamPatterns(teamPatterns),
    allow
  }
}
