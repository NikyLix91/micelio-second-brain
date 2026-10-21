/**
 * @file Pipeline di ingestione (DESIGN §6, decisioni D6–D9).
 *
 * EN: Ingestion pipeline (DESIGN §6, decisions D6–D9).
 *
 * Decide cosa entra nel sapere del team e cosa no. Ogni contenuto segue lo stesso percorso:
 *
 * EN: It decides what enters the team's knowledge and what does not. All content follows the same path
 * (diagram below; legend: contenuto = content, filtro deterministico = deterministic filter (local, no LLM),
 * BLOCCATO = BLOCKED, privato (registro) = private (log), testo con segreti redatti = text with secrets
 * redacted, classificazione = classification, instradamento = routing, dubbio = doubtful,
 * scartato = discarded, distillazione = distillation, ricordi = memories, oppure = or):
 *
 *   contenuto ─▶ filtro deterministico ─┬─▶ BLOCCATO ─────────────────────────▶ privato (registro)
 *                (locale, nessun LLM)    │
 *                                        └─▶ testo con segreti redatti
 *                                              │
 *                                              ▼
 *                                        classificazione (Haiku) ─▶ instradamento (route)
 *                                              │
 *            ┌───────────────┬─────────────────┼────────────────────┐
 *            ▼               ▼                 ▼                    ▼
 *          team          dubbio (inbox)     privato             scartato
 *            │               │             (registro)          (registro)
 *            ▼               ▼
 *      distillazione (Sonnet) → ricordi ─▶ team (memory.add) oppure inbox
 *
 * Due ingressi:
 * - **esplicito** (`ingestExplicit`): l'utente o l'agente chiede di salvare un ricordo già
 *   scritto (CLI, MCP `remember`). È sincrono: chi chiama riceve subito l'esito. Non serve
 *   distillazione, il ricordo è già atomico (decisione D6).
 * - **sessioni** (`enqueueSession`): una sessione di Claude Code terminata in una cartella
 *   opt-in (D7). Asincrono: va in una coda persistente e un worker la elabora in background,
 *   rispettando il budget giornaliero (D8).
 *
 * EN: Two entry points:
 * - **explicit** (`ingestExplicit`): the user or the agent asks to save an already written
 *   memory (CLI, MCP `remember`). It is synchronous: the caller gets the outcome right away. No
 *   distillation needed, the memory is already atomic (decision D6).
 * - **sessions** (`enqueueSession`): a Claude Code session that ended in an opt-in
 *   folder (D7). Asynchronous: it goes into a persistent queue and a worker processes it in the background,
 *   within the daily budget (D8).
 *
 * Cosa NON va mai al team senza un umano: tutto ciò che il filtro blocca, tutto ciò che il
 * classificatore non giudica pulito con sicurezza (va in inbox, D9).
 *
 * EN: What NEVER reaches the team without a human: everything the filter blocks, everything the
 * classifier does not judge clean with confidence (it goes to the Inbox, D9).
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { LocalizedError } from '../core/errors'
import { MemoryInput, type MemoryData, type RootCategory } from '../core/events'
import { LlmBudgetExceededError, LlmUnavailableError } from '../llm/types'
import type { LlmRunner } from '../llm/runner'
import { applyFilter, type FilterRules } from '../privacy/filter'
import { isBlockedPath } from '../privacy/paths'
import { sensitiveMatch } from '../privacy/sensitive-files'
import type { DocumentRecord, InboxItem, Job, PrivateStore, SourceRef } from '../store/private-store'
import { CHUNK_CHARS, chunkText, extractText, MAX_CHUNKS, mimeOf } from './extract'
import { CLASSIFY_SYSTEM, Classification, Distilled, distillSystem, MICELIO_DELIVERED_HEADER, MICELIO_JUDGE_RULE } from './prompts'
import { type ChangeSummary, codeRefs, repoInfo, type RepoInfo, summarizeChanges } from './git-changes'
import { readTranscript } from './transcript-worker'

/** Sotto questa soglia di confidenza il classificatore non decide da solo: si va in inbox. / EN: Below this confidence threshold the classifier does not decide on its own: it goes to the Inbox. */
export const CONFIDENCE_THRESHOLD = 0.8
/** Una sessione con meno testo di così non vale due chiamate LLM. / EN: A session with less text than this is not worth two LLM calls. */
const MIN_SESSION_CHARS = 400
/** Le modifiche non committate entrano nel riassunto git solo se il capitolo è finito da meno di così. / EN: Uncommitted changes enter the git summary only if the chapter ended less than this long ago. */
const UNCOMMITTED_WINDOW_MS = 2 * 60 * 60 * 1000
/** Ogni quanto il worker controlla la coda. / EN: How often the worker checks the queue. */
const WORKER_INTERVAL_MS = 3_000
/** Ogni quanto si eliminano gli elementi scaduti dell'inbox. / EN: How often expired Inbox items are removed. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

/** Dipendenze iniettate dal nodo: la pipeline non conosce né la rete né il daemon. / EN: Dependencies injected by the node: the pipeline knows neither the network nor the daemon. */
export interface PipelineDeps {
  store: PrivateStore
  /** null se l'utente ha scelto llm.adapter = "none". / EN: null if the user chose llm.adapter = "none". */
  llm: LlmRunner | null
  /** Modelli da usare: è una funzione perché l'utente può cambiarli a caldo dalla UI. / EN: Models to use: it is a function because the user can change them live from the UI. */
  models: () => { classify: string, distill: string }
  /** Pubblica un ricordo nel team (evento memory.add). / EN: Publishes a memory to the team (memory.add event). */
  /**
   * Pubblica nel team. `updated` = id del ricordo esistente che il nuovo ha aggiornato e
   * sostituito (B4, src/ingest/write-update.ts); `duplicate` = già presente, nulla scritto.
   *
   * EN: Publishes to the team. `updated` = id of the existing memory the new one updated and
   * replaced (B4, src/ingest/write-update.ts); `duplicate` = already present, nothing written.
   */
  publish: (memory: MemoryData) => Promise<{ id: string, duplicate: boolean, updated?: string }>
  /** Regole del filtro in vigore: default + quelle del team. / EN: Filter rules in force: defaults + the team's. */
  rules: () => Promise<FilterRules>
  /** Pattern dei percorsi bloccati per i documenti: default + quelli del team. / EN: Blocked path patterns for documents: defaults + the team's. */
  blockedPaths: () => Promise<string[]>
  /** Lingua dei ricordi del team (`memory.language`). / EN: Language of the team's memories (`memory.language`). */
  language: () => Promise<string>
  /** Pattern AGGIUNTIVI di file sensibili del team (`security.sensitiveFiles`); i default valgono sempre. / EN: The team's EXTRA sensitive-file patterns (`security.sensitiveFiles`); the defaults always apply. */
  sensitiveFiles?: () => Promise<string[]>
  /** Ricordi massimi per distillazione (`distill.maxMemories`, Fase 10); default 5. / EN: Max memories per distillation (`distill.maxMemories`, Phase 10); default 5. */
  maxMemories?: () => Promise<number>
  /** Il distillatore suggerisce una Radice (Fase 8): la decide l'utente (vista Radici). / EN: The distiller suggests a Root (Phase 8): the user decides (Roots view). */
  suggestRoot?: (id: string, category: RootCategory, title: string) => void
  /** Promozione diretta a Radice: ricordi dalle cartelle di documenti "di Radici". / EN: Direct promotion to Root: memories from "Roots" document folders. */
  promoteRoot?: (id: string, category: RootCategory) => Promise<void>
  /** true se la cartella di documenti è marcata "di Radici". / EN: true if the document folder is marked as "Roots". */
  rootFolder?: (folder: string) => boolean
  /** Aggiungere alle sessioni il riassunto delle modifiche git (config `watch.gitChanges`); default sì. / EN: Whether to add the git changes summary to sessions (config `watch.gitChanges`); default yes. */
  gitChanges?: () => boolean
  log: (msg: string) => void
  /** Avvisa chi osserva il nodo (UI) che una parte dello stato privato è cambiata. / EN: Tells node observers (UI) that part of the private state changed. */
  notify?: (topic: 'inbox' | 'jobs' | 'decisions' | 'security') => void
  /**
   * Efficacia (B11). `evaluate` guarda la parte nuova della trascrizione: cosa ha fornito Micelio,
   * esito euristico; restituisce i ricordi forniti (per chiedere il giudizio all'LLM).
   * `verdicts` riceve il giudizio dell'LLM dato alla distillazione.
   *
   * EN: Efficacy (B11). `evaluate` looks at the new part of the transcript: what Micelio delivered,
   * heuristic outcome; it returns the delivered memories (to ask the LLM for its judgement).
   * `verdicts` receives the LLM judgement given at distillation.
   */
  efficacy?: {
    evaluate: (transcriptPath: string, fromLine: number, sessionId: string, cwd: string) => { id: string, short: string, title: string }[]
    verdicts: (sessionId: string, cwd: string, verdicts: Distilled['micelio']) => void
  }
}

