/**
 * @file Riassunto delle modifiche al codice durante una sessione (distillazione consapevole del diff).
 *
 * La conversazione con l'agente spiega il PERCHÉ; la struttura del codice cambiata (file, classi,
 * funzioni, endpoint) sta invece nel repository. Per ogni capitolo di sessione ricaviamo da git:
 * - i commit fatti nell'intervallo di tempo del capitolo;
 * - le modifiche ancora non committate (se il capitolo è recente);
 * e ne facciamo un riassunto COMPATTO: file con il loro stato e le dichiarazioni aggiunte/rimosse.
 * Il riassunto viene aggiunto al materiale da distillare, così i ricordi possono dire "aggiunto
 * `OrderService` in src/orders: …" con i riferimenti a file e commit.
 *
 * Niente codice copiato: solo nomi di file, dichiarazioni e messaggi di commit (il codice è già
 * nel repository di tutti). Il riassunto passa comunque dal filtro privacy con il resto.
 * Se la cartella non è un repository git, o git non c'è, semplicemente non si aggiunge nulla.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

/** Lunghezza massima del riassunto (resta una piccola parte del materiale da distillare). */
export const MAX_SUMMARY_CHARS = 4000
/** Dichiarazioni elencate al massimo per file. */
const MAX_DECLS_PER_FILE = 8

/** Esegue git in una cartella; null se fallisce (non è un repo, git assente, timeout). */
function git (cwd: string, args: string[]): string | null {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 15_000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 })
  return r.status === 0 && !r.error ? r.stdout : null
}

/**
 * Dichiarazioni riconosciute nelle righe di un diff (linguaggi più comuni). Euristica: basta per
 * dire "è stata aggiunta la classe X / l'endpoint Y", non per analizzare il codice.
 */
