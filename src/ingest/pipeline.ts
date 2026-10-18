/**
 * @file Pipeline di ingestione (DESIGN §6, decisioni D6–D9).
 *
 * Decide cosa entra nel sapere del team e cosa no. Ogni contenuto segue lo stesso percorso:
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
 * Cosa NON va mai al team senza un umano: tutto ciò che il filtro blocca, tutto ciò che il
 * classificatore non giudica pulito con sicurezza (va in inbox, D9).
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
import { CLASSIFY_SYSTEM, Classification, Distilled, distillSystem } from './prompts'
import { type ChangeSummary, codeRefs, repoInfo, type RepoInfo, summarizeChanges } from './git-changes'
import { extractTranscript } from './transcript'

/** Sotto questa soglia di confidenza il classificatore non decide da solo: si va in inbox. */
export const CONFIDENCE_THRESHOLD = 0.8
/** Una sessione con meno testo di così non vale due chiamate LLM. */
const MIN_SESSION_CHARS = 400
/** Le modifiche non committate entrano nel riassunto git solo se il capitolo è finito da meno di così. */
const UNCOMMITTED_WINDOW_MS = 2 * 60 * 60 * 1000
/** Ogni quanto il worker controlla la coda. */
const WORKER_INTERVAL_MS = 3_000
/** Ogni quanto si eliminano gli elementi scaduti dell'inbox. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

/** Dipendenze iniettate dal nodo: la pipeline non conosce né la rete né il daemon. */
export interface PipelineDeps {
  store: PrivateStore
  /** null se l'utente ha scelto llm.adapter = "none". */
  llm: LlmRunner | null
  /** Modelli da usare: è una funzione perché l'utente può cambiarli a caldo dalla UI. */
  models: () => { classify: string, distill: string }
  /** Pubblica un ricordo nel team (evento memory.add). */
  /**
   * Pubblica nel team. `updated` = id del ricordo esistente che il nuovo ha aggiornato e
   * sostituito (B4, src/ingest/write-update.ts); `duplicate` = già presente, nulla scritto.
   */
  publish: (memory: MemoryData) => Promise<{ id: string, duplicate: boolean, updated?: string }>
  /** Regole del filtro in vigore: default + quelle del team. */
  rules: () => Promise<FilterRules>
  /** Pattern dei percorsi bloccati per i documenti: default + quelli del team. */
  blockedPaths: () => Promise<string[]>
  /** Lingua dei ricordi del team (`memory.language`). */
  language: () => Promise<string>
  /** Pattern AGGIUNTIVI di file sensibili del team (`security.sensitiveFiles`); i default valgono sempre. */
  sensitiveFiles?: () => Promise<string[]>
  /** Ricordi massimi per distillazione (`distill.maxMemories`, Fase 10); default 5. */
  maxMemories?: () => Promise<number>
  /** Il distillatore suggerisce una Radice (Fase 8): la decide l'utente (vista Radici). */
  suggestRoot?: (id: string, category: RootCategory, title: string) => void
  /** Promozione diretta a Radice: ricordi dalle cartelle di documenti "di Radici". */
  promoteRoot?: (id: string, category: RootCategory) => Promise<void>
  /** true se la cartella di documenti è marcata "di Radici". */
  rootFolder?: (folder: string) => boolean
  /** Aggiungere alle sessioni il riassunto delle modifiche git (config `watch.gitChanges`); default sì. */
  gitChanges?: () => boolean
  log: (msg: string) => void
  /** Avvisa chi osserva il nodo (UI) che una parte dello stato privato è cambiata. */
  notify?: (topic: 'inbox' | 'jobs' | 'decisions' | 'security') => void
}

/** Esito di un salvataggio esplicito, restituito a CLI e MCP. */
export type ExplicitOutcome =
  | { outcome: 'team', id: string, duplicate: boolean, memory: MemoryData, updated?: string }
  | { outcome: 'inbox', inboxId: string, reason: string, memory: MemoryData }
  | { outcome: 'private', reason: string }

/** Dove mandare un contenuto in base alla classificazione. */
export type Route = 'team' | 'inbox' | 'private' | 'discard'

/**
 * Regola di instradamento (D9). Funzione pura, testata a parte.
 *
 * - team:    il classificatore dice "team", nessun dato sensibile, confidenza alta;
 * - private: chiaramente personale/HR, confidenza alta e NIENTE di riutilizzabile;
 * - discard: chiaramente inutile, confidenza alta;
 * - inbox:   tutto il resto, cioè i casi dubbi (misti, sensibili ma utili, poco sicuri).
 */
export function route (c: Classification): Route {
  const sure = c.confidence >= CONFIDENCE_THRESHOLD
  if (c.destination === 'team' && c.sensitivity.length === 0 && sure) return 'team'
  if (c.destination === 'private' && sure && !c.reusable) return 'private'
  if (c.destination === 'discard' && sure) return 'discard'
  return 'inbox'
}