/** Esito di un salvataggio esplicito, restituito a CLI e MCP. / EN: Outcome of an explicit save, returned to CLI and MCP. */
export type ExplicitOutcome =
  | { outcome: 'team', id: string, duplicate: boolean, memory: MemoryData, updated?: string }
  | { outcome: 'inbox', inboxId: string, reason: string, memory: MemoryData }
  | { outcome: 'private', reason: string }

/** Dove mandare un contenuto in base alla classificazione. / EN: Where to send content based on its classification. */
export type Route = 'team' | 'inbox' | 'private' | 'discard'

/**
 * Regola di instradamento (D9). Funzione pura, testata a parte.
 *
 * EN: Routing rule (D9). Pure function, tested separately.
 *
 * - team:    il classificatore dice "team", nessun dato sensibile, confidenza alta;
 * - private: chiaramente personale/HR, confidenza alta e NIENTE di riutilizzabile;
 * - discard: chiaramente inutile, confidenza alta;
 * - inbox:   tutto il resto, cioè i casi dubbi (misti, sensibili ma utili, poco sicuri).
 *
 * EN:
 * - team:    the classifier says "team", no sensitive data, high confidence;
 * - private: clearly personal/HR, high confidence and NOTHING reusable;
 * - discard: clearly useless, high confidence;
 * - inbox:   everything else, i.e. the doubtful cases (mixed, sensitive but useful, uncertain).
 */