const DECLARATIONS: RegExp[] = [
  // TypeScript / JavaScript
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(class|interface|enum|type)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
  // C# / Java / Kotlin
  /^\s*(?:public|internal|protected|private)?\s*(?:static\s+|sealed\s+|abstract\s+|partial\s+)*(class|interface|record|enum|struct)\s+([A-Za-z_]\w*)/,
  /^\s*(?:public|protected)\s+(?:static\s+|async\s+|override\s+|virtual\s+)*[\w<>[\],\s?]+\s+([A-Z]\w*)\s*\(/,
  // Python / Go / Rust
  /^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/,
  /^\s*(?:pub\s+)?(fn|struct|enum|trait)\s+([A-Za-z_]\w*)/,
  // Endpoint HTTP: decoratori (NestJS, Spring, ASP.NET) e router stile Express
  /@(Get|Post|Put|Delete|Patch)\s*\(\s*['"]?([^'")]*)/,
  /\[Http(Get|Post|Put|Delete|Patch)\s*(?:\(\s*"([^"]*)")?/,
  /\b(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)/
]

/** Estrae un'etichetta leggibile ("class OrderService", "POST /orders") da una riga di codice. */
export function declarationOf (line: string): string | null {
  for (const re of DECLARATIONS) {
    const m = line.match(re)
    if (!m) continue
    const groups = m.slice(1).filter((g) => g !== undefined && g !== '')
    if (/^(Get|Post|Put|Delete|Patch|get|post|put|delete|patch)$/.test(groups[0] ?? '')) return `${groups[0].toUpperCase()} ${groups[1] ?? ''}`.trim()
    return groups.length >= 2 ? `${groups[0]} ${groups[1]}` : groups[0] ?? null
  }
  return null
}

interface FileChange { status: string, file: string, added: string[], removed: string[] }

/** Analizza l'output di `git diff -U0 --name-status`-like: dichiarazioni aggiunte/rimosse per file. */
export function parseDiff (diff: string): Map<string, { added: Set<string>, removed: Set<string> }> {
  const out = new Map<string, { added: Set<string>, removed: Set<string> }>()
  let current: { added: Set<string>, removed: Set<string> } | null = null
  for (const line of diff.split('\n')) {
    const header = line.match(/^\+\+\+ b\/(.+)$/)
    if (header) {
      current = out.get(header[1]) ?? { added: new Set(), removed: new Set() }
      out.set(header[1], current)
      continue
    }
    if (!current || line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+') || line.startsWith('-')) {
      const d = declarationOf(line.slice(1))
      if (d) (line.startsWith('+') ? current.added : current.removed).add(d)
    }
  }
  // Una dichiarazione "rimossa e riaggiunta" (riga modificata) non è una novità: la togliamo da entrambe.
  for (const c of out.values()) for (const d of [...c.added]) if (c.removed.has(d)) { c.added.delete(d); c.removed.delete(d) }
  return out
}

/** Stato dei file da `git diff --name-status` (A aggiunto, M modificato, D eliminato, R rinominato). */
function parseNameStatus (text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 2) continue
    const status = parts[0][0]
    out.set(parts[parts.length - 1], status)
  }
  return out
}

const STATUS_LABEL: Record<string, string> = { A: 'nuovo', M: 'modificato', D: 'eliminato', R: 'rinominato', C: 'copiato' }

/**
 * Riassunto delle modifiche al codice nel repository che contiene `cwd`, nell'intervallo indicato.
 * @param since inizio del capitolo di sessione (ms)
 * @param until fine del capitolo (ms)
 * @param includeUncommitted aggiungere le modifiche non ancora committate (capitolo recente)
 * @returns testo da aggiungere al materiale di distillazione, o null se non c'è nulla (o non è un repo)
 */
export function summarizeChanges (cwd: string, since: number, until: number, includeUncommitted: boolean): string | null {
  const top = git(cwd, ['rev-parse', '--show-toplevel'])?.trim()
  if (!top) return null
  const repo = path.basename(top)
  const parts: { title: string, changes: FileChange[] }[] = []

  // 1) Commit del periodo (margine di 2 minuti: i commit arrivano spesso subito dopo l'ultimo messaggio)
  const iso = (ms: number) => new Date(ms).toISOString()
  const log = git(top, ['log', `--since=${iso(since - 120_000)}`, `--until=${iso(until + 120_000)}`, '--no-merges', '--format=%H%x09%s'])
  const commits = (log ?? '').split('\n').filter(Boolean).map((l) => { const [h, ...s] = l.split('\t'); return { hash: h, subject: s.join('\t') } })
  if (commits.length > 0) {
    const oldest = commits[commits.length - 1].hash
    const range = git(top, ['rev-parse', '--verify', '--quiet', `${oldest}^`]) ? `${oldest}^..${commits[0].hash}` : commits[0].hash
    const names = parseNameStatus(git(top, ['diff', '--name-status', ...(range.includes('..') ? [range] : [`${range}^!`])]) ?? '')
    const decls = parseDiff(git(top, ['diff', '-U0', ...(range.includes('..') ? [range] : [`${range}^!`])]) ?? '')
    parts.push({
      title: `Commit nel periodo (${commits.length}): ${commits.slice(0, 6).map((c) => `${c.hash.slice(0, 8)} "${c.subject}"`).join('; ')}`,
      changes: toChanges(names, decls)
    })
  }

  // 2) Modifiche non ancora committate (lavoro in corso)
  if (includeUncommitted) {
    const names = parseNameStatus(git(top, ['diff', '--name-status', 'HEAD']) ?? '')
    for (const f of (git(top, ['ls-files', '--others', '--exclude-standard']) ?? '').split('\n').filter(Boolean)) names.set(f, 'A')
    const decls = parseDiff(git(top, ['diff', '-U0', 'HEAD']) ?? '')
    if (names.size > 0) parts.push({ title: 'Modifiche non ancora committate', changes: toChanges(names, decls) })
  }

  if (parts.length === 0) return null
  const lines = [`MODIFICHE AL CODICE (repository "${repo}", riassunto automatico da git):`]
  for (const p of parts) {
    lines.push(p.title)
    for (const c of p.changes) {
      const detail = [
        c.added.length ? `+ ${c.added.slice(0, MAX_DECLS_PER_FILE).join(', ')}` : '',
        c.removed.length ? `- ${c.removed.slice(0, MAX_DECLS_PER_FILE).join(', ')}` : ''
      ].filter(Boolean).join(' | ')
      lines.push(`  ${c.file} (${STATUS_LABEL[c.status] ?? c.status})${detail ? ': ' + detail : ''}`)
    }
  }
  const text = lines.join('\n')
  return text.length > MAX_SUMMARY_CHARS ? text.slice(0, MAX_SUMMARY_CHARS) + '\n  […]' : text
}

/** Unisce stato dei file e dichiarazioni; i file con dichiarazioni vengono prima. */
function toChanges (names: Map<string, string>, decls: Map<string, { added: Set<string>, removed: Set<string> }>): FileChange[] {
  return [...names].map(([file, status]) => ({ file, status, added: [...(decls.get(file)?.added ?? [])], removed: [...(decls.get(file)?.removed ?? [])] }))
    .sort((a, b) => (b.added.length + b.removed.length) - (a.added.length + a.removed.length))
    .slice(0, 40)
}
