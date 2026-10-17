// Adapter finto e deterministico, per test ed end-to-end senza consumare l'abbonamento.
// Si attiva con llm.adapter = "fake" (o MICELIO_LLM_ADAPTER=fake). NON usarlo in produzione.
import type { LlmAdapter, LlmTask } from './types'

const PRIVATE_HINTS = /\b(cliente|customer|credenziali|valutazione|personale)\b/i
const TRIVIAL_HINTS = /^.{0,30}$/s // testi cortissimi = "banali"

export class FakeAdapter implements LlmAdapter {
  readonly name = 'fake'
  calls: { name: string, model: string }[] = []

  async available (): Promise<boolean> { return true }

  async run<T> (task: LlmTask<T>): Promise<T> {
    this.calls.push({ name: task.name, model: task.model })
    if (task.name === 'classify') {
      const text = task.input
      const destination = PRIVATE_HINTS.test(text) ? 'private' : TRIVIAL_HINTS.test(text.trim()) ? 'discard' : 'team'
      return task.schema.parse({
        destination,
        category: destination === 'private' ? 'personal' : 'technical',
        sensitivity: destination === 'private' ? ['customer-data'] : [],
        reusable: destination === 'team',
        confidence: text.includes('[incerto]') ? 0.5 : 0.95,
        reason: 'classificazione finta (test)'
      })
    }
    if (task.name === 'distill') {
      // Un ricordo per ogni riga "LEZIONE: titolo | corpo" presente nella sessione.
      const memories = [...task.input.matchAll(/LEZIONE:\s*([^|\n]+)\|\s*([^\n]+)/g)].map((m) => ({
        kind: 'gotcha', title: m[1].trim(), body: m[2].trim(), tags: ['test']
      }))
      return task.schema.parse({ memories })
    }
    throw new Error(`FakeAdapter: compito sconosciuto ${task.name}`)
  }
}