export function route (c: Classification): Route {
  const sure = c.confidence >= CONFIDENCE_THRESHOLD
  if (c.destination === 'team' && c.sensitivity.length === 0 && sure) return 'team'
  if (c.destination === 'private' && sure && !c.reusable) return 'private'
  if (c.destination === 'discard' && sure) return 'discard'
  return 'inbox'
}

/** Applica il filtro a un ricordo già strutturato: blocco sull'insieme, redazione campo per campo. / EN: Applies the filter to an already structured memory: blocking on the whole, redaction field by field. */
export function filterMemory (m: MemoryData, rules: FilterRules): { blocked: boolean, reasons: string[], memory: MemoryData, redactions: Record<string, number> } {
  const whole = applyFilter(`${m.title}\n${m.body}\n${m.tags.join(' ')}`, rules)
  return {
    blocked: whole.blocked,
    reasons: whole.reasons,
    redactions: whole.redactions,
    memory: {
      ...m,
      title: applyFilter(m.title, rules).text,
      body: applyFilter(m.body, rules).text,
      tags: m.tags.map((t) => applyFilter(t, rules).text)
    }
  }
}

/** Mezzanotte locale successiva: quando si azzera il budget giornaliero. / EN: Next local midnight: when the daily budget resets. */
function msUntilTomorrow (): number {
  const d = new Date()
  d.setHours(24, 0, 5, 0)
  return d.getTime() - Date.now()
}

export class IngestPipeline {
  private workerTimer: NodeJS.Timeout | null = null
  private sweepTimer: NodeJS.Timeout | null = null
  /** true mentre il worker sta elaborando un lavoro: evita elaborazioni sovrapposte. / EN: true while the worker is processing a job: avoids overlapping runs. */
  private busy = false

  constructor (private readonly deps: PipelineDeps) {}

  // ═══════════════════════════════ Worker ═══════════════════════════════

  /** Avvia il worker della coda e la pulizia periodica dell'inbox. / EN: Starts the queue worker and the periodic Inbox cleanup. */
  start (): void {
    this.sweep()
    this.workerTimer = setInterval(() => { this.tick().catch((e) => this.deps.log(`errore worker: ${e.message}`)) }, WORKER_INTERVAL_MS)
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    this.workerTimer.unref()
    this.sweepTimer.unref()
  }

  /** Ferma il worker e attende che il lavoro in corso finisca. / EN: Stops the worker and waits for the current job to finish. */
  async stop (): Promise<void> {
    if (this.workerTimer) clearInterval(this.workerTimer)
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    while (this.busy) await new Promise((r) => setTimeout(r, 100))
  }

  /**
   * Elabora al massimo un lavoro della coda. Pubblico per i test (che non vogliono aspettare
   * il timer). @returns true se ha elaborato qualcosa
   *
   * EN: Processes at most one job from the queue. Public for tests (which do not want to wait for
   * the timer). Returns true if it processed something.
   */
  async tick (): Promise<boolean> {
    if (this.busy) return false
    const job = this.deps.store.nextJob()
    if (!job) return false
    this.busy = true
    try {
      await this.runJob(job)
    } finally {
      this.busy = false
    }
    return true
  }

  /**
   * Esegue un lavoro e decide se e quando riprovarlo in caso di errore.
   * Qualunque sia l'esito lo stato della coda cambia, quindi alla fine si notifica sempre "jobs".
   *
   * EN: Runs a job and decides whether and when to retry it on error.
   * Whatever the outcome, the queue state changes, so "jobs" is always notified at the end.
   */
  private async runJob (job: Job): Promise<void> {
    const { store, log } = this.deps
    try {
      if (job.kind === 'session') await this.processSession(job)
      else if (job.kind === 'document') await this.processDocument(job)
      else log(`lavoro di tipo sconosciuto "${job.kind}": scartato`)
      store.finishJob(job.id)
    } catch (err) {
      const msg = (err as Error).message
      if (err instanceof LlmBudgetExceededError) {
        // Non è un fallimento del lavoro: aspetta il budget di domani senza consumare tentativi.
        // EN: Not a job failure: wait for tomorrow's budget without using up attempts.
        log(`budget esaurito: sessione rinviata a domani`)
        store.retryJob(job.id, msg, msUntilTomorrow(), false)
      } else if (err instanceof LlmUnavailableError) {
        // CLI non installata o non autenticata: riproviamo più tardi, senza contare il tentativo.
        // EN: CLI not installed or not authenticated: retry later, without counting the attempt.
        store.retryJob(job.id, msg, 10 * 60 * 1000, false)
      } else {
        log(`lavoro ${job.id} fallito: ${msg}`)
        store.retryJob(job.id, msg, 5 * 60 * 1000)
      }
    } finally {
      this.notify('jobs')
    }
  }

  // ═══════════════════════════ Ingresso: sessioni ═══════════════════════════
  // EN: Entry point: sessions