/** Applica il filtro a un ricordo già strutturato: blocco sull'insieme, redazione campo per campo. */
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

/** Mezzanotte locale successiva: quando si azzera il budget giornaliero. */
function msUntilTomorrow (): number {
  const d = new Date()
  d.setHours(24, 0, 5, 0)
  return d.getTime() - Date.now()
}

export class IngestPipeline {
  private workerTimer: NodeJS.Timeout | null = null
  private sweepTimer: NodeJS.Timeout | null = null
  /** true mentre il worker sta elaborando un lavoro: evita elaborazioni sovrapposte. */
  private busy = false

  constructor (private readonly deps: PipelineDeps) {}

  // ═══════════════════════════════ Worker ═══════════════════════════════

  /** Avvia il worker della coda e la pulizia periodica dell'inbox. */
  start (): void {
    this.sweep()
    this.workerTimer = setInterval(() => { this.tick().catch((e) => this.deps.log(`errore worker: ${e.message}`)) }, WORKER_INTERVAL_MS)
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    this.workerTimer.unref()
    this.sweepTimer.unref()
  }

  /** Ferma il worker e attende che il lavoro in corso finisca. */
  async stop (): Promise<void> {
    if (this.workerTimer) clearInterval(this.workerTimer)
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    while (this.busy) await new Promise((r) => setTimeout(r, 100))
  }

  /**
   * Elabora al massimo un lavoro della coda. Pubblico per i test (che non vogliono aspettare
   * il timer). @returns true se ha elaborato qualcosa
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
        log(`budget esaurito: sessione rinviata a domani`)
        store.retryJob(job.id, msg, msUntilTomorrow(), false)
      } else if (err instanceof LlmUnavailableError) {
        // CLI non installata o non autenticata: riproviamo più tardi, senza contare il tentativo.
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

  /**
   * Accoda una sessione di Claude Code terminata. La verifica "cartella opt-in" la fa chi chiama
   * (il nodo), perché dipende dalla configurazione locale.
   */
  enqueueSession (payload: { sessionId: string, transcriptPath: string, cwd: string }): number {
    const id = this.deps.store.enqueue('session', payload)
    this.notify('jobs')
    return id
  }

