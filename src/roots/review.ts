/**
 * @file Revisione delle Radici (Fase 8): invece di dimenticare il sapere fondante, lo si RIVEDE.
 *
 * Una Radice non decade mai, quindi il rischio opposto è che diventi FALSA senza che nessuno se ne
 * accorga (un'architettura cambiata, una policy aggiornata). La revisione, lanciata A MANO
 * (decisione dell'utente: niente promemoria periodici), cerca tre tipi di indizi:
 *
 * 1. CODICE cambiato: se la Radice cita dei file (`source.code.files`) e su questo PC c'è il
 *    repository del progetto, si guardano i commit su quei file DOPO l'ultima revisione, e se i
 *    file esistono ancora.
 * 2. DOCUMENTO d'origine cambiato: solo sul PC che possiede il documento (l'autore del ricordo),
 *    l'unico che sa se il file è stato modificato o rimosso.
 * 3. CONTRADDIZIONI: collegamenti "contradicts" già trovati dal dreaming, e un confronto con l'LLM
 *    fra la Radice e i ricordi PIÙ RECENTI e simili (al massimo MAX_LLM_CHECKS per revisione,
 *    entro il budget giornaliero).
 *
 * Il risultato sono delle SEGNALAZIONI (`root.flag`): la Radice diventa "da rivedere" e una
 * persona decide se confermarla, correggerla o toglierla. Nulla cambia da solo.
 * Ogni nodo vede solo ciò che ha in locale (repository, documenti propri): per questo il
 * resoconto riporta anche cosa NON è stato possibile verificare.
 */
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { CodeRefs } from '../core/events'
import type { RecallHit, RootRecord } from '../core/model'
import { cleanRemote, git, repoInfo, type RepoInfo } from '../ingest/git-changes'
import type { LlmRunner } from '../llm/runner'
import { cosine } from '../rank/hybrid'
import type { DocumentRecord } from '../store/private-store'

/** Chiamate LLM massime per revisione (una per Radice con ricordi recenti simili). */
export const MAX_LLM_CHECKS = 30
/** Ricordi recenti confrontati con ciascuna Radice. */
const CANDIDATES_PER_ROOT = 3
/** Commit citati al massimo in una segnalazione. */
const MAX_COMMIT_REFS = 10

/** Una segnalazione da pubblicare (`root.flag`). */
export interface RootFinding { id: string, reason: string, refs: string[] }

export interface ReviewReport {
  /** Radici esaminate. */
  checked: number
  findings: RootFinding[]
  /** Cosa non è stato possibile verificare, e perché (repository assenti, budget LLM…). */
  notes: string[]
}

export interface ReviewDeps {
  roots: RootRecord[]
  /** Ricordi attivi (arricchiti): le Radici e i loro possibili "contraddittori". */
  memories: RecallHit[]
  /** Chiave del nodo locale: i controlli sui documenti valgono solo per i ricordi propri. */
  localKey: string | null
  /** Cartelle in cui cercare i repository dei progetti (cartelle abilitate e loro sotto-cartelle). */
  folders: string[]
  documents: () => DocumentRecord[]
  /** Collegamenti espliciti (dreaming): quelli "contradicts" sono già una segnalazione. */
  links: { from: string, to: string, rel: string }[]
  /** Vettori dei ricordi e soglia di somiglianza; null = niente ricerca semantica. */
  vectors: Map<string, Float32Array> | null
  threshold: number
  llm: LlmRunner | null
  model: string
  language: string
  log: (msg: string) => void
}

// ═══════════════════════════════ 1. Codice ═══════════════════════════════

/**
 * Repository presenti su questo PC: le cartelle indicate e le loro sotto-cartelle dirette (chi
 * abilita "C:\progetti" ha spesso un repository per sotto-cartella).
 */
export function localRepos (folders: string[]): RepoInfo[] {
  const seen = new Map<string, RepoInfo>()
  const add = (dir: string) => {
    const info = repoInfo(dir)
    if (info && !seen.has(info.root)) seen.set(info.root, info)
  }
  for (const f of folders) {
    if (!fs.existsSync(f)) continue
    add(f)
    let children: fs.Dirent[] = []
    try { children = fs.readdirSync(f, { withFileTypes: true }) } catch { /* cartella illeggibile */ }
    for (const c of children.slice(0, 200)) {
      if (c.isDirectory() && fs.existsSync(path.join(f, c.name, '.git'))) add(path.join(f, c.name))
    }
  }
  return [...seen.values()]
}

