// Esecuzione dei compiti LLM: una chiamata alla volta, budget giornaliero, un retry se l'output
// non rispetta lo schema (DESIGN §7, decisione D8).
import type { PrivateStore } from '../store/private-store'
import { type LlmAdapter, LlmBudgetExceededError, type LlmTask, LlmUnavailableError } from './types'

export interface LlmRunnerOptions {
  dailyBudget: number
  log?: (msg: string) => void
}

export class LlmRunner {
  private chain: Promise<unknown> = Promise.resolve()

  constructor (readonly adapter: LlmAdapter, private readonly store: PrivateStore, private readonly opts: LlmRunnerOptions) {}

  get budget (): { used: number, limit: number } {
    return { used: this.store.callsToday(), limit: this.opts.dailyBudget }
  }

  hasBudget (calls = 1): boolean {
    return this.store.callsToday() + calls <= this.opts.dailyBudget
  }

  available (): Promise<boolean> {
    return this.adapter.available()
  }

  /** Accoda il compito: le chiamate alla CLI sono serializzate (concorrenza 1). */
  run<T> (task: LlmTask<T>): Promise<T> {
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
        if (err instanceof LlmUnavailableError) throw err
        this.opts.log?.(`llm ${task.name} tentativo ${attempt} fallito: ${(err as Error).message.slice(0, 200)}`)
      }
    }
    throw lastError
  }
}
