import type { z } from 'zod'

export interface LlmTask<T> {
  /** Nome del compito, per log e budget (es. "classify", "distill"). */
  name: string
  system: string
  input: string
  schema: z.ZodType<T>
  model: string
  timeoutMs?: number
}

/** Un modello raggiungibile tramite una CLI locale (DESIGN §7). Nessuna API key. */
export interface LlmAdapter {
  readonly name: string
  available (): Promise<boolean>
  run<T> (task: LlmTask<T>): Promise<T>
}

export class LlmUnavailableError extends Error {}
export class LlmBudgetExceededError extends Error {}
