/**
 * @file Adapter LLM finto e deterministico, per test ed end-to-end.
 *
 * Permette di provare tutta la pipeline senza consumare l'abbonamento e senza rete.
 * Si attiva con `llm.adapter = "fake"` in config.json o con MICELIO_LLM_ADAPTER=fake.
 * NON usarlo in produzione: le sue "decisioni" sono regole banali sul testo.
 *
 * Regole (documentate anche in test/unit/pipeline.test.ts):
 * - classify: testo con "cliente", "credenziali", "valutazione"… → private;
 *             testo più corto di 30 caratteri → discard; altrimenti → team;
 *             "[incerto]" nel testo → confidenza 0.5 (caso dubbio → inbox).
 * - distill:  un ricordo per ogni riga "LEZIONE: titolo | corpo" presente nell'input;
 * - consolidate (dreaming): "[collega]" nel testo → link; altrimenti fonde il gruppo.
 */
import type { LlmAdapter, LlmTask } from './types'

/** Parole che il finto classificatore considera "private". */
const PRIVATE_HINTS = /\b(cliente|customer|credenziali|valutazione|personale)\b/i
/** Testi cortissimi = banali. */
const TRIVIAL_HINTS = /^.{0,30}$/s

export class FakeAdapter implements LlmAdapter {
  readonly name = 'fake'
  /** Registro delle chiamate ricevute: i test lo usano per verificare COSA è stato inviato al LLM. */
  calls: { name: string, model: string }[] = []

  async available (): Promise<boolean> { return true }

  async run<T> (task: LlmTask<T>): Promise<T> {
    this.calls.push({ name: task.name, model: task.model })
    if (task.name === 'classify') {
      const text = task.input
      const destination = PRIVATE_HINTS.test(text) ? 'private' : TRIVIAL_HINTS.test(text.trim()) ? 'discard' : 'team'
      // Passiamo comunque dallo schema: così il finto adapter rispetta lo stesso contratto del vero.
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
      const memories = [...task.input.matchAll(/LEZIONE:\s*([^|\n]+)\|\s*([^\n]+)/g)].map((m) => ({
        kind: 'gotcha', title: m[1].trim(), body: m[2].trim(), tags: ['test']
      }))
      return task.schema.parse({ memories })
    }
    if (task.name === 'consolidate') {
      if (task.input.includes('[collega]')) return task.schema.parse({ action: 'link', reason: 'correlati (finto)' })
      const titles = [...task.input.matchAll(/^\[[0-9a-f]+\] \S+ · (.+)$/gm)].map((m) => m[1])
      return task.schema.parse({
        action: 'merge',
        merged: { kind: 'fact', title: `${titles[0] ?? 'Ricordo'} (consolidato)`, body: `Sintesi di ${titles.length} ricordi: ${titles.join('; ')}`, tags: ['consolidato'] },
        reason: 'stesso contenuto (finto)'
      })
    }
    throw new Error(`FakeAdapter: compito sconosciuto ${task.name}`)
  }
}
