/**
 * @file Contratto comune degli adapter LLM (DESIGN §7).
 *
 * EN: Common contract of the LLM adapters (DESIGN §7).
 *
 * Micelio non usa API key: l'"intelligenza" arriva dalle CLI AI già installate e autenticate
 * sulla macchina dell'utente (Claude Code oggi, Codex in futuro). Ogni CLI ha un adapter che
 * implementa `LlmAdapter`; il resto del codice (pipeline, dreaming) conosce solo questa interfaccia.
 *
 * EN: Micelio uses no API keys: the "intelligence" comes from the AI CLIs already installed and
 * authenticated on the user's machine (Claude Code today, Codex in the future). Each CLI has an
 * adapter implementing `LlmAdapter`; the rest of the code (pipeline, dreaming) only knows this interface.
 */
import type { z } from 'zod'

/** Un compito strutturato: prompt di sistema + input → oggetto validato da uno schema zod. / EN: A structured task: system prompt + input → object validated by a zod schema. */
export interface LlmTask<T> {
  /** Nome del compito, per log e test (es. "classify", "distill"). / EN: Task name, for logs and tests (e.g. "classify", "distill"). */
  name: string
  /** Prompt di sistema: le istruzioni del compito. / EN: System prompt: the task instructions. */
  system: string
  /** Il contenuto da elaborare (passato su stdin, mai come argomento: può essere lungo). / EN: The content to process (passed on stdin, never as an argument: it can be long). */
  input: string
  /** Schema dell'output atteso: viene convertito in JSON Schema per la CLI e poi riverificato. / EN: Schema of the expected output: converted to JSON Schema for the CLI and then checked again. */
  schema: z.ZodType<T>
  /** Modello da usare, nel formato della CLI (es. "haiku", "sonnet"). / EN: Model to use, in the CLI's format (e.g. "haiku", "sonnet"). */
  model: string
  timeoutMs?: number
}

/** Un modello raggiungibile tramite una CLI locale. / EN: A model reachable through a local CLI. */
export interface LlmAdapter {
  /** Nome breve dell'adapter, mostrato in `micelio ingest status`. / EN: Short adapter name, shown in `micelio ingest status`. */
  readonly name: string
  /** true se la CLI è installata e risponde. / EN: true if the CLI is installed and responds. */
  available (): Promise<boolean>
  /**
   * Esegue un compito e restituisce l'output VALIDATO.
   *
   * EN: Runs a task and returns the VALIDATED output.
   * @throws LlmUnavailableError se la CLI non c'è; altri errori per output non valido o timeout
   *         EN: LlmUnavailableError if the CLI is missing; other errors for invalid output or timeout
   */
  run<T> (task: LlmTask<T>): Promise<T>
}

/** La CLI non è installata o non si avvia: si riprova più tardi, senza contare tentativi. / EN: The CLI is not installed or does not start: retry later, without counting attempts. */
export class LlmUnavailableError extends Error {}
/** Il budget giornaliero di chiamate è finito: il lavoro aspetta il giorno dopo (D8). / EN: The daily call budget is used up: the work waits until the next day (D8). */
export class LlmBudgetExceededError extends Error {}