  /**
   * Accoda una sessione di Claude Code terminata. La verifica "cartella opt-in" la fa chi chiama
   * (il nodo), perché dipende dalla configurazione locale.
   *
   * EN: Enqueues a finished Claude Code session. The "opt-in folder" check is done by the caller
   * (the node), because it depends on the local configuration.
   */
  enqueueSession (payload: { sessionId: string, transcriptPath: string, cwd: string }): number {
    const id = this.deps.store.enqueue('session', payload)
    this.notify('jobs')
    return id
  }

  /**
   * Elabora la PARTE NUOVA di una sessione: se una sessione viene ripresa più volte, ogni
   * SessionEnd elabora solo le righe aggiunte dall'ultima volta (session_progress).
   *
   * EN: Processes the NEW PART of a session: if a session is resumed several times, each
   * SessionEnd processes only the lines added since the last time (session_progress).
   */
  private async processSession (job: Job): Promise<void> {
    const { store, llm, log } = this.deps
    const { sessionId, transcriptPath, cwd } = job.payload as { sessionId: string, transcriptPath: string, cwd: string }
    if (!existsSync(transcriptPath)) return log(`trascrizione assente: ${transcriptPath}`)

    const sensitive = (await this.deps.sensitiveFiles?.()) ?? []
    const fromLine = store.sessionLines(sessionId)
    // In un worker thread: una trascrizione di centinaia di MB non blocca il daemon
    // EN: In a worker thread: a transcript of hundreds of MB doesn't block the daemon
    const ex = await readTranscript(transcriptPath, fromLine, sensitive)
    const source: SourceRef = { type: 'claude-code', ref: sessionId, cwd }
    // B11: cosa ha fornito Micelio in questa parte e se ne restano tracce (euristica, sempre:
    // anche le sessioni brevi o che non si distillano). Un errore qui non deve fermare la raccolta.
    // EN: B11: what Micelio delivered in this part and whether traces of it remain (heuristic, always:
    //     even short sessions or ones that are not distilled). An error here must not stop the collection.
    let delivered: { id: string, short: string, title: string }[] = []
    try { delivered = this.deps.efficacy?.evaluate(transcriptPath, fromLine, sessionId, cwd) ?? [] } catch (err) { log(`efficacia non valutata: ${(err as Error).message}`) }
    // Il progresso va salvato solo quando la sessione è stata davvero gestita: se lanciamo un
    // errore (budget, LLM) la parte nuova verrà rielaborata al prossimo tentativo.
    // EN: Progress is saved only when the session was really handled: if we throw an
    //     error (budget, LLM) the new part will be reprocessed on the next attempt.
    const done = () => store.setSessionLines(sessionId, ex.lines)

    if (ex.userTurns === 0 || ex.text.length < MIN_SESSION_CHARS) return done()

    // 0) Modifiche al codice durante il capitolo (commit + lavoro non committato), se la cartella
    //    è un repository git. Vanno in coda alla conversazione e passano dallo stesso filtro.
    // EN: 0) Code changes during the chapter (commits + uncommitted work), if the folder
    //        is a git repository. They are appended to the conversation and go through the same filter.
    const changes = this.codeChanges(cwd, ex.firstAt, ex.lastAt, sensitive)
    const material = ex.text + changes.suffix

    // 1) Filtro deterministico: se blocca, il contenuto non lascia mai la macchina.
    // EN: 1) Deterministic filter: if it blocks, the content never leaves the machine.
    const rules = await this.deps.rules()
    const filtered = applyFilter(material, rules)
    this.audit(source, firstUserLine(ex.text), filtered.redactions, ex.omitted)
    if (filtered.blocked) {
      this.logDecision(source, 'blocked', `parole chiave: ${filtered.reasons.join(', ')}`, firstUserLine(ex.text))
      return done()
    }
    if (!llm) {
      this.logDecision(source, 'discarded', 'nessun LLM configurato: sessione non elaborata', firstUserLine(ex.text))
      return done()
    }
    // Servono due chiamate (classificazione + distillazione): meglio non iniziare se ne manca una.
    // EN: Two calls are needed (classification + distillation): better not to start if one is missing.
    if (!llm.hasBudget(2)) throw new LlmBudgetExceededError('budget insufficiente per una sessione')

    // 2) Classificazione sul testo già redatto.
    // EN: 2) Classification on the already redacted text.
    const c = await this.classify(filtered.text)
    const r = route(c)
    if (r === 'private') {
      this.logDecision(source, 'private', c.reason, firstUserLine(ex.text))
      return done()
    }
    if (r === 'discard') {
      this.logDecision(source, 'discarded', c.reason, firstUserLine(ex.text))
      return done()
    }

    // 3) Distillazione: anche per i casi dubbi, così in inbox l'utente decide su ricordi
    //    concreti e non su un'intera sessione.
    // EN: 3) Distillation: for doubtful cases too, so in the Inbox the user decides on concrete
    //        memories and not on a whole session.
    const { memories, micelio } = await this.distillSession(filtered.text, delivered)
    if (micelio.length) {
      try { this.deps.efficacy?.verdicts(sessionId, cwd, micelio) } catch (err) { log(`giudizio di efficacia non salvato: ${(err as Error).message}`) }
    }
    if (memories.length === 0) {
      this.logDecision(source, 'discarded', 'nessuna conoscenza riutilizzabile', firstUserLine(ex.text))
      return done()
    }
    for (const raw of memories) {
      // Riferimenti al codice (progetto, file, simboli, commit): dicono a chi legge dove approfondire.
      // EN: Code references (project, files, symbols, commits): they tell the reader where to dig deeper.
      const code = codeRefs(raw, cwd, changes.info, changes.summary)
      const parsed = MemoryInput.safeParse({ ...raw, source: { type: 'claude-code', ref: sessionId, ...(code ? { code } : {}), rank: raw.rank, batch: raw.batch } })
      if (!parsed.success) continue // ricordo malformato prodotto dal modello: lo ignoriamo / EN: malformed memory produced by the model: we ignore it
      // Secondo passaggio di filtro sul ricordo distillato (il modello potrebbe aver
      // riportato un dato sensibile sfuggito alla prima redazione).
      // EN: Second filter pass on the distilled memory (the model may have
      //     carried over sensitive data that slipped past the first redaction).
      const fm = filterMemory(parsed.data, rules)
      if (r === 'team' && !fm.blocked) {
        const res = await this.deps.publish(fm.memory)
        log(`ricordo ${res.duplicate ? 'già presente' : res.updated ? `che aggiorna ${res.updated.slice(0, 8)}` : 'pubblicato'} dalla sessione ${sessionId.slice(0, 8)}: ${fm.memory.title}`)
        if (raw.root !== 'none') this.deps.suggestRoot?.(res.id, raw.root, fm.memory.title)
      } else {
        const reason = fm.blocked ? `parole chiave: ${fm.reasons.join(', ')}` : `da verificare: ${c.reason}`
        this.addInbox(fm.memory, source, reason)
      }
    }
    done()
  }

