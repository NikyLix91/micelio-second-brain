/**
 * @file Esecutore dei compiti LLM: serializzazione, budget giornaliero, retry (DESIGN §7, D8).
 *
 * EN: Runner for LLM tasks: serialization, daily budget, retry (DESIGN §7, D8).
 *
 * Perché serializzare (una chiamata alla volta): ogni chiamata lancia un processo `claude` che
 * consuma l'abbonamento dell'utente; in parallelo rischieremmo di saturarne i limiti e di
 * rallentare la sua sessione di lavoro.
 *
 * EN: Why serialize (one call at a time): each call starts a `claude` process that uses the
 * user's subscription; in parallel we would risk hitting its limits and slowing down the
 * user's working session.
 *
 * Il budget è contato nell'archivio privato (tabella llm_usage, una riga per giorno), quindi
 * sopravvive ai riavvii del daemon. Ogni TENTATIVO conta, anche quelli falliti: è il consumo reale.
 *
 * EN: The budget is counted in the private store (llm_usage table, one row per day), so it
 * survives daemon restarts. Every ATTEMPT counts, failed ones too: that is the real usage.
 */
import type { PrivateStore } from '../store/private-store'
import { type LlmAdapter, LlmBudgetExceededError, type LlmTask, LlmUnavailableError } from './types'

export interface LlmRunnerOptions {
  /**
   * Chiamate massime al giorno (config `llm.dailyBudget`). Funzione perché il valore si può
   * cambiare a caldo dalla UI: viene riletto a ogni chiamata.
   *
   * EN: Maximum calls per day (config `llm.dailyBudget`). A function because the value can be
   * changed live from the UI: it is read again on every call.
   */
  dailyBudget: () => number
  log?: (msg: string) => void
}

export class LlmRunner {
  /** Coda implicita: ogni chiamata si accoda alla promessa della precedente. / EN: Implicit queue: each call chains onto the previous call's promise. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor (readonly adapter: LlmAdapter, private readonly store: PrivateStore, private readonly opts: LlmRunnerOptions) {}

  /** Consumo di oggi rispetto al limite. / EN: Today's usage against the limit. */
  get budget (): { used: number, limit: number } {
    return { used: this.store.callsToday(), limit: this.opts.dailyBudget() }
  }

  /** true se restano almeno `calls` chiamate nel budget di oggi. / EN: true if at least `calls` calls are left in today's budget. */
  hasBudget (calls = 1): boolean {
    return this.store.callsToday() + calls <= this.opts.dailyBudget()
  }

  available (): Promise<boolean> {
    return this.adapter.available()
  }

  /**
   * Accoda un compito ed eventualmente lo riprova una volta (output non valido, timeout).
   *
   * EN: Queues a task and retries it once if needed (invalid output, timeout).
   * @throws LlmBudgetExceededError, LlmUnavailableError o l'ultimo errore dell'adapter
   *         EN: LlmBudgetExceededError, LlmUnavailableError or the adapter's last error
   */
  run<T> (task: LlmTask<T>): Promise<T> {
    // `.catch(() => {})`: un compito fallito non deve bloccare quelli accodati dopo.
    // EN: `.catch(() => {})`: a failed task must not block the ones queued after it.
    const next = this.chain.catch(() => {}).then(() => this.execute(task))
    this.chain = next
    return next
  }

  private async execute<T> (task: LlmTask<T>): Promise<T> {
    if (!(await this.adapter.available())) throw new LlmUnavailableError(`LLM "${this.adapter.name}" non disponibile`)
    let lastError: unknown
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (!this.hasBudget()) throw new LlmBudgetExceededError(`budget giornaliero di ${this.opts.dailyBudget()} chiamate esaurito`)
      this.store.countCall()
      const t0 = Date.now()
      try {
        const out = await this.adapter.run(task)
        this.opts.log?.(`llm ${task.name} (${task.model}) ok in ${Date.now() - t0} ms`)
        return out
      } catch (err) {
        lastError = err
        // Se la CLI non esiste è inutile riprovare subito.
        // EN: If the CLI does not exist there is no point retrying right away.
        if (err instanceof LlmUnavailableError) throw err
        this.opts.log?.(`llm ${task.name} tentativo ${attempt} fallito: ${(err as Error).message.slice(0, 200)}`)
      }
    }
    throw lastError
  }
}
