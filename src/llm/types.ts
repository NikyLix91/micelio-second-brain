/**
 * @file Contratto comune degli adapter LLM (DESIGN §7).
 *
 * Micelio non usa API key: l'"intelligenza" arriva dalle CLI AI già installate e autenticate
 * sulla macchina dell'utente (Claude Code oggi, Codex in futuro). Ogni CLI ha un adapter che
 * implementa `LlmAdapter`; il resto del codice (pipeline, dreaming) conosce solo questa interfaccia.
 */
import type { z } from 'zod'

/** Un compito strutturato: prompt di sistema + input → oggetto validato da uno schema zod. */
export interface LlmTask<T> {
  /** Nome del compito, per log e test (es. "classify", "distill"). */
  name: string
  /** Prompt di sistema: le istruzioni del compito. */
  system: string
  /** Il contenuto da elaborare (passato su stdin, mai come argomento: può essere lungo). */
  input: string
  /** Schema dell'output atteso: viene convertito in JSON Schema per la CLI e poi riverificato. */
  schema: z.ZodType<T>
  /** Modello da usare, nel formato della CLI (es. "haiku", "sonnet"). */
  model: string
  timeoutMs?: number
}

/** Un modello raggiungibile tramite una CLI locale. */
export interface LlmAdapter {
  /** Nome breve dell'adapter, mostrato in `micelio ingest status`. */
  readonly name: string
  /** true se la CLI è installata e risponde. */
  available (): Promise<boolean>
  /**
   * Esegue un compito e restituisce l'output VALIDATO.
   * @throws LlmUnavailableError se la CLI non c'è; altri errori per output non valido o timeout
   */
  run<T> (task: LlmTask<T>): Promise<T>
}

/** La CLI non è installata o non si avvia: si riprova più tardi, senza contare tentativi. */
export class LlmUnavailableError extends Error {}
/** Il budget giornaliero di chiamate è finito: il lavoro aspetta il giorno dopo (D8). */
export class LlmBudgetExceededError extends Error {}
