/**
 * @file Ricordi che invecchiano con il codice (B4).
 *
 * Un ricordo distillato da una sessione di codice cita progetto, file e commit (`source.code`).
 * Se DOPO la sua scrittura quei file sono cambiati molto, o non esistono più, il ricordo potrebbe
 * descrivere un codice che non c'è più. Per le Radici esiste la revisione manuale (src/roots);
 * per i ricordi normali basta un segnale automatico:
 * - **peso più basso** nella ricerca (l'attivazione si riduce, vedi `stalenessFactor`);
 * - **avviso** nei risultati ("codice cambiato: N commit sui file citati"), anche agli agenti,
 *   che così verificano sul codice attuale prima di fidarsi.
 *
 * Il calcolo usa i repository presenti su QUESTO PC (le cartelle abilitate e le loro
 * sotto-cartelle): ogni nodo vede i suoi, e il segnale resta locale (private.db), non va nel log.
 * Per non bloccare il daemon si fanno pochissime chiamate `git log` per repository (la storia dei
 * soli file citati, vedi commitsOn) e poi si contano in memoria i commit successivi a ciascun ricordo.
 *
 * EN: Memories that age with the code (B4).
 *
 * EN: A memory distilled from a coding session cites project, files and commits (`source.code`).
 * If those files changed a lot AFTER it was written, or no longer exist, the memory may describe
 * code that is gone. Roots have a manual review (src/roots); for normal memories an automatic
 * signal is enough:
 * - **lower weight** in search (activation is reduced, see `stalenessFactor`);
 * - **warning** in the results ("code changed: N commits on the cited files"), agents included,
 *   so they check the current code before trusting it.
 *
 * EN: The computation uses the repositories present on THIS PC (the enabled folders and their
 * subfolders): each node sees its own, and the signal stays local (private.db), it doesn't go into the log.
 * To avoid blocking the daemon, very few `git log` calls are made per repository (the history of the
 * cited files only, see commitsOn), then the commits after each memory are counted in memory.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { CodeRefs } from '../core/events'
import type { RecallHit } from '../core/model'
import { git, type RepoInfo } from '../ingest/git-changes'
import { findRepo } from '../roots/review'

/** Esito per un ricordo: commit successivi sui file citati e file citati non più presenti. / EN: Outcome for a memory: later commits on the cited files and cited files no longer present. */
export interface Staleness { commits: number, missing: number }

/** Commit di un repository: quando e quali file ha toccato. / EN: A repository commit: when, and which files it touched. */
interface CommitInfo { ts: number, files: string[] }

/** File per chiamata a git: la riga di comando ha un limite (circa 32 000 caratteri su Windows). / EN: Files per git call: the command line has a limit (about 32,000 characters on Windows). */
const FILES_PER_CALL = 200

/**
 * Commit di un repository che hanno toccato i file indicati, con i file toccati (fra quelli
 * indicati). Pochissime chiamate: una ogni FILES_PER_CALL file.
 *
 * Perché la storia dei soli file citati e non `--since`: git smette di scorrere la storia al
 * primo commit più vecchio della data, quindi con date non in ordine (rebase, cherry-pick)
 * salterebbe dei commit. La storia di pochi file è comunque veloce.
 * Formato di `git log --name-only --format=@%H %ct`: una riga "@<hash> <secondi>" per commit, poi i file.
 *
 * EN: Commits of a repository that touched the given files, with the touched files (among the
 * given ones). Very few calls: one every FILES_PER_CALL files.
 *
 * EN: Why the history of the cited files only and not `--since`: git stops walking the history at
 * the first commit older than the date, so with out-of-order dates (rebase, cherry-pick) it would
 * skip commits. The history of a few files is fast anyway.
 * Format of `git log --name-only --format=@%H %ct`: one "@<hash> <seconds>" line per commit, then the files.
 */
export function commitsOn (repo: RepoInfo, files: string[]): CommitInfo[] {
  const byHash = new Map<string, CommitInfo>()
  for (let i = 0; i < files.length; i += FILES_PER_CALL) {
    const out = git(repo.root, ['log', '--no-merges', '--name-only', '--format=@%H %ct', '--', ...files.slice(i, i + FILES_PER_CALL)]) ?? ''
    let cur: CommitInfo | null = null
    for (const line of out.split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (line.startsWith('@')) {
        const [hash, secs] = line.slice(1).split(' ')
        // Lo stesso commit può comparire in più chiamate (file in blocchi diversi): si unisce
        // EN: The same commit can show up in several calls (files in different chunks): merge them
        cur = byHash.get(hash) ?? { ts: Number(secs) * 1000, files: [] }
        byHash.set(hash, cur)
      } else {
        cur?.files.push(line.replace(/\\/g, '/'))
      }
    }
  }
  return [...byHash.values()]
}

/** Percorso confrontabile: barre "/", senza "./" iniziale, minuscolo. / EN: Comparable path: "/" separators, no leading "./", lowercase. */
const norm = (f: string) => f.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()

/**
 * Staleness di tutti i ricordi con file citati, raggruppati per repository.
 *
 * EN: Staleness of all memories with cited files, grouped by repository.
 * @param memories ricordi del team (quelli senza `source.code.files` vengono ignorati)
 *                 EN: the team's memories (those without `source.code.files` are ignored)
 * @param repos    repository presenti su questo PC (vedi localRepos)
 *                 EN: repositories present on this PC (see localRepos)
 * @returns id → esito, solo per i ricordi di cui si è trovato il repository
 *          EN: id → outcome, only for memories whose repository was found
 */
export function computeStaleness (memories: RecallHit[], repos: RepoInfo[]): Map<string, Staleness> {
  const byRepo = new Map<string, { repo: RepoInfo, items: { mem: RecallHit, code: CodeRefs }[] }>()
  for (const mem of memories) {
    const code = mem.source?.code
    if (!code?.files?.length) continue
    const repo = findRepo(code, repos)
    if (!repo) continue
    const g = byRepo.get(repo.root) ?? { repo, items: [] }
    g.items.push({ mem, code })
    byRepo.set(repo.root, g)
  }
  const out = new Map<string, Staleness>()
  for (const { repo, items } of byRepo.values()) {
    const allFiles = [...new Set(items.flatMap((i) => i.code.files))]
    const commits = commitsOn(repo, allFiles)
    for (const { mem, code } of items) {
      const files = new Set(code.files.map(norm))
      const after = commits.filter((c) => c.ts > mem.ts && c.files.some((f) => files.has(norm(f)))).length
      const missing = code.files.filter((f) => !fs.existsSync(path.join(repo.root, f))).length
      out.set(mem.id, { commits: after, missing })
    }
  }
  return out
}

/**
 * Quanto si riduce l'attivazione di un ricordo il cui codice è cambiato: −5% per commit e −20% per
 * file sparito, fino a un minimo di 0,5 (il ricordo resta trovabile, solo meno in alto).
 *
 * EN: How much the activation of a memory whose code changed is reduced: −5% per commit and −20% per
 * missing file, down to a minimum of 0.5 (the memory can still be found, just ranked lower).
 */
export function stalenessFactor (s: Staleness | undefined): number {
  if (!s) return 1
  return Math.max(0.5, 1 - 0.05 * s.commits - 0.2 * s.missing)
}