/** Il repository locale di una Radice: stesso remote (preferito) o stesso nome di progetto. */
export function findRepo (code: CodeRefs, repos: RepoInfo[]): RepoInfo | null {
  const norm = (u: string) => cleanRemote(u).toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '')
  if (code.repo) {
    const byRemote = repos.find((r) => r.repo && norm(r.repo) === norm(code.repo!))
    if (byRemote) return byRemote
  }
  if (code.project) return repos.find((r) => r.project.toLowerCase() === code.project!.toLowerCase()) ?? null
  return null
}

/** Segnalazioni sul codice di una Radice: commit successivi alla revisione e file scomparsi. */
export function codeFindings (root: RootRecord, code: CodeRefs, repo: RepoInfo): RootFinding[] {
  const out: RootFinding[] = []
  const files = code.files.filter(Boolean)
  if (!files.length) return out
  const since = new Date(root.reviewedAt).toISOString()
  const log = git(repo.root, ['log', `--since=${since}`, '--no-merges', '--format=%H', '--', ...files]) ?? ''
  const commits = log.split('\n').map((l) => l.trim()).filter(Boolean)
  if (commits.length) {
    const shown = files.slice(0, 3).join(', ') + (files.length > 3 ? '…' : '')
    out.push({
      id: root.id,
      reason: `${commits.length} commit hanno modificato i file citati dopo l'ultima revisione (${shown})`,
      refs: commits.slice(0, MAX_COMMIT_REFS).map((h) => h.slice(0, 12))
    })
  }
  const missing = files.filter((f) => !fs.existsSync(path.join(repo.root, f)))
  if (missing.length) out.push({ id: root.id, reason: `File citati non più presenti: ${missing.slice(0, 5).join(', ')}`, refs: [] })
  return out
}

// ═══════════════════════════════ 2. Documenti ═══════════════════════════════

/**
 * Segnalazione sul documento d'origine di una Radice, se questo PC lo possiede: modificato
 * (stesso nome, contenuto diverso) o rimosso dalla cartella sorvegliata. null se tutto a posto o
 * se il documento non è di questo PC.
 */
export function documentFinding (root: RootRecord, mem: RecallHit, docs: DocumentRecord[]): RootFinding | null {
  const src = mem.source
  if (src?.type !== 'document' || !src.ref || !src.name) return null
  const same = docs.filter((d) => path.basename(d.path) === src.name)
  if (!same.length) return null // documento non di questo PC
  if (same.some((d) => d.hash === src.ref && d.status !== 'removed')) return null // ancora uguale
  if (same.every((d) => d.status === 'removed')) return { id: root.id, reason: `Il documento d'origine «${src.name}» è stato rimosso`, refs: [src.name] }
  return { id: root.id, reason: `Il documento d'origine «${src.name}» è stato modificato dopo la Radice`, refs: [src.name] }
}

// ═══════════════════════════════ 3. Contraddizioni ═══════════════════════════════

/** Verdetto dell'LLM sul confronto fra una Radice e ricordi più recenti. */
export const RootReviewVerdict = z.object({
  verdict: z.enum(['consistent', 'contradicts', 'updates']),
  /** Id dei ricordi recenti che la contraddicono o la aggiornano. */
  ids: z.array(z.string()),
  reason: z.string()
})
export type RootReviewVerdict = z.infer<typeof RootReviewVerdict>

/** Prompt di sistema del confronto. */
export function reviewSystem (language: string): string {
  const lang = language === 'en' ? 'inglese' : language === 'it' ? 'italiano' : language
  return `Sei il revisore delle RADICI di "Micelio", la memoria condivisa di un team di sviluppo. Una Radice è sapere
fondante (architettura, rete, interfacce, dominio, best practice, policy) che il team considera valido.
Ti viene data una Radice e alcuni ricordi PIÙ RECENTI sullo stesso argomento. Decidi:
- "consistent": i ricordi recenti sono compatibili con la Radice (o parlano d'altro);
- "contradicts": almeno un ricordo recente dice qualcosa di INCOMPATIBILE con la Radice;
- "updates": almeno un ricordo recente mostra che la Radice è superata o incompleta (es. un componente
  sostituito, una regola cambiata).
Sii prudente: segnala solo contraddizioni o aggiornamenti CHIARI e concreti, non sfumature.
"ids": gli id (esattamente come scritti fra parentesi quadre) dei ricordi che contraddicono o aggiornano.
"reason": una frase in ${lang} che spiega cosa è cambiato, comprensibile senza leggere i ricordi.`
}

