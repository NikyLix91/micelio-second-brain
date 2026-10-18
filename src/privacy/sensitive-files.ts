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
 * I pattern sono glob (sintassi di privacy/paths.ts) confrontati con il percorso o il solo nome
 * del file, senza distinguere maiuscole e minuscole. I file di ESEMPIO (`.env.example`…) sono
 * esclusi: per convenzione non contengono valori reali e documentano la configurazione.
 */
import { globToRegExp } from './paths'

/** Pattern di default dei file sensibili. */
export const DEFAULT_SENSITIVE_FILES = [
  // Variabili d'ambiente e segreti applicativi
  '**/.env', '**/.env.*', '**/*.env', '**/secrets.*', '**/*secret*.json', '**/*secret*.yaml', '**/*secret*.yml',
  '**/credentials', '**/credentials.json', '**/*credentials*.json', '**/service-account*.json',
  // Chiavi e certificati con chiave privata
  '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/*.jks', '**/*.keystore', '**/*.kdbx',
  // Chiavi SSH PRIVATE (la .pub è pubblica: non è un segreto)
  '**/id_rsa', '**/id_dsa', '**/id_ecdsa', '**/id_ed25519',
  // Credenziali di strumenti
  '**/.aws/credentials', '**/.npmrc', '**/.pypirc', '**/.netrc', '**/.git-credentials', '**/.docker/config.json',
  '**/kubeconfig', '**/.kube/config',
  // Infrastruttura come codice: valori e stato contengono segreti in chiaro
  '**/*.tfvars', '**/*.tfstate', '**/*.tfstate.backup'
]

/** File di esempio: mai considerati sensibili, anche se il nome somiglia (es. `.env.example`). */
const SAMPLE_FILE = /\.(example|sample|template|dist|defaults)$|\.(example|sample|template)\.[a-z]+$/i

/** Normalizza un percorso: barre "/", senza virgolette o prefissi "./". */
function norm (p: string): string {
  return p.trim().replace(/^["'`]|["'`]$/g, '').replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * Il pattern che rende sensibile un file, o null.
 * @param file  percorso (assoluto o relativo) o nome del file
 * @param extra pattern aggiuntivi del team (`security.sensitiveFiles`)
 */
export function sensitiveMatch (file: string, extra: string[] = []): string | null {
  const p = norm(file)
  if (!p) return null
  const name = p.split('/').pop() ?? p
  if (SAMPLE_FILE.test(name)) return null
  // Confronto sia sul percorso completo sia sul solo nome (i pattern "**/x" valgono ovunque).
  const candidates = ['/' + p.replace(/^\/+/, ''), '/' + name]
  for (const pattern of [...DEFAULT_SENSITIVE_FILES, ...extra]) {
    const g = pattern.startsWith('/') || pattern.startsWith('**') ? pattern : '**/' + pattern
    const re = globToRegExp(g)
    if (candidates.some((c) => re.test(c))) return pattern
  }
  return null
}

/** Pattern in vigore: default + quelli del team. */
export function mergeSensitiveFiles (team: unknown): string[] {
  const extra = Array.isArray(team) ? team.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim()) : []
  return [...new Set([...DEFAULT_SENSITIVE_FILES, ...extra])]
}

/**
 * File sensibili citati in un comando di shell (es. `cat .env`, `type config\\secrets.json`,
 * `source ./.env.local && npm start`). Si spezza il comando in "parole" e si controlla ognuna.
 * Volutamente largo: meglio togliere l'esito di un comando innocuo che lasciar passare un `.env`.
 */
export function sensitiveInCommand (command: string, extra: string[] = []): string[] {
  const words = command.split(/[\s;|&<>()=,]+/).map(norm).filter((w) => w.length > 1 && !w.startsWith('-'))
  return [...new Set(words.filter((w) => sensitiveMatch(w, extra)))]
}

/**
 * File sensibili toccati da una chiamata a uno strumento di Claude Code, guardando i campi
 * dell'input che contengono percorsi (Read/Write/Edit/MultiEdit/NotebookEdit…) o comandi (Bash).
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