  /**
   * Contesto git del capitolo di sessione:
   * - `suffix`: sezione "MODIFICHE AL CODICE" da accodare al testo ("" se non disponibile o spenta);
   * - `info`: progetto, remote e branch (null fuori da un repository);
   * - `summary`: commit e file del capitolo, per verificare i riferimenti proposti dal modello.
   * Le modifiche non committate si includono solo se il capitolo è recente: altrimenti sarebbero
   * lavoro fatto dopo, in un altro momento (es. recupero di una sessione vecchia).
   *
   * EN: Git context of the session chapter:
   * - `suffix`: "MODIFICHE AL CODICE" (code changes) section to append to the text ("" if unavailable or turned off);
   * - `info`: project, remote and branch (null outside a repository);
   * - `summary`: commits and files of the chapter, to check the references proposed by the model.
   * Uncommitted changes are included only if the chapter is recent: otherwise they would be
   * work done later, at another time (e.g. recovery of an old session).
   */
  private codeChanges (cwd: string, firstAt: number | null, lastAt: number | null, sensitive: string[] = []): { suffix: string, info: RepoInfo | null, summary: ChangeSummary | null } {
    const none = { suffix: '', info: null, summary: null }
    if (!cwd || !existsSync(cwd)) return none
    try {
      // Identità del repository: serve ai riferimenti dei ricordi anche se il riassunto è spento.
      // EN: Repository identity: the memory references need it even if the summary is turned off.
      const info = repoInfo(cwd)
      if (!info || this.deps.gitChanges?.() === false || firstAt === null || lastAt === null) return { ...none, info }
      const recent = Date.now() - lastAt < UNCOMMITTED_WINDOW_MS
      const summary = summarizeChanges(cwd, firstAt, lastAt, recent, sensitive)
      return { suffix: summary?.text ? '\n\n' + summary.text : '', info, summary }
    } catch (e) {
      this.deps.log(`riassunto git non disponibile per ${cwd}: ${(e as Error).message}`)
      return none
    }
  }

  // ═══════════════════════════ Ingresso: documenti (Fase 4) ═══════════════════════════
  // EN: Entry point: documents (Phase 4)

  /**
   * Accoda un documento nuovo o modificato di una cartella sorvegliata (vedi documents.ts).
   *
   * EN: Enqueues a new or changed document from a watched folder (see documents.ts).
   * @param payload percorso assoluto, cartella sorvegliata di appartenenza, hash del contenuto
   *                EN: absolute path, watched folder it belongs to, content hash
   */
  enqueueDocument (payload: { path: string, folder: string, hash: string, size: number }): number {
    const prev = this.deps.store.getDocument(payload.path)
    this.deps.store.saveDocument({ ...payload, status: 'queued', chunksDone: 0, memories: prev?.hash === payload.hash ? prev.memories : 0 })
    const id = this.deps.store.enqueue('document', payload)
    this.notify('jobs')
    return id
  }

