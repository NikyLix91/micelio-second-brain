/**
 * @file Esecutore dei compiti LLM: serializzazione, budget giornaliero, retry (DESIGN §7, D8).
 *
 * Perché serializzare (una chiamata alla volta): ogni chiamata lancia un processo `claude` che
 * consuma l'abbonamento dell'utente; in parallelo rischieremmo di saturarne i limiti e di
 * rallentare la sua sessione di lavoro.
 *
 * Il budget è contato nell'archivio privato (tabella llm_usage, una riga per giorno), quindi
 * sopravvive ai riavvii del daemon. Ogni TENTATIVO conta, anche quelli falliti: è il consumo reale.
 */
import type { PrivateStore } from '../store/private-store'
import { type LlmAdapter, LlmBudgetExceededError, type LlmTask, LlmUnavailableError } from './types'

export interface LlmRunnerOptions {
  /** Chiamate massime al giorno (config `llm.dailyBudget`). */
  dailyBudget: number
  log?: (msg: string) => void
}

export class LlmRunner {
  /** Coda implicita: ogni chiamata si accoda alla promessa della precedente. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor (readonly adapter: LlmAdapter, private readonly store: PrivateStore, private readonly opts: LlmRunnerOptions) {}

  /** Consumo di oggi rispetto al limite. */
  get budget (): { used: number, limit: number } {
    return { used: this.store.callsToday(), limit: this.opts.dailyBudget }
  }

  /** true se restano almeno `calls` chiamate nel budget di oggi. */
  hasBudget (calls = 1): boolean {
    return this.store.callsToday() + calls <= this.opts.dailyBudget
  }

  available (): Promise<boolean> {
    return this.adapter.available()
  }

  /**
   * Accoda un compito ed eventualmente lo riprova una volta (output non valido, timeout).
   * @throws LlmBudgetExceededError, LlmUnavailableError o l'ultimo errore dell'adapter
   */
  run<T> (task: LlmTask<T>): Promise<T> {
    // `.catch(() => {})`: un compito fallito non deve bloccare quelli accodati dopo.
    const next = this.chain.catch(() => {}).then(() => this.execute(task))
    this.chain = next
    return next
  }

  private async execute<T> (task: LlmTask<T>): Promise<T> {
    if (!(await this.adapter.available())) throw new LlmUnavailableError(`LLM "${this.adapter.name}" non disponibile`)
    let lastError: unknown
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (!this.hasBudget()) throw new LlmBudgetExceededError(`budget giornaliero di ${this.opts.dailyBudget} chiamate esaurito`)
      this.store.countCall()
      const t0 = Date.now()
      try {
        const out = await this.adapter.run(task)
        this.opts.log?.(`llm ${task.name} (${task.model}) ok in ${Date.now() - t0} ms`)
        return out
      } catch (err) {
        lastError = err
        // Se la CLI non esiste è inutile riprovare subito.
        if (err instanceof LlmUnavailableError) throw err
        this.opts.log?.(`llm ${task.name} tentativo ${attempt} fallito: ${(err as Error).message.slice(0, 200)}`)
      }
    }
    throw lastError
  }
}
