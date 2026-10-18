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
 * - distill:  un ricordo per ogni riga "LEZIONE: titolo | corpo [| rif: file, simbolo, commit, radice=categoria]";
 * - consolidate (dreaming): "[collega]" nel testo → link; altrimenti fonde il gruppo.
 * - root-review: un ricordo recente con "[contraddice]" nel testo → contradicts; altrimenti consistent.
 * - write-update (B4): "[aggiorna]" nel ricordo nuovo → aggiorna il primo esistente non protetto;
 *             "[duplicato]" → duplicato del primo esistente; altrimenti → nuovo.
 */
import type { LlmAdapter, LlmTask } from './types'

/** Parole che il finto classificatore considera "private". */
const PRIVATE_HINTS = /\b(cliente|customer|credenziali|valutazione|personale)\b/i
/** Testi cortissimi = banali. */
const TRIVIAL_HINTS = /^.{0,30}$/s

export class FakeAdapter implements LlmAdapter {
  readonly name = 'fake'
  /** Registro delle chiamate ricevute: i test lo usano per verificare COSA è stato inviato al LLM. */
  calls: { name: string, model: string, input: string, system: string }[] = []

  async available (): Promise<boolean> { return true }

  async run<T> (task: LlmTask<T>): Promise<T> {
    this.calls.push({ name: task.name, model: task.model, input: task.input, system: task.system })
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
      // "LEZIONE: titolo | corpo | rif: a, b, c": i riferimenti facoltativi si smistano a occhio —
      // con "/" o un'estensione → file; esadecimale di 7+ cifre → commit; il resto → simbolo.
      const memories = [...task.input.matchAll(/LEZIONE:\s*([^|\n]+)\|\s*([^|\n]+)(?:\|\s*rif:\s*([^\n]+))?/g)].map((m) => {
        const all = (m[3] ?? '').split(',').map((r) => r.trim()).filter(Boolean)
        // "radice=architecture" = suggerimento di Radice; il resto sono riferimenti
        const root = all.find((r) => r.startsWith('radice='))?.slice('radice='.length) ?? 'none'
        const refs = all.filter((r) => !r.startsWith('radice='))
        const isCommit = (r: string) => /^[0-9a-f]{7,40}$/.test(r)
        const isFile = (r: string) => !isCommit(r) && (r.includes('/') || /\.\w{1,5}$/.test(r))
        return {
          kind: 'gotcha', title: m[1].trim(), body: m[2].trim(), tags: ['test'],
          files: refs.filter(isFile), commits: refs.filter(isCommit), symbols: refs.filter((r) => !isFile(r) && !isCommit(r)), root
        }
      })
      return task.schema.parse({ memories })
    }
    if (task.name === 'root-review') {
      // Ricordi recenti nel formato "[<id>] titolo\ncorpo": contraddice quello che contiene il marcatore
      const blocks = task.input.split(/\n(?=\[[0-9a-f]{64}\] )/).filter((b) => /^\[[0-9a-f]{64}\] /.test(b))
      const hits = blocks.filter((b) => b.includes('[contraddice]')).map((b) => b.slice(1, 65))
      return task.schema.parse(hits.length
        ? { verdict: 'contradicts', ids: hits, reason: 'contraddizione finta (test)' }
        : { verdict: 'consistent', ids: [], reason: 'nessun conflitto (test)' })
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
    if (task.name === 'write-update') {
      const [newPart, existing = ''] = task.input.split('\nESISTENTI:\n')
      const first = existing.match(/^\[([0-9a-f]{64})\]( \[PROTETTO\])? (\S+) · (.+)$/m)
      const firstFree = existing.match(/^\[([0-9a-f]{64})\] (?!\[PROTETTO\])(\S+) · (.+)$/m)
      if (newPart.includes('[duplicato]') && first) return task.schema.parse({ action: 'duplicate', target: first[1], reason: 'duplicato (finto)' })
      if (newPart.includes('[aggiorna]') && firstFree) {
        const body = newPart.split('\n').slice(2).join('\n').trim()
        return task.schema.parse({ action: 'update', target: firstFree[1], merged: { kind: 'fact', title: `${firstFree[3].trim()} (aggiornato)`, body, tags: ['aggiornato'] }, reason: 'aggiornamento (finto)' })
      }
      return task.schema.parse({ action: 'new', reason: 'diverso (finto)' })
    }
    throw new Error(`FakeAdapter: compito sconosciuto ${task.name}`)
  }
}