  /**
   * Elabora un documento: percorso bloccato? → privato senza leggerlo. Altrimenti estrae il testo,
   * lo divide in parti e, per ognuna, filtro → classificazione → distillazione, come le sessioni.
   * I ricordi prodotti portano il riferimento all'originale (hash, nome, dimensione, tipo) per il
   * download su richiesta (DESIGN §12-bis).
   *
   * EN: Processes a document: blocked path? → private without reading it. Otherwise it extracts the text,
   * splits it into parts and, for each, filter → classification → distillation, like sessions.
   * The resulting memories carry the reference to the original (hash, name, size, type) for
   * on-demand download (DESIGN §12-bis).
   *
   * Le parti già elaborate sono salvate (chunks_done): se il budget finisce a metà documento, si
   * riparte dalla parte successiva invece che dall'inizio.
   *
   * EN: Parts already processed are saved (chunks_done): if the budget runs out mid-document,
   * it resumes from the next part instead of from the beginning.
   */
  private async processDocument (job: Job): Promise<void> {
    const { store, llm, log } = this.deps
    const { path: file, folder, hash, size } = job.payload as { path: string, folder: string, hash: string, size: number }
    const rec = store.getDocument(file)
    // Il file è cambiato di nuovo dopo l'accodamento: questo lavoro è superato da uno più recente.
    // EN: The file changed again after being enqueued: this job is superseded by a newer one.
    if (rec && rec.hash !== hash) return
    const name = path.basename(file)
    const source: SourceRef = { type: 'document', ref: hash, cwd: folder }
    const save = (status: DocumentRecord['status'], chunksDone: number, memories: number) =>
      store.saveDocument({ path: file, hash, size, folder, status, chunksDone, memories })

    // 1) Regole sui percorsi: il documento non viene nemmeno aperto.
    // EN: 1) Path rules: the document is not even opened.
    const blockedBy = isBlockedPath(path.relative(folder, file), await this.deps.blockedPaths())
    if (blockedBy) {
      this.logDecision(source, 'blocked', `percorso protetto (${blockedBy})`, name)
      return save('blocked', 0, 0)
    }
    // File sensibile (.env, chiavi, credenziali…): non si apre nemmeno (Fase 9).
    // EN: Sensitive file (.env, keys, credentials…): not even opened (Phase 9).
    const sensitiveBy = sensitiveMatch(path.relative(folder, file), (await this.deps.sensitiveFiles?.()) ?? [])
    if (sensitiveBy) {
      this.logDecision(source, 'blocked', `file sensibile (${sensitiveBy})`, name)
      this.audit(source, name, {}, [name])
      return save('blocked', 0, 0)
    }
    if (!existsSync(file)) return save('removed', 0, 0)

    let text: string
    try {
      text = await extractText(file)
    } catch (err) {
      // Documento illeggibile (protetto da password, corrotto): non è un errore da riprovare.
      // EN: Unreadable document (password protected, corrupted): not an error worth retrying.
      this.logDecision(source, 'discarded', `testo non estraibile: ${(err as Error).message.slice(0, 120)}`, name)
      return save('failed', 0, 0)
    }
    const chunks = chunkText(text)
    const rules = await this.deps.rules()
    let memories = rec?.memories ?? 0
    const sourceInfo = { type: 'document', ref: hash, name, size, mime: mimeOf(file) }

    for (let i = rec?.chunksDone ?? 0; i < chunks.length; i++) {
      // Intestazione: aiuta il modello a capire che è un documento e quale parte sta leggendo.
      // EN: Header: helps the model understand it is a document and which part it is reading.
      const header = `DOCUMENTO: ${name}${chunks.length > 1 ? ` (parte ${i + 1} di ${chunks.length})` : ''}\n\n`
      const filtered = applyFilter(header + chunks[i], rules)
      this.audit(source, `${name}${chunks.length > 1 ? ` · parte ${i + 1}` : ''}`, filtered.redactions, [])
      if (filtered.blocked) {
        this.logDecision(source, 'blocked', `parole chiave: ${filtered.reasons.join(', ')}`, `${name} · parte ${i + 1}`)
        save('queued', i + 1, memories)
        continue
      }
      if (!llm) {
        this.logDecision(source, 'discarded', 'nessun LLM configurato: documento non elaborato', name)
        return save('done', chunks.length, memories)
      }
      if (!llm.hasBudget(2)) throw new LlmBudgetExceededError('budget insufficiente per una parte di documento')

      const c = await this.classify(filtered.text)
      const r = route(c)
      if (r === 'private' || r === 'discard') {
        this.logDecision(source, r === 'private' ? 'private' : 'discarded', c.reason, `${name} · parte ${i + 1}`)
      } else {
        for (const raw of await this.distill(filtered.text)) {
          const parsed = MemoryInput.safeParse({ ...raw, source: { ...sourceInfo, rank: raw.rank, batch: raw.batch } })
          if (!parsed.success) continue
          const fm = filterMemory(parsed.data, rules)
          if (r === 'team' && !fm.blocked) {
            const res = await this.deps.publish(fm.memory)
            memories++
            // Cartella "di Radici": promozione diretta (la scelta l'ha fatta chi ha marcato la
            // cartella); altrimenti, se il distillatore lo ritiene sapere fondante, un suggerimento.
            // EN: "Roots" folder: direct promotion (the choice was made by whoever marked the
            //     folder); otherwise, if the distiller sees it as foundational knowledge, a suggestion.
            if (this.deps.rootFolder?.(folder)) await this.deps.promoteRoot?.(res.id, raw.root !== 'none' ? raw.root : 'other')
            else if (raw.root !== 'none') this.deps.suggestRoot?.(res.id, raw.root, fm.memory.title)
          } else {
            this.addInbox(fm.memory, source, fm.blocked ? `parole chiave: ${fm.reasons.join(', ')}` : `da verificare: ${c.reason}`)
          }
        }
      }
      save('queued', i + 1, memories)
    }
    if (text.length > CHUNK_CHARS * MAX_CHUNKS) log(`documento ${name}: elaborate solo le prime ${MAX_CHUNKS} parti`)
    log(`documento ${name} elaborato: ${memories} ricordi`)
    save('done', chunks.length, memories)
  }

