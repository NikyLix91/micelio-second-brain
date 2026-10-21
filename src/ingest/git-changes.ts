/**
 * @file Riassunto delle modifiche al codice durante una sessione (distillazione consapevole del diff).
 *
 * EN: Summary of the code changes made during a session (diff-aware distillation).
 *
 * La conversazione con l'agente spiega il PERCHÉ; la struttura del codice cambiata (file, classi,
 * funzioni, endpoint) sta invece nel repository. Per ogni capitolo di sessione ricaviamo da git:
 * - i commit fatti nell'intervallo di tempo del capitolo;
 * - le modifiche ancora non committate (se il capitolo è recente);
 * e ne facciamo un riassunto COMPATTO: file con il loro stato e le dichiarazioni aggiunte/rimosse.
 * Il riassunto viene aggiunto al materiale da distillare, così i ricordi possono dire "aggiunto
 * `OrderService` in src/orders: …" con i riferimenti a file e commit.
 *
 * EN: The conversation with the agent explains the WHY; the changed code structure (files, classes,
 * functions, endpoints) lives in the repository instead. For each session chapter we get from git:
 * - the commits made in the chapter's time window;
 * - the changes not yet committed (if the chapter is recent);
 * and we build a COMPACT summary: files with their status and the added/removed declarations.
 * The summary is added to the material to distill, so memories can say "added
 * `OrderService` in src/orders: …" with references to files and commits.
 *
 * Niente codice copiato: solo nomi di file, dichiarazioni e messaggi di commit (il codice è già
 * nel repository di tutti). Il riassunto passa comunque dal filtro privacy con il resto.
 *
 * EN: No code is copied: only file names, declarations and commit messages (the code is already
 * in everyone's repository). The summary still goes through the privacy filter with the rest.
 *
 * Ogni ricordo distillato da una sessione riceve poi i RIFERIMENTI al codice (`source.code`:
 * progetto, remote, branch, file, simboli, commit), così chi lo legge sa dove approfondire.
 * Vedi codeRefs() in fondo al file.
 * Se la cartella non è un repository git, o git non c'è, semplicemente non si aggiunge nulla.
 *
 * EN: Each memory distilled from a session then gets the code REFERENCES (`source.code`:
 * project, remote, branch, files, symbols, commits), so readers know where to dig deeper.
 * See codeRefs() at the end of the file.
 * If the folder is not a git repository, or git is missing, nothing is added.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { CodeRefs } from '../core/events'
import { sensitiveMatch } from '../privacy/sensitive-files'

/** Lunghezza massima del riassunto (resta una piccola parte del materiale da distillare). / EN: Maximum summary length (it stays a small part of the material to distill). */
export const MAX_SUMMARY_CHARS = 4000
/** Hash dell'albero vuoto di git: il "prima" del primo commit di un repository. / EN: Hash of git's empty tree: the "before" of a repository's first commit. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
/** Dichiarazioni elencate al massimo per file. / EN: Maximum declarations listed per file. */
const MAX_DECLS_PER_FILE = 8

/** Esegue git in una cartella; null se fallisce (non è un repo, git assente, timeout). Usata anche dalla revisione delle Radici. / EN: Runs git in a folder; null on failure (not a repo, git missing, timeout). Also used by the Roots review. */
export function git (cwd: string, args: string[]): string | null {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 15_000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 })
  return r.status === 0 && !r.error ? r.stdout : null
}

/**
 * Dichiarazioni riconosciute nelle righe di un diff (linguaggi più comuni). Euristica: basta per
 * dire "è stata aggiunta la classe X / l'endpoint Y", non per analizzare il codice.
 *
 * EN: Declarations recognized in diff lines (most common languages). Heuristic: enough to
 * say "class X / endpoint Y was added", not to analyze the code.
 */