  /**
   * Elabora la PARTE NUOVA di una sessione: se una sessione viene ripresa più volte, ogni
   * SessionEnd elabora solo le righe aggiunte dall'ultima volta (session_progress).
   */
  private async processSession (job: Job): Promise<void> {
    const { store, llm, log } = this.deps
    const { sessionId, transcriptPath, cwd } = job.payload as { sessionId: string, transcriptPath: string, cwd: string }
    if (!existsSync(transcriptPath)) return log(`trascrizione assente: ${transcriptPath}`)

    const sensitive = (await this.deps.sensitiveFiles?.()) ?? []
    const ex = extractTranscript(transcriptPath, store.sessionLines(sessionId), sensitive)
    const source: SourceRef = { type: 'claude-code', ref: sessionId, cwd }
    // Il progresso va salvato solo quando la sessione è stata davvero gestita: se lanciamo un
    // errore (budget, LLM) la parte nuova verrà rielaborata al prossimo tentativo.
    const done = () => store.setSessionLines(sessionId, ex.lines)

    if (ex.userTurns === 0 || ex.text.length < MIN_SESSION_CHARS) return done()

    // 0) Modifiche al codice durante il capitolo (commit + lavoro non committato), se la cartella
    //    è un repository git. Vanno in coda alla conversazione e passano dallo stesso filtro.
    const changes = this.codeChanges(cwd, ex.firstAt, ex.lastAt, sensitive)
    const material = ex.text + changes.suffix

    // 1) Filtro deterministico: se blocca, il contenuto non lascia mai la macchina.
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
    if (!llm.hasBudget(2)) throw new LlmBudgetExceededError('budget insufficiente per una sessione')

    // 2) Classificazione sul testo già redatto.
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
    const memories = await this.distill(filtered.text)
    if (memories.length === 0) {
      this.logDecision(source, 'discarded', 'nessuna conoscenza riutilizzabile', firstUserLine(ex.text))
      return done()
    }
    for (const raw of memories) {
      // Riferimenti al codice (progetto, file, simboli, commit): dicono a chi legge dove approfondire.
      const code = codeRefs(raw, cwd, changes.info, changes.summary)
      const parsed = MemoryInput.safeParse({ ...raw, source: { type: 'claude-code', ref: sessionId, ...(code ? { code } : {}), rank: raw.rank, batch: raw.batch } })
      if (!parsed.success) continue // ricordo malformato prodotto dal modello: lo ignoriamo
      // Secondo passaggio di filtro sul ricordo distillato (il modello potrebbe aver
      // riportato un dato sensibile sfuggito alla prima redazione).
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
   */
  private codeChanges (cwd: string, firstAt: number | null, lastAt: number | null, sensitive: string[] = []): { suffix: string, info: RepoInfo | null, summary: ChangeSummary | null } {
    const none = { suffix: '', info: null, summary: null }
    if (!cwd || !existsSync(cwd)) return none
    try {
      // Identità del repository: serve ai riferimenti dei ricordi anche se il riassunto è spento.
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

  /**
   * Accoda un documento nuovo o modificato di una cartella sorvegliata (vedi documents.ts).
   * @param payload percorso assoluto, cartella sorvegliata di appartenenza, hash del contenuto
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
   * Le parti già elaborate sono salvate (chunks_done): se il budget finisce a metà documento, si
   * riparte dalla parte successiva invece che dall'inizio.
   */
  private async processDocument (job: Job): Promise<void> {
    const { store, llm, log } = this.deps
    const { path: file, folder, hash, size } = job.payload as { path: string, folder: string, hash: string, size: number }
    const rec = store.getDocument(file)
    // Il file è cambiato di nuovo dopo l'accodamento: questo lavoro è superato da uno più recente.
    if (rec && rec.hash !== hash) return
    const name = path.basename(file)
    const source: SourceRef = { type: 'document', ref: hash, cwd: folder }
    const save = (status: DocumentRecord['status'], chunksDone: number, memories: number) =>
      store.saveDocument({ path: file, hash, size, folder, status, chunksDone, memories })

    // 1) Regole sui percorsi: il documento non viene nemmeno aperto.
    const blockedBy = isBlockedPath(path.relative(folder, file), await this.deps.blockedPaths())
    if (blockedBy) {
      this.logDecision(source, 'blocked', `percorso protetto (${blockedBy})`, name)
      return save('blocked', 0, 0)
    }
    // File sensibile (.env, chiavi, credenziali…): non si apre nemmeno (Fase 9).
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
      this.logDecision(source, 'discarded', `testo non estraibile: ${(err as Error).message.slice(0, 120)}`, name)
      return save('failed', 0, 0)
    }
    const chunks = chunkText(text)
    const rules = await this.deps.rules()
    let memories = rec?.memories ?? 0
    const sourceInfo = { type: 'document', ref: hash, name, size, mime: mimeOf(file) }

    for (let i = rec?.chunksDone ?? 0; i < chunks.length; i++) {
      // Intestazione: aiuta il modello a capire che è un documento e quale parte sta leggendo.
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

  /**
   * Salvataggio esplicito: passa da filtro e classificazione come tutto il resto.
   * Se il LLM non è disponibile (o il budget è finito) il ricordo va in inbox: nel dubbio
   * non si pubblica.
   *
   * @throws ZodError se il ricordo non è valido (titolo troppo corto, corpo vuoto…)
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
   * @param overrides campi da sostituire prima della pubblicazione (titolo, corpo, tipo, tag)
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

  /** Rifiuta un elemento: non va al team e resta solo una riga nel registro delle decisioni. */
  /**
   * Toglie un elemento dall'inbox perché l'utente lo tiene come ricordo PERSONALE (B4): non va al
   * team, e nel registro risulta come scelta privata.
   * @returns il ricordo (già redatto dal filtro)
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

  /** Elimina gli elementi scaduti dell'inbox (registrandoli come decisioni "expired"). */
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

  /** Registro di sicurezza: solo se il filtro ha davvero tolto qualcosa (tipi e nomi, mai valori). */
  private audit (source: SourceRef, label: string, kinds: Record<string, number>, omitted: string[]): void {
    if (Object.keys(kinds).length === 0 && omitted.length === 0) return
    this.deps.store.addSecurityLog({ source, label, kinds, omitted })
    this.deps.notify?.('security')
  }

  // ═══════════════════════════════ Chiamate LLM ═══════════════════════════════

  private classify (text: string): Promise<Classification> {
    return this.deps.llm!.run({ name: 'classify', system: CLASSIFY_SYSTEM, input: text, schema: Classification, model: this.deps.models().classify })
  }

  /**
   * Distillazione. Il limite di ricordi (scelto dall'admin) è nel prompt e viene comunque fatto
   * rispettare qui; ogni ricordo riceve la sua POSIZIONE (`rank`) e quanti ne aveva proposti il
   * modello (`batch`): servono alle metriche di qualità (src/ingest/quality.ts).
   */
  private async distill (text: string): Promise<(Distilled['memories'][number] & { rank: number, batch: number })[]> {
    const max = (await this.deps.maxMemories?.()) ?? 5
    const out = await this.deps.llm!.run({
      name: 'distill', system: distillSystem(await this.deps.language(), max), input: text, schema: Distilled, model: this.deps.models().distill
    })
    const batch = out.memories.length
    return out.memories.slice(0, max).map((m, i) => ({ ...m, rank: i + 1, batch }))
  }
}

export class InboxNotFoundError extends LocalizedError {}

/** Prima domanda dell'utente, usata come anteprima nel registro delle decisioni. */
function firstUserLine (text: string): string {
  const m = text.match(/^UTENTE: (.*)$/m)
  return (m?.[1] ?? text).slice(0, 120)
}