  // ═════════════════════════ Ingresso: esplicito (D6) ═════════════════════════
  // EN: Entry point: explicit (D6)

  /**
   * Salvataggio esplicito: passa da filtro e classificazione come tutto il resto.
   * Se il LLM non è disponibile (o il budget è finito) il ricordo va in inbox: nel dubbio
   * non si pubblica.
   *
   * EN: Explicit save: it goes through filter and classification like everything else.
   * If the LLM is unavailable (or the budget is used up) the memory goes to the Inbox: when in doubt,
   * nothing is published.
   *
   * @throws ZodError se il ricordo non è valido (titolo troppo corto, corpo vuoto…)
   *         EN: ZodError if the memory is invalid (title too short, empty body…)
   */
  async ingestExplicit (input: MemoryInput): Promise<ExplicitOutcome> {
    const { store, llm } = this.deps
    const memory = MemoryInput.parse(input)
    const source: SourceRef = { type: memory.source.type, ref: memory.source.ref }
    const rules = await this.deps.rules()

    const fm = filterMemory(memory, rules)
    this.audit(source, memory.title, fm.redactions, [])
    if (fm.blocked) {
      const reason = `contiene argomenti personali o HR (${fm.reasons.join(', ')})`
      this.logDecision(source, 'blocked', reason, memory.title)
      return { outcome: 'private', reason }
    }

    const toInbox = (reason: string): ExplicitOutcome => {
      const item = this.addInbox(fm.memory, source, reason)
      return { outcome: 'inbox', inboxId: item.id, reason, memory: fm.memory }
    }

    if (!llm) return toInbox('nessun LLM configurato per verificarlo')
    let c: Classification
    try {
      c = await this.classify(`${fm.memory.title}\n\n${fm.memory.body}`)
    } catch (err) {
      if (err instanceof LlmBudgetExceededError || err instanceof LlmUnavailableError) return toInbox(`verifica non disponibile: ${(err as Error).message}`)
      throw err
    }

    switch (route(c)) {
      case 'team': {
        const res = await this.deps.publish(fm.memory)
        return { outcome: 'team', id: res.id, duplicate: res.duplicate, memory: fm.memory, ...(res.updated ? { updated: res.updated } : {}) }
      }
      case 'private':
        this.logDecision(source, 'private', c.reason, memory.title)
        return { outcome: 'private', reason: c.reason }
      // Un salvataggio ESPLICITO non viene mai scartato in silenzio: se il classificatore lo
      // ritiene inutile, decide l'utente dall'inbox.
      // EN: An EXPLICIT save is never silently discarded: if the classifier
      //     considers it useless, the user decides from the Inbox.
      case 'discard':
        return toInbox(`poco riutilizzabile secondo il classificatore: ${c.reason}`)
      default:
        return toInbox(`da verificare: ${c.reason}`)
    }
  }

  // ════════════════════════════════ Inbox (D9) ════════════════════════════════

  listInbox (): InboxItem[] {
    return this.deps.store.listInbox()
  }

  /**
   * Approva un elemento dell'inbox e lo pubblica nel team, eventualmente con modifiche.
   * È una decisione umana: non si riclassifica, ma i segreti vengono comunque redatti.
   *
   * EN: Approves an Inbox item and publishes it to the team, possibly with edits.
   * It is a human decision: no reclassification, but secrets are still redacted.
   * @param overrides campi da sostituire prima della pubblicazione (titolo, corpo, tipo, tag)
   *                  EN: fields to replace before publishing (title, body, kind, tags)
   */
  async approve (id: string, overrides: Partial<Pick<MemoryData, 'title' | 'body' | 'kind' | 'tags'>> = {}): Promise<{ id: string, duplicate: boolean, memory: MemoryData }> {
    const item = this.requireInbox(id)
    const memory = MemoryInput.parse({ ...item.memory, ...overrides, source: { type: 'inbox', ref: item.source.ref } })
    const redacted = filterMemory(memory, await this.deps.rules()).memory
    const res = await this.deps.publish(redacted)
    this.deps.store.removeInbox(id)
    this.notify('inbox')
    return { ...res, memory: redacted }
  }

  /** Rifiuta un elemento: non va al team e resta solo una riga nel registro delle decisioni. / EN: Rejects an item: it does not go to the team and only a line in the decision log remains. */
  /**
   * Toglie un elemento dall'inbox perché l'utente lo tiene come ricordo PERSONALE (B4): non va al
   * team, e nel registro risulta come scelta privata.
   *
   * EN: Removes an item from the Inbox because the user keeps it as a PERSONAL memory (B4): it does not
   * go to the team, and the log records it as a private choice.
   * @returns il ricordo (già redatto dal filtro)
   *          EN: the memory (already redacted by the filter)
   */
  keepPrivately (id: string): MemoryData {
    const item = this.requireInbox(id)
    this.logDecision(item.source, 'private', 'tenuto come ricordo personale', item.memory.title)
    this.deps.store.removeInbox(id)
    this.notify('inbox')
    return item.memory
  }