const DECLARATIONS: RegExp[] = [
  // TypeScript / JavaScript
  // EN: TypeScript / JavaScript
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(class|interface|enum|type)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
  // C# / Java / Kotlin
  // EN: C# / Java / Kotlin
  /^\s*(?:public|internal|protected|private)?\s*(?:static\s+|sealed\s+|abstract\s+|partial\s+)*(class|interface|record|enum|struct)\s+([A-Za-z_]\w*)/,
  /^\s*(?:public|protected)\s+(?:static\s+|async\s+|override\s+|virtual\s+)*[\w<>[\],\s?]+\s+([A-Z]\w*)\s*\(/,
  // Python / Go / Rust
  // EN: Python / Go / Rust
  /^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/,
  /^\s*(?:pub\s+)?(fn|struct|enum|trait)\s+([A-Za-z_]\w*)/,
  // Endpoint HTTP: decoratori (NestJS, Spring, ASP.NET) e router stile Express
  // EN: HTTP endpoints: decorators (NestJS, Spring, ASP.NET) and Express-style routers
  /@(Get|Post|Put|Delete|Patch)\s*\(\s*['"]?([^'")]*)/,
  /\[Http(Get|Post|Put|Delete|Patch)\s*(?:\(\s*"([^"]*)")?/,
  /\b(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)/
]

/** Estrae un'etichetta leggibile ("class OrderService", "POST /orders") da una riga di codice. / EN: Extracts a readable label ("class OrderService", "POST /orders") from a line of code. */
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

interface FileChange { status: string, file: string, added: string[], removed: string[], sensitive?: boolean }

/** Analizza l'output di `git diff -U0 --name-status`-like: dichiarazioni aggiunte/rimosse per file. / EN: Parses `git diff -U0 --name-status`-like output: added/removed declarations per file. */
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
  // EN: A declaration "removed and re-added" (modified line) is not news: remove it from both.
  for (const c of out.values()) for (const d of [...c.added]) if (c.removed.has(d)) { c.added.delete(d); c.removed.delete(d) }
  return out
}

/** Stato dei file da `git diff --name-status` (A aggiunto, M modificato, D eliminato, R rinominato). / EN: File status from `git diff --name-status` (A added, M modified, D deleted, R renamed). */
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

/** Identità del repository in cui si lavorava: diventa `source.code` dei ricordi (progetto, remote, branch). / EN: Identity of the repository being worked on: it becomes the memories' `source.code` (project, remote, branch). */
export interface RepoInfo {
  /** Radice del repository sul disco locale: usata solo qui, MAI replicata nel team. / EN: Repository root on the local disk: used only here, NEVER replicated to the team. */
  root: string
  /** Nome della cartella radice: è il "progetto" mostrato nei ricordi. / EN: Name of the root folder: it is the "project" shown in memories. */
  project: string
  /** URL del remote "origin" senza credenziali, se c'è. / EN: URL of the "origin" remote without credentials, if any. */
  repo?: string
  /** Branch corrente (assente se HEAD è staccato). / EN: Current branch (missing if HEAD is detached). */
  branch?: string
}

/** Esito di summarizeChanges: testo per il distillatore + dati strutturati per i riferimenti. / EN: Result of summarizeChanges: text for the distiller + structured data for the references. */
export interface ChangeSummary {
  info: RepoInfo
  /** Sezione "MODIFICHE AL CODICE" da accodare alla conversazione; null se nel periodo non è cambiato nulla. / EN: "MODIFICHE AL CODICE" section to append to the conversation; null if nothing changed in the period. */
  text: string | null
  /** Hash COMPLETI dei commit del periodo (per validare quelli citati dal modello). / EN: FULL hashes of the period's commits (to validate the ones cited by the model). */
  commits: string[]
  /** File toccati nel periodo, relativi alla radice del repository. / EN: Files touched in the period, relative to the repository root. */
  files: string[]
}

/**
 * Toglie le credenziali da un URL di remote ("https://utente:token@host/…" → "https://host/…").
 * Gli URL in forma scp ("git@host:org/repo.git") non contengono segreti e restano come sono.
 *
 * EN: Strips credentials from a remote URL ("https://user:token@host/…" → "https://host/…").
 * scp-style URLs ("git@host:org/repo.git") contain no secrets and are left as they are.
 */
export function cleanRemote (url: string): string {
  return url.trim().replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, '$1')
}

/** Progetto, remote e branch del repository che contiene `cwd`; null se non è un repository git. / EN: Project, remote and branch of the repository containing `cwd`; null if it is not a git repository. */
export function repoInfo (cwd: string): RepoInfo | null {
  const root = git(cwd, ['rev-parse', '--show-toplevel'])?.trim()
  if (!root) return null
  const remote = git(root, ['remote', 'get-url', 'origin'])?.trim()
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim()
  return {
    root,
    project: path.basename(root),
    ...(remote ? { repo: cleanRemote(remote) } : {}),
    ...(branch && branch !== 'HEAD' ? { branch } : {})
  }
}

/**
 * Riassunto delle modifiche al codice nel repository che contiene `cwd`, nell'intervallo indicato.
 *
 * EN: Summary of the code changes in the repository containing `cwd`, in the given time window.
 * @param since inizio del capitolo di sessione (ms)
 *        EN: start of the session chapter (ms)
 * @param until fine del capitolo (ms)
 *        EN: end of the chapter (ms)
 * @param includeUncommitted aggiungere le modifiche non ancora committate (capitolo recente)
 *        EN: add the changes not yet committed (recent chapter)
 * @param sensitiveFiles pattern aggiuntivi di file sensibili (team): di quei file solo il nome, mai il diff
 *        EN: extra sensitive file patterns (team): for those files only the name, never the diff
 * @returns null se la cartella non è un repository git; altrimenti identità del repository e, se
 *          nel periodo è cambiato qualcosa, il testo da aggiungere al materiale di distillazione
 *          EN: null if the folder is not a git repository; otherwise the repository identity and, if
 *          something changed in the period, the text to add to the distillation material
 */
export function summarizeChanges (cwd: string, since: number, until: number, includeUncommitted: boolean, sensitiveFiles: string[] = []): ChangeSummary | null {
  const info = repoInfo(cwd)
  if (!info) return null
  const top = info.root
  const parts: { title: string, changes: FileChange[] }[] = []
  let commits: { hash: string, subject: string }[] = []

  // 1) Commit del periodo (margine di 2 minuti: i commit arrivano spesso subito dopo l'ultimo messaggio)
  // EN: 1) Commits of the period (2-minute margin: commits often come right after the last message)
  const iso = (ms: number) => new Date(ms).toISOString()
  const log = git(top, ['log', `--since=${iso(since - 120_000)}`, `--until=${iso(until + 120_000)}`, '--no-merges', '--format=%H%x09%s'])
  commits = (log ?? '').split('\n').filter(Boolean).map((l) => { const [h, ...s] = l.split('\t'); return { hash: h, subject: s.join('\t') } })
  if (commits.length > 0) {
    // Intervallo: dal genitore del commit più vecchio al più recente. Se il più vecchio è il PRIMO
    // commit del repository (nessun genitore) si confronta con l'albero vuoto di git: `<hash>^!`
    // non funziona su un commit radice e il riassunto restava vuoto.
    // EN: Range: from the parent of the oldest commit to the newest. If the oldest is the repository's
    //     FIRST commit (no parent) we compare against git's empty tree: `<hash>^!`
    //     does not work on a root commit and the summary used to stay empty.
    const oldest = commits[commits.length - 1].hash
    const range = git(top, ['rev-parse', '--verify', '--quiet', `${oldest}^`]) ? [`${oldest}^..${commits[0].hash}`] : [EMPTY_TREE, commits[0].hash]
    const names = parseNameStatus(git(top, ['diff', '--name-status', ...range]) ?? '')
    const decls = parseDiff(git(top, ['diff', '-U0', ...range]) ?? '')
    parts.push({
      title: `Commit nel periodo (${commits.length}): ${commits.slice(0, 6).map((c) => `${c.hash.slice(0, 8)} "${c.subject}"`).join('; ')}`,
      changes: toChanges(names, decls, sensitiveFiles)
    })
  }

  // 2) Modifiche non ancora committate (lavoro in corso), file nuovi non tracciati compresi
  // EN: 2) Changes not yet committed (work in progress), including new untracked files
  if (includeUncommitted) {
    const names = parseNameStatus(git(top, ['diff', '--name-status', 'HEAD']) ?? '')
    for (const f of (git(top, ['ls-files', '--others', '--exclude-standard']) ?? '').split('\n').filter(Boolean)) names.set(f, 'A')
    const decls = parseDiff(git(top, ['diff', '-U0', 'HEAD']) ?? '')
    if (names.size > 0) parts.push({ title: 'Modifiche non ancora committate', changes: toChanges(names, decls, sensitiveFiles) })
  }

  const files = [...new Set(parts.flatMap((p) => p.changes.map((c) => c.file)))]
  if (parts.length === 0) return { info, text: null, commits: [], files: [] }

  const where = [`progetto "${info.project}"`, info.branch ? `branch ${info.branch}` : ''].filter(Boolean).join(', ')
  const lines = [`MODIFICHE AL CODICE (${where}; riassunto automatico da git):`]
  for (const p of parts) {
    lines.push(p.title)
    for (const c of p.changes) {
      const detail = [
        c.added.length ? `+ ${c.added.slice(0, MAX_DECLS_PER_FILE).join(', ')}` : '',
        c.removed.length ? `- ${c.removed.slice(0, MAX_DECLS_PER_FILE).join(', ')}` : ''
      ].filter(Boolean).join(' | ')
      lines.push(`  ${c.file} (${STATUS_LABEL[c.status] ?? c.status}${c.sensitive ? ', file sensibile: contenuto escluso' : ''})${detail ? ': ' + detail : ''}`)
    }
  }
  const text = lines.join('\n')
  return {
    info,
    text: text.length > MAX_SUMMARY_CHARS ? text.slice(0, MAX_SUMMARY_CHARS) + '\n  […]' : text,
    commits: commits.map((c) => c.hash),
    files
  }
}

/** Unisce stato dei file e dichiarazioni; i file con dichiarazioni vengono prima. / EN: Merges file status and declarations; files with declarations come first. */
function toChanges (names: Map<string, string>, decls: Map<string, { added: Set<string>, removed: Set<string> }>, sensitiveFiles: string[] = []): FileChange[] {
  return [...names].map(([file, status]) => sensitiveMatch(file, sensitiveFiles)
    // File sensibile (.env, chiavi…): solo il nome, nessuna riga del diff (Fase 9)
    // EN: Sensitive file (.env, keys…): only the name, no diff lines (Phase 9)
    ? { file, status, added: [], removed: [], sensitive: true }
    : { file, status, added: [...(decls.get(file)?.added ?? [])], removed: [...(decls.get(file)?.removed ?? [])] })
    .sort((a, b) => (b.added.length + b.removed.length) - (a.added.length + a.removed.length))
    .slice(0, 40)
}

/** Riferimenti proposti dal distillatore per un ricordo (vedi Distilled in prompts.ts). / EN: References proposed by the distiller for a memory (see Distilled in prompts.ts). */
export interface ProposedRefs { files?: string[], symbols?: string[], commits?: string[] }

/**
 * Riferimenti al codice da allegare a un ricordo (`source.code`), a partire da ciò che propone il
 * distillatore e verificati su ciò che sappiamo da git. Il modello può sbagliare un hash o un
 * percorso: per questo
 * - i commit valgono solo se corrispondono (per prefisso) a un commit del capitolo, e si salvano
 *   con l'hash completo;
 * - i file si normalizzano a percorsi relativi alla radice con "/"; i percorsi assoluti fuori dal
 *   repository vengono scartati (rivelerebbero il disco di chi ha lavorato);
 * - i simboli sono testo libero, solo accorciati.
 * Progetto, remote e branch arrivano da git (o, fuori da un repository, dal nome della cartella).
 *
 * EN: Code references to attach to a memory (`source.code`), starting from what the distiller
 * proposes and checked against what we know from git. The model can get a hash or a path
 * wrong, so:
 * - commits count only if they match (by prefix) a commit of the chapter, and are saved
 *   with the full hash;
 * - files are normalized to root-relative paths with "/"; absolute paths outside the
 *   repository are dropped (they would reveal the disk of whoever worked on it);
 * - symbols are free text, only shortened.
 * Project, remote and branch come from git (or, outside a repository, from the folder name).
 *
 * @param proposed riferimenti indicati dal modello per QUESTO ricordo
 *        EN: references given by the model for THIS memory
 * @param cwd      cartella di lavoro della sessione
 *        EN: working folder of the session
 * @param info     identità del repository (null se la cartella non è un repository git)
 *        EN: repository identity (null if the folder is not a git repository)
 * @param summary  riassunto del capitolo (null se non calcolato)
 *        EN: chapter summary (null if not computed)
 * @returns i riferimenti, o undefined se non c'è nulla da dire
 *          EN: the references, or undefined if there is nothing to say
 */
export function codeRefs (proposed: ProposedRefs, cwd: string, info: RepoInfo | null, summary: ChangeSummary | null): CodeRefs | undefined {
  // La stessa radice può essere scritta in più modi: git restituisce il percorso lungo, la sessione
  // può usare la cartella di lavoro (sotto-cartella) o, su Windows, il nome corto 8.3 (MARIOR~1).
  // EN: The same root can be written in several ways: git returns the long path, the session
  //     may use the working folder (a subfolder) or, on Windows, the 8.3 short name (MARIOR~1).
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const roots = uniq([info?.root ?? '', cwd, realpath(cwd)].map(norm)).sort((a, b) => b.length - a.length)
  const files = uniq((proposed.files ?? []).map((f) => {
    let p = f.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    // Assoluto dentro al repository → relativo alla radice; assoluto fuori → scartato
    // EN: Absolute inside the repository → relative to the root; absolute outside → dropped
    if (/^([a-z]:)?\//i.test(p)) {
      const r = roots.find((r) => p.toLowerCase().startsWith(r.toLowerCase() + '/'))
      p = r ? toRepoRelative(p.slice(r.length + 1), r, info) : ''
    }
    return p
  })).slice(0, 30)
  const known = summary?.commits ?? []
  const commits = uniq((proposed.commits ?? [])
    .map((c) => c.trim().toLowerCase())
    .filter((c) => /^[0-9a-f]{7,40}$/.test(c))
    .map((c) => known.find((k) => k.startsWith(c)) ?? '')).slice(0, 20)
  const symbols = uniq((proposed.symbols ?? []).map((s) => s.trim().slice(0, 200))).slice(0, 30)
  const project = info?.project ?? (path.basename(cwd) || undefined)
  if (!project && files.length + commits.length + symbols.length === 0) return undefined
  return {
    ...(project ? { project } : {}),
    ...(info?.repo ? { repo: info.repo } : {}),
    ...(info?.branch ? { branch: info.branch } : {}),
    files,
    symbols,
    commits
  }
}

/** Elimina vuoti e doppioni mantenendo l'ordine. / EN: Removes empty values and duplicates, keeping the order. */
const uniq = (xs: string[]): string[] => [...new Set(xs.filter(Boolean))]

/** Percorso reale (risolve link e, su Windows, i nomi corti 8.3); il percorso stesso se non esiste. / EN: Real path (resolves links and, on Windows, 8.3 short names); the path itself if it does not exist. */
function realpath (p: string): string {
  try { return fs.realpathSync.native(p) } catch { return p }
}

/**
 * Un percorso relativo a `base` (la radice del repository o una sua sotto-cartella, es. la cartella
 * di lavoro della sessione) diventa relativo alla radice del repository.
 *
 * EN: A path relative to `base` (the repository root or one of its subfolders, e.g. the session's
 * working folder) becomes relative to the repository root.
 */
function toRepoRelative (rel: string, base: string, info: RepoInfo | null): string {
  if (!info) return rel
  const prefix = path.relative(realpath(info.root), realpath(base)).split(path.sep).join('/')
  return prefix && !prefix.startsWith('..') ? `${prefix}/${rel}` : rel
}
