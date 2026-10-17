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
import { MemoryInput, type MemoryData } from '../core/events'
import { LlmBudgetExceededError, LlmUnavailableError } from '../llm/types'
import type { LlmRunner } from '../llm/runner'
import { applyFilter, type FilterRules } from '../privacy/filter'
import type { InboxItem, Job, PrivateStore, SourceRef } from '../store/private-store'
import { CLASSIFY_SYSTEM, Classification, Distilled, distillSystem } from './prompts'
import { extractTranscript } from './transcript'

/** Sotto questa soglia di confidenza il classificatore non decide da solo: si va in inbox. */
export const CONFIDENCE_THRESHOLD = 0.8
/** Una sessione con meno testo di così non vale due chiamate LLM. */
const MIN_SESSION_CHARS = 400
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
  publish: (memory: MemoryData) => Promise<{ id: string, duplicate: boolean }>
  /** Regole del filtro in vigore: default + quelle del team. */
  rules: () => Promise<FilterRules>
  /** Lingua dei ricordi del team (`memory.language`). */
  language: () => Promise<string>
  log: (msg: string) => void
  /** Avvisa chi osserva il nodo (UI) che una parte dello stato privato è cambiata. */
  notify?: (topic: 'inbox' | 'jobs' | 'decisions') => void
}

/** Esito di un salvataggio esplicito, restituito a CLI e MCP. */
export type ExplicitOutcome =
  | { outcome: 'team', id: string, duplicate: boolean, memory: MemoryData }
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
export function filterMemory (m: MemoryData, rules: FilterRules): { blocked: boolean, reasons: string[], memory: MemoryData } {
  const whole = applyFilter(`${m.title}\n${m.body}\n${m.tags.join(' ')}`, rules)
  return {
    blocked: whole.blocked,
    reasons: whole.reasons,
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

    const ex = extractTranscript(transcriptPath, store.sessionLines(sessionId))
    const source: SourceRef = { type: 'claude-code', ref: sessionId, cwd }
    // Il progresso va salvato solo quando la sessione è stata davvero gestita: se lanciamo un
    // errore (budget, LLM) la parte nuova verrà rielaborata al prossimo tentativo.
    const done = () => store.setSessionLines(sessionId, ex.lines)

    if (ex.userTurns === 0 || ex.text.length < MIN_SESSION_CHARS) return done()

    // 1) Filtro deterministico: se blocca, il contenuto non lascia mai la macchina.
    const rules = await this.deps.rules()
    const filtered = applyFilter(ex.text, rules)
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
      const parsed = MemoryInput.safeParse({ ...raw, source: { type: 'claude-code', ref: sessionId } })
      if (!parsed.success) continue // ricordo malformato prodotto dal modello: lo ignoriamo
      // Secondo passaggio di filtro sul ricordo distillato (il modello potrebbe aver
      // riportato un dato sensibile sfuggito alla prima redazione).
      const fm = filterMemory(parsed.data, rules)
      if (r === 'team' && !fm.blocked) {
        const res = await this.deps.publish(fm.memory)
        log(`ricordo ${res.duplicate ? 'già presente' : 'pubblicato'} dalla sessione ${sessionId.slice(0, 8)}: ${fm.memory.title}`)
      } else {
        const reason = fm.blocked ? `parole chiave: ${fm.reasons.join(', ')}` : `da verificare: ${c.reason}`
        this.addInbox(fm.memory, source, reason)
      }
    }
    done()
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
        return { outcome: 'team', id: res.id, duplicate: res.duplicate, memory: fm.memory }
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
    if (!item) throw new InboxNotFoundError(`Nessun elemento in inbox con id ${id}`)
    return item
  }

  // ═══════════════════════════════ Chiamate LLM ═══════════════════════════════

  private classify (text: string): Promise<Classification> {
    return this.deps.llm!.run({ name: 'classify', system: CLASSIFY_SYSTEM, input: text, schema: Classification, model: this.deps.models().classify })
  }

  private async distill (text: string): Promise<Distilled['memories']> {
    const out = await this.deps.llm!.run({
      name: 'distill', system: distillSystem(await this.deps.language()), input: text, schema: Distilled, model: this.deps.models().distill
    })
    return out.memories
  }
}

export class InboxNotFoundError extends Error {}

/** Prima domanda dell'utente, usata come anteprima nel registro delle decisioni. */
function firstUserLine (text: string): string {
  const m = text.match(/^UTENTE: (.*)$/m)
  return (m?.[1] ?? text).slice(0, 120)
}