  reject (id: string): void {
    const item = this.requireInbox(id)
    this.logDecision(item.source, 'rejected', 'rifiutato dall\'utente', item.memory.title)
    this.deps.store.removeInbox(id)
    this.notify('inbox')
  }

  // ═════════════════════════ Scritture con notifica ═════════════════════════
  // Ogni modifica all'archivio privato passa da qui, così la UI viene sempre avvisata.
  // EN: Writes with notification
  //     Every change to the private store goes through here, so the UI is always notified.

  private notify (topic: 'inbox' | 'jobs' | 'decisions'): void {
    this.deps.notify?.(topic)
  }

  private logDecision (...args: Parameters<PrivateStore['logDecision']>): void {
    this.deps.store.logDecision(...args)
    this.notify('decisions')
  }

  private addInbox (...args: Parameters<PrivateStore['addInbox']>): InboxItem {
    const item = this.deps.store.addInbox(...args)
    this.notify('inbox')
    return item
  }

  /** Elimina gli elementi scaduti dell'inbox (registrandoli come decisioni "expired"). / EN: Removes expired Inbox items (logging them as "expired" decisions). */
  private sweep (): void {
    if (this.deps.store.sweepInbox() > 0) {
      this.notify('inbox')
      this.notify('decisions')
    }
  }

  private requireInbox (id: string): InboxItem {
    const item = this.deps.store.getInbox(id)
    if (!item) throw new InboxNotFoundError(`Nessun elemento in inbox con id ${id}`, `No inbox item with id ${id}`)
    return item
  }

  /** Registro di sicurezza: solo se il filtro ha davvero tolto qualcosa (tipi e nomi, mai valori). / EN: Security log: only if the filter really removed something (types and names, never values). */
  private audit (source: SourceRef, label: string, kinds: Record<string, number>, omitted: string[]): void {
    if (Object.keys(kinds).length === 0 && omitted.length === 0) return
    this.deps.store.addSecurityLog({ source, label, kinds, omitted })
    this.deps.notify?.('security')
  }

  // ═══════════════════════════════ Chiamate LLM ═══════════════════════════════
  // EN: LLM calls

  private classify (text: string): Promise<Classification> {
    return this.deps.llm!.run({ name: 'classify', system: CLASSIFY_SYSTEM, input: text, schema: Classification, model: this.deps.models().classify })
  }

  /**
   * Distillazione. Il limite di ricordi (scelto dall'admin) è nel prompt e viene comunque fatto
   * rispettare qui; ogni ricordo riceve la sua POSIZIONE (`rank`) e quanti ne aveva proposti il
   * modello (`batch`): servono alle metriche di qualità (src/ingest/quality.ts).
   *
   * EN: Distillation. The memory limit (chosen by the admin) is in the prompt and is enforced
   * here anyway; each memory gets its POSITION (`rank`) and how many the model had proposed
   * (`batch`): the quality metrics need them (src/ingest/quality.ts).
   */
  private async distill (text: string): Promise<(Distilled['memories'][number] & { rank: number, batch: number })[]> {
    return (await this.distillSession(text, [])).memories
  }

  /**
   * Distillazione di una sessione. Se Micelio ha fornito ricordi all'assistente (B11), il loro
   * elenco va in coda al testo e il modello dà anche il giudizio d'uso (stessa chiamata, nessun
   * costo in più oltre a pochi token).
   *
   * EN: Distillation of a session. If Micelio delivered memories to the assistant (B11), their
   * list is appended to the text and the model also gives the usage judgement (same call, no
   * extra cost beyond a few tokens).
   */
  private async distillSession (text: string, delivered: { short: string, title: string }[]): Promise<{ memories: (Distilled['memories'][number] & { rank: number, batch: number })[], micelio: Distilled['micelio'] }> {
    const max = (await this.deps.maxMemories?.()) ?? 5
    const list = delivered.slice(0, 20)
    const input = list.length ? `${text}\n\n${MICELIO_DELIVERED_HEADER}\n${list.map((d) => `- [${d.short}] ${d.title}`).join('\n')}` : text
    const out = await this.deps.llm!.run({
      name: 'distill', system: distillSystem(await this.deps.language(), max) + (list.length ? MICELIO_JUDGE_RULE : ''), input, schema: Distilled, model: this.deps.models().distill
    })
    const batch = out.memories.length
    return { memories: out.memories.slice(0, max).map((m, i) => ({ ...m, rank: i + 1, batch })), micelio: out.micelio ?? [] }
  }
}

export class InboxNotFoundError extends LocalizedError {}

/** Prima domanda dell'utente, usata come anteprima nel registro delle decisioni. / EN: The user's first question, used as preview in the decision log. */
function firstUserLine (text: string): string {
  const m = text.match(/^UTENTE: (.*)$/m)
  return (m?.[1] ?? text).slice(0, 120)
}
