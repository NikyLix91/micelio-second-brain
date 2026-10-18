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
 */
import fs from 'node:fs'
import path from 'node:path'
import type { CodeRefs } from '../core/events'
import type { RecallHit } from '../core/model'
import { git, type RepoInfo } from '../ingest/git-changes'
import { findRepo } from '../roots/review'

/** Esito per un ricordo: commit successivi sui file citati e file citati non più presenti. */
export interface Staleness { commits: number, missing: number }

/** Commit di un repository: quando e quali file ha toccato. */
interface CommitInfo { ts: number, files: string[] }

/** File per chiamata a git: la riga di comando ha un limite (circa 32 000 caratteri su Windows). */
const FILES_PER_CALL = 200

/**
 * Commit di un repository che hanno toccato i file indicati, con i file toccati (fra quelli
 * indicati). Pochissime chiamate: una ogni FILES_PER_CALL file.
 *
 * Perché la storia dei soli file citati e non `--since`: git smette di scorrere la storia al
 * primo commit più vecchio della data, quindi con date non in ordine (rebase, cherry-pick)
 * salterebbe dei commit. La storia di pochi file è comunque veloce.
 * Formato di `git log --name-only --format=@%H %ct`: una riga "@<hash> <secondi>" per commit, poi i file.
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
        cur = byHash.get(hash) ?? { ts: Number(secs) * 1000, files: [] }
        byHash.set(hash, cur)
      } else {
        cur?.files.push(line.replace(/\\/g, '/'))
      }
    }
  }
  return [...byHash.values()]
}

/** Percorso confrontabile: barre "/", senza "./" iniziale, minuscolo. */
const norm = (f: string) => f.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()

/**
 * Staleness di tutti i ricordi con file citati, raggruppati per repository.
 * @param memories ricordi del team (quelli senza `source.code.files` vengono ignorati)
 * @param repos    repository presenti su questo PC (vedi localRepos)
 * @returns id → esito, solo per i ricordi di cui si è trovato il repository
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
 */
export function stalenessFactor (s: Staleness | undefined): number {
  if (!s) return 1
  return Math.max(0.5, 1 - 0.05 * s.commits - 0.2 * s.missing)
}