/** Ricordi recenti (dopo l'ultima revisione) più simili a una Radice. */
export function recentSimilar (root: RootRecord, memories: RecallHit[], rootIds: Set<string>, vectors: Map<string, Float32Array>, threshold: number): RecallHit[] {
  const v = vectors.get(root.id)
  if (!v) return []
  return memories
    .filter((m) => !rootIds.has(m.id) && m.ts > root.reviewedAt && vectors.has(m.id))
    .map((m) => ({ m, s: cosine(v, vectors.get(m.id)!) }))
    .filter((x) => x.s >= threshold)
    .sort((a, b) => b.s - a.s)
    .slice(0, CANDIDATES_PER_ROOT)
    .map((x) => x.m)
}

// ═══════════════════════════════ Revisione ═══════════════════════════════

/** Esegue la revisione delle Radici indicate (vedi la descrizione del file). */
export async function reviewRoots (d: ReviewDeps): Promise<ReviewReport> {
  const findings: RootFinding[] = []
  const notes: string[] = []
  const byId = new Map(d.memories.map((m) => [m.id, m]))
  const rootIds = new Set(d.roots.map((r) => r.id))
  const repos = localRepos(d.folders)
  const docs = d.documents()
  const missingProjects = new Set<string>()
  let llmCalls = 0
  let llmSkipped = 0

  for (const root of d.roots) {
    const mem = byId.get(root.id)
    if (!mem) continue

    // 1) Codice
    const code = mem.source?.code
    if (code?.files.length) {
      const repo = findRepo(code, repos)
      if (repo) findings.push(...codeFindings(root, code, repo))
      else missingProjects.add(code.project ?? code.repo ?? '?')
    }

    // 2) Documento d'origine (solo i propri: gli altri PC non hanno il file)
    if (mem.author === d.localKey) {
      const f = documentFinding(root, mem, docs)
      if (f) findings.push(f)
    }

    // 3a) Contraddizioni già trovate dal dreaming, con ricordi successivi alla revisione
    for (const l of d.links) {
      if (l.rel !== 'contradicts' || (l.from !== root.id && l.to !== root.id)) continue
      const other = byId.get(l.from === root.id ? l.to : l.from)
      if (other && other.ts > root.reviewedAt) findings.push({ id: root.id, reason: `Contraddetta da un ricordo più recente: «${other.title}»`, refs: [other.id.slice(0, 12)] })
    }

    // 3b) Confronto con l'LLM sui ricordi recenti e simili
    if (!d.vectors) continue
    const candidates = recentSimilar(root, d.memories, rootIds, d.vectors, d.threshold)
    if (!candidates.length) continue
    if (!d.llm || llmCalls >= MAX_LLM_CHECKS || !d.llm.hasBudget(1)) { llmSkipped++; continue }
    llmCalls++
    try {
      const input = `RADICE:\n### ${mem.title}\n${mem.body}\n\nRICORDI PIÙ RECENTI:\n` +
        candidates.map((c) => `[${c.id}] ${c.title}\n${c.body}`).join('\n\n')
      const v = await d.llm.run({ name: 'root-review', system: reviewSystem(d.language), input, schema: RootReviewVerdict, model: d.model })
      // Solo id realmente proposti (il modello potrebbe inventarne)
      const ids = v.ids.filter((id) => candidates.some((c) => c.id === id))
      if (v.verdict !== 'consistent' && ids.length) {
        findings.push({ id: root.id, reason: `${v.verdict === 'contradicts' ? 'Contraddetta' : 'Forse superata'}: ${v.reason}`.slice(0, 500), refs: ids.map((id) => id.slice(0, 12)) })
      }
    } catch (err) {
      d.log(`revisione Radici: confronto LLM non riuscito per ${root.id.slice(0, 8)}: ${(err as Error).message}`)
      llmSkipped++
    }
  }

  if (missingProjects.size) notes.push(`Codice non verificato per i progetti assenti da questo PC: ${[...missingProjects].join(', ')}. Abilita la cartella del progetto o lancia la revisione dal PC di un collega che ce l'ha.`)
  if (!d.vectors) notes.push('Ricerca semantica non disponibile: contraddizioni cercate solo fra i collegamenti del dreaming.')
  if (llmSkipped) notes.push(`${llmSkipped} Radici non confrontate con i ricordi recenti (LLM assente, budget esaurito o limite di ${MAX_LLM_CHECKS} confronti per revisione).`)
  return { checked: d.roots.length, findings, notes }
}
