/**
 * @file Adapter LLM finto e deterministico, per test ed end-to-end.
 *
 * EN: Fake, deterministic LLM adapter, for tests and end-to-end runs.
 *
 * Permette di provare tutta la pipeline senza consumare l'abbonamento e senza rete.
 * Si attiva con `llm.adapter = "fake"` in config.json o con MICELIO_LLM_ADAPTER=fake.
 * NON usarlo in produzione: le sue "decisioni" sono regole banali sul testo.
 *
 * EN: It lets you try the whole pipeline without using the subscription and without network.
 * Enable it with `llm.adapter = "fake"` in config.json or with MICELIO_LLM_ADAPTER=fake.
 * Do NOT use it in production: its "decisions" are trivial rules on the text.
 *
 * Regole (documentate anche in test/unit/pipeline.test.ts):
 * - classify: testo con "cliente", "credenziali", "valutazione"… → private;
 *             testo più corto di 30 caratteri → discard; altrimenti → team;
 *             "[incerto]" nel testo → confidenza 0.5 (caso dubbio → inbox).
 * - distill:  un ricordo per ogni riga "LEZIONE: titolo | corpo [| rif: file, simbolo, commit, radice=categoria]";
 *             giudizio sui ricordi forniti da Micelio (B11), per ogni "- [id] titolo" dell'elenco in
 *             coda: "USATO <id>" nel testo → used, "SBAGLIATO <id>" → wrong, altrimenti ignored;
 * - consolidate (dreaming): "[collega]" nel testo → link; altrimenti fonde il gruppo.
 * - root-review: un ricordo recente con "[contraddice]" nel testo → contradicts; altrimenti consistent.
 * - write-update (B4): "[aggiorna]" nel ricordo nuovo → aggiorna il primo esistente non protetto;
 *             "[duplicato]" → duplicato del primo esistente; altrimenti → nuovo.
 *
 * EN: Rules (also documented in test/unit/pipeline.test.ts):
 * - classify: text with "cliente", "credenziali", "valutazione"… → private;
 *             text shorter than 30 characters → discard; otherwise → team;
 *             "[incerto]" in the text → confidence 0.5 (doubtful case → Inbox).
 * - distill:  one memory for each "LEZIONE: titolo | corpo [| rif: file, simbolo, commit, radice=categoria]" line;
 *             verdict on the memories provided by Micelio (B11), for each "- [id] titolo" in the
 *             trailing list: "USATO <id>" in the text → used, "SBAGLIATO <id>" → wrong, otherwise ignored;
 * - consolidate (dreaming): "[collega]" in the text → link; otherwise it merges the group.
 * - root-review: a recent memory with "[contraddice]" in the text → contradicts; otherwise consistent.
 * - write-update (B4): "[aggiorna]" in the new memory → updates the first existing unprotected one;
 *             "[duplicato]" → duplicate of the first existing one; otherwise → new.
 */
import type { LlmAdapter, LlmTask } from './types'

/** Parole che il finto classificatore considera "private". / EN: Words the fake classifier treats as "private". */
const PRIVATE_HINTS = /\b(cliente|customer|credenziali|valutazione|personale)\b/i
/** Testi cortissimi = banali. / EN: Very short texts = trivial. */
const TRIVIAL_HINTS = /^.{0,30}$/s

export class FakeAdapter implements LlmAdapter {
  readonly name = 'fake'
  /** Registro delle chiamate ricevute: i test lo usano per verificare COSA è stato inviato al LLM. / EN: Log of the calls received: tests use it to check WHAT was sent to the LLM. */
  calls: { name: string, model: string, input: string, system: string }[] = []

  async available (): Promise<boolean> { return true }

  async run<T> (task: LlmTask<T>): Promise<T> {
    this.calls.push({ name: task.name, model: task.model, input: task.input, system: task.system })
    if (task.name === 'classify') {
      const text = task.input
      const destination = PRIVATE_HINTS.test(text) ? 'private' : TRIVIAL_HINTS.test(text.trim()) ? 'discard' : 'team'
      // Passiamo comunque dallo schema: così il finto adapter rispetta lo stesso contratto del vero.
      // EN: We still go through the schema: this way the fake adapter honors the same contract as the real one.
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
      // EN: "LEZIONE: titolo | corpo | rif: a, b, c": the optional references are sorted by eye:
      //     with "/" or an extension → file; hex of 7+ digits → commit; the rest → symbol.
      const memories = [...task.input.matchAll(/LEZIONE:\s*([^|\n]+)\|\s*([^|\n]+)(?:\|\s*rif:\s*([^\n]+))?/g)].map((m) => {
        const all = (m[3] ?? '').split(',').map((r) => r.trim()).filter(Boolean)
        // "radice=architecture" = suggerimento di Radice; il resto sono riferimenti
        // EN: "radice=architecture" = Root suggestion; the rest are references
        const root = all.find((r) => r.startsWith('radice='))?.slice('radice='.length) ?? 'none'
        const refs = all.filter((r) => !r.startsWith('radice='))
        const isCommit = (r: string) => /^[0-9a-f]{7,40}$/.test(r)
        const isFile = (r: string) => !isCommit(r) && (r.includes('/') || /\.\w{1,5}$/.test(r))
        return {
          kind: 'gotcha', title: m[1].trim(), body: m[2].trim(), tags: ['test'],
          files: refs.filter(isFile), commits: refs.filter(isCommit), symbols: refs.filter((r) => !isFile(r) && !isCommit(r)), root
        }
      })
      // B11: elenco dei ricordi forniti da Micelio in coda al testo
      // EN: B11: list of the memories provided by Micelio at the end of the text
      const micelio = [...task.input.matchAll(/^- \[([0-9a-f]{6,64})\] /gm)].map((m) => ({
        id: m[1],
        verdict: task.input.includes(`USATO ${m[1]}`) ? 'used' : task.input.includes(`SBAGLIATO ${m[1]}`) ? 'wrong' : 'ignored',
        reason: 'giudizio finto (test)'
      }))
      return task.schema.parse({ memories, micelio })
    }
    if (task.name === 'chat') {
      // B10: cita il primo ricordo e dà a ogni tema il nome "Tema <id>"; "[ignoto]" nella domanda → non lo so
      // EN: B10: cites the first memory and names each theme "Tema <id>"; "[ignoto]" in the question → I don't know
      const first = task.input.match(/^\[1\] (.+?)  \(/m)?.[1] ?? ''
      const themes = [...task.input.matchAll(/^tema (-?\d+):/gm)].map((m) => ({ id: Number(m[1]), title: `Tema ${m[1]}` }))
      const unknown = /DOMANDA ===\n.*\[ignoto\]/s.test(task.input)
      return task.schema.parse({ answer: unknown ? 'La memoria del team non lo dice.' : `Secondo la memoria del team: ${first} [1].`, cited: unknown ? [] : [1], themes, unknown })
    }
    if (task.name === 'root-review') {
      // Ricordi recenti nel formato "[<id>] titolo\ncorpo": contraddice quello che contiene il marcatore
      // EN: Recent memories in the "[<id>] titolo\ncorpo" format: the one containing the marker contradicts
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
