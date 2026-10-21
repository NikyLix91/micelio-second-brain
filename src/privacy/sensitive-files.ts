/**
 * @file File sensibili (Fase 9): file che per loro natura contengono segreti (`.env`, chiavi,
 * credenziali, kubeconfig…). Il loro CONTENUTO non entra mai in Micelio:
 * - nelle sessioni di Claude Code, se l'agente legge, scrive o modifica uno di questi file (anche
 *   via Bash, es. `cat .env`), il contenuto viene tolto PER INTERO dalla trascrizione prima di
 *   qualunque elaborazione: non solo redatto, perché un `.env` è fatto quasi solo di segreti e i
 *   pattern potrebbero lasciarne passare qualcuno;
 * - nelle cartelle di documenti questi file non vengono aperti;
 * - nel riassunto git delle modifiche se ne riporta solo il nome, mai il diff.
 *
 * EN: Sensitive files (Phase 9): files that by nature contain secrets (`.env`, keys,
 * credentials, kubeconfig…). Their CONTENT never enters Micelio:
 * - in Claude Code sessions, if the agent reads, writes or edits one of these files (also
 *   via Bash, e.g. `cat .env`), the content is removed ENTIRELY from the transcript before any
 *   processing: not just redacted, because a `.env` is almost only secrets and the patterns
 *   might let some of them through;
 * - in document folders these files are not opened;
 * - in the git summary of changes only their name is reported, never the diff.
 *
 * I pattern sono glob (sintassi di privacy/paths.ts) confrontati con il percorso o il solo nome
 * del file, senza distinguere maiuscole e minuscole. I file di ESEMPIO (`.env.example`…) sono
 * esclusi: per convenzione non contengono valori reali e documentano la configurazione.
 *
 * EN: The patterns are globs (privacy/paths.ts syntax) matched against the path or just the file
 * name, case-insensitively. SAMPLE files (`.env.example`…) are excluded: by convention they
 * contain no real values and document the configuration.
 */
import { globToRegExp } from './paths'

/** Pattern di default dei file sensibili. / EN: Default patterns for sensitive files. */
export const DEFAULT_SENSITIVE_FILES = [
  // Variabili d'ambiente e segreti applicativi
  // EN: Environment variables and application secrets
  '**/.env', '**/.env.*', '**/*.env', '**/secrets.*', '**/*secret*.json', '**/*secret*.yaml', '**/*secret*.yml',
  '**/credentials', '**/credentials.json', '**/*credentials*.json', '**/service-account*.json',
  // Chiavi e certificati con chiave privata
  // EN: Keys and certificates with a private key
  '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/*.jks', '**/*.keystore', '**/*.kdbx',
  // Chiavi SSH PRIVATE (la .pub è pubblica: non è un segreto)
  // EN: PRIVATE SSH keys (the .pub is public: not a secret)
  '**/id_rsa', '**/id_dsa', '**/id_ecdsa', '**/id_ed25519',
  // Credenziali di strumenti
  // EN: Tool credentials
  '**/.aws/credentials', '**/.npmrc', '**/.pypirc', '**/.netrc', '**/.git-credentials', '**/.docker/config.json',
  '**/kubeconfig', '**/.kube/config',
  // Infrastruttura come codice: valori e stato contengono segreti in chiaro
  // EN: Infrastructure as code: values and state contain plaintext secrets
  '**/*.tfvars', '**/*.tfstate', '**/*.tfstate.backup'
]

/** File di esempio: mai considerati sensibili, anche se il nome somiglia (es. `.env.example`). / EN: Sample files: never considered sensitive, even if the name looks similar (e.g. `.env.example`). */
const SAMPLE_FILE = /\.(example|sample|template|dist|defaults)$|\.(example|sample|template)\.[a-z]+$/i

/** Normalizza un percorso: barre "/", senza virgolette o prefissi "./". / EN: Normalizes a path: "/" slashes, no quotes or "./" prefixes. */
function norm (p: string): string {
  return p.trim().replace(/^["'`]|["'`]$/g, '').replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * Il pattern che rende sensibile un file, o null.
 *
 * EN: The pattern that makes a file sensitive, or null.
 * @param file  percorso (assoluto o relativo) o nome del file
 *        EN: path (absolute or relative) or file name
 * @param extra pattern aggiuntivi del team (`security.sensitiveFiles`)
 *        EN: additional team patterns (`security.sensitiveFiles`)
 */
export function sensitiveMatch (file: string, extra: string[] = []): string | null {
  const p = norm(file)
  if (!p) return null
  const name = p.split('/').pop() ?? p
  if (SAMPLE_FILE.test(name)) return null
  // Confronto sia sul percorso completo sia sul solo nome (i pattern "**/x" valgono ovunque).
  // EN: Match both the full path and the bare name ("**/x" patterns apply everywhere).
  const candidates = ['/' + p.replace(/^\/+/, ''), '/' + name]
  for (const pattern of [...DEFAULT_SENSITIVE_FILES, ...extra]) {
    const g = pattern.startsWith('/') || pattern.startsWith('**') ? pattern : '**/' + pattern
    const re = globToRegExp(g)
    if (candidates.some((c) => re.test(c))) return pattern
  }
  return null
}

/** Pattern in vigore: default + quelli del team. / EN: Patterns in effect: defaults + the team's. */
export function mergeSensitiveFiles (team: unknown): string[] {
  const extra = Array.isArray(team) ? team.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim()) : []
  return [...new Set([...DEFAULT_SENSITIVE_FILES, ...extra])]
}

/**
 * File sensibili citati in un comando di shell (es. `cat .env`, `type config\\secrets.json`,
 * `source ./.env.local && npm start`). Si spezza il comando in "parole" e si controlla ognuna.
 * Volutamente largo: meglio togliere l'esito di un comando innocuo che lasciar passare un `.env`.
 *
 * EN: Sensitive files mentioned in a shell command (e.g. `cat .env`, `type config\\secrets.json`,
 * `source ./.env.local && npm start`). The command is split into "words" and each one is checked.
 * Deliberately broad: better to drop the output of a harmless command than to let a `.env` through.
 */
export function sensitiveInCommand (command: string, extra: string[] = []): string[] {
  const words = command.split(/[\s;|&<>()=,]+/).map(norm).filter((w) => w.length > 1 && !w.startsWith('-'))
  return [...new Set(words.filter((w) => sensitiveMatch(w, extra)))]
}

/**
 * File sensibili toccati da una chiamata a uno strumento di Claude Code, guardando i campi
 * dell'input che contengono percorsi (Read/Write/Edit/MultiEdit/NotebookEdit…) o comandi (Bash).
 *
 * EN: Sensitive files touched by a Claude Code tool call, looking at the input fields that
 * contain paths (Read/Write/Edit/MultiEdit/NotebookEdit…) or commands (Bash).
 */
export function sensitiveInToolInput (input: unknown, extra: string[] = []): string[] {
  if (!input || typeof input !== 'object') return []
  const o = input as Record<string, unknown>
  const found: string[] = []
  for (const key of ['file_path', 'path', 'notebook_path', 'filePath']) {
    if (typeof o[key] === 'string' && sensitiveMatch(o[key] as string, extra)) found.push(o[key] as string)
  }
  if (typeof o.command === 'string') found.push(...sensitiveInCommand(o.command, extra))
  return [...new Set(found)]
}
