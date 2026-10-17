/**
 * Pipeline di ingestione (src/ingest/pipeline.ts) con un LLM finto e un "team" finto:
 * qui si verifica la LOGICA delle decisioni, non la qualità del modello (per quella c'è
 * il set di valutazione, `npm run eval:ingest`).
 *
 * Convenzioni del FakeAdapter (src/llm/fake.ts):
 * - "cliente", "credenziali", "valutazione"… → privato;  testo < 30 caratteri → scartato;
 * - "[incerto]" nel testo → confidenza 0.5 (caso dubbio);
 * - la distillazione produce un ricordo per ogni riga "LEZIONE: titolo | corpo".
 */
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { MemoryData } from '../../src/core/events'
import { IngestPipeline, route } from '../../src/ingest/pipeline'
import type { Classification } from '../../src/ingest/prompts'
import { FakeAdapter } from '../../src/llm/fake'
import { LlmRunner } from '../../src/llm/runner'
import { mergeRules } from '../../src/privacy/filter'
import { mergeBlockedPaths } from '../../src/privacy/paths'
import { PrivateStore } from '../../src/store/private-store'
import { writeTranscript } from '../fixtures/transcript'
import { tmpHome } from '../helpers'

const cls = (o: Partial<Classification>): Classification =>
  ({ destination: 'team', category: 'technical', sensitivity: [], reusable: true, confidence: 0.95, reason: 'r', ...o })

describe('route(): instradamento della classificazione', () => {
  it('team solo se pulito e sicuro', () => {
    expect(route(cls({}))).toBe('team')
    expect(route(cls({ confidence: 0.6 }))).toBe('inbox')
    expect(route(cls({ sensitivity: ['credentials'] }))).toBe('inbox')
  })
  it('privato solo se chiaramente personale e senza nulla di riutilizzabile', () => {
    expect(route(cls({ destination: 'private', reusable: false }))).toBe('private')
    expect(route(cls({ destination: 'private', reusable: true }))).toBe('inbox') // misto → decide l'utente
    expect(route(cls({ destination: 'private', reusable: false, confidence: 0.5 }))).toBe('inbox')
  })
  it('scartato solo se sicuro', () => {
    expect(route(cls({ destination: 'discard' }))).toBe('discard')
    expect(route(cls({ destination: 'discard', confidence: 0.4 }))).toBe('inbox')
  })
})

describe('IngestPipeline', () => {
  let store: PrivateStore
  let published: MemoryData[]
  let fake: FakeAdapter
  const dir = tmpHome('pipeline')

  /** Crea una pipeline con budget configurabile; `llm: false` simula adapter "none". */
  const make = (opts: { budget?: number, llm?: boolean } = {}) => {
    fake = new FakeAdapter()
    const runner = opts.llm === false ? null : new LlmRunner(fake, store, { dailyBudget: () => opts.budget ?? 100 })
    return new IngestPipeline({
      store,
      llm: runner,
      models: () => ({ classify: 'haiku', distill: 'sonnet' }),
      publish: async (m) => { published.push(m); return { id: 'id-' + published.length, duplicate: false } },
      rules: async () => mergeRules([]),
      blockedPaths: async () => mergeBlockedPaths([]),
      language: async () => 'it',
      log: () => {}
    })
  }

  beforeEach(() => {
    store = new PrivateStore(':memory:')
    published = []
  })

  // ── Salvataggi espliciti (D6) ─────────────────────────────────────────────────────
  describe('salvataggio esplicito', () => {
    it('contenuto tecnico pulito → pubblicato', async () => {
      const r = await make().ingestExplicit({ title: 'Drizzle per i nuovi servizi', body: 'Niente motore binario, meglio con Alpine.' })
      expect(r.outcome).toBe('team')
      expect(published).toHaveLength(1)
      expect(fake.calls.map((c) => `${c.name}:${c.model}`)).toEqual(['classify:haiku']) // niente distillazione
    })

    it('argomento HR → privato SENZA chiamare il LLM', async () => {
      const r = await make().ingestExplicit({ title: 'Nota per la valutazione di fine anno', body: 'Proporre un aumento di stipendio.' })
      expect(r.outcome).toBe('private')
      expect(fake.calls).toHaveLength(0) // il contenuto non è mai uscito dalla macchina
      expect(store.listDecisions()[0].outcome).toBe('blocked')
    })

    it('segreti redatti prima di classificare e pubblicare', async () => {
      await make().ingestExplicit({ title: 'Accesso al DB di staging', body: 'Usare postgres://app:Segreta123@staging:5432/app per i test di integrazione.' })
      expect(published[0].body).toContain('[REDACTED:url-credentials]')
      expect(published[0].body).not.toContain('Segreta123')
    })

    it('caso dubbio → inbox, mai pubblicato in automatico', async () => {
      const r = await make().ingestExplicit({ title: 'Configurazione proxy [incerto]', body: 'Impostare HTTPS_PROXY nella pipeline di build.' })
      expect(r.outcome).toBe('inbox')
      expect(published).toHaveLength(0)
      expect(store.listInbox()).toHaveLength(1)
    })

    it('un esplicito "inutile" non viene scartato in silenzio: va in inbox', async () => {
      const r = await make().ingestExplicit({ title: 'Ok fatto', body: 'fatto' })
      expect(r.outcome).toBe('inbox')
    })

    it('senza LLM o senza budget → inbox (nel dubbio non si pubblica)', async () => {
      expect((await make({ llm: false }).ingestExplicit({ title: 'Titolo valido', body: 'Corpo tecnico di prova.' })).outcome).toBe('inbox')
      expect((await make({ budget: 0 }).ingestExplicit({ title: 'Titolo valido 2', body: 'Corpo tecnico di prova.' })).outcome).toBe('inbox')
    })
  })

  // ── Inbox (D9) ─────────────────────────────────────────────────────────────────────
  describe('inbox', () => {
    it('approva con correzioni → pubblicato; rifiuta → registrato e rimosso', async () => {
      const p = make()
      const a = await p.ingestExplicit({ title: 'Primo [incerto]', body: 'Corpo del primo ricordo.' })
      const b = await p.ingestExplicit({ title: 'Secondo [incerto]', body: 'Corpo del secondo ricordo.' })
      if (a.outcome !== 'inbox' || b.outcome !== 'inbox') throw new Error('attesi in inbox')

      const ok = await p.approve(a.inboxId, { title: 'Primo, corretto' })
      expect(ok.memory.title).toBe('Primo, corretto')
      expect(published[0].source.type).toBe('inbox')

      p.reject(b.inboxId)
      expect(store.listInbox()).toHaveLength(0)
      expect(store.listDecisions()[0].outcome).toBe('rejected')
    })

    it('gli elementi scaduti spariscono e vengono registrati', () => {
      store.addInbox({ kind: 'fact', title: 'vecchio', body: 'x', tags: [], source: { type: 'cli' } }, { type: 'cli' }, 'r', Date.now() - 15 * 24 * 3600 * 1000)
      expect(store.sweepInbox()).toBe(1)
      expect(store.listDecisions()[0].outcome).toBe('expired')
    })
  })

  // ── Sessioni di Claude Code (D7, D8) ───────────────────────────────────────────────
  describe('sessioni', () => {
    /** Accoda una sessione ed esegue subito il lavoro. */
    const runSession = async (p: IngestPipeline, id: string, turns: Parameters<typeof writeTranscript>[2]) => {
      const transcriptPath = writeTranscript(dir, id, turns)
      p.enqueueSession({ sessionId: id, transcriptPath, cwd: dir })
      await p.tick()
    }
    const longTech = 'Abbiamo analizzato la pipeline di build del frontend e i log degli agent ospitati. '.repeat(6)

    it('sessione tecnica → distillata e pubblicata', async () => {
      const p = make()
      await runSession(p, 'tech', [
        { user: 'La build Angular va in out of memory su Azure DevOps. ' + longTech },
        { assistant: 'LEZIONE: Build Angular OOM su Azure DevOps | Impostare NODE_OPTIONS=--max-old-space-size=6144.' }
      ])
      expect(published.map((m) => m.title)).toEqual(['Build Angular OOM su Azure DevOps'])
      // Fuori da un repository git il riferimento al codice è solo il nome della cartella di lavoro
      expect(published[0].source).toEqual({ type: 'claude-code', ref: 'tech', code: { project: path.basename(dir), files: [], symbols: [], commits: [] } })
      expect(store.jobStats()).toEqual({ done: 1 })
    })

    it('sessione su una valutazione HR → bloccata, nessuna chiamata LLM', async () => {
      const p = make()
      await runSession(p, 'hr', [{ user: 'Scrivi la mail di valutazione di fine anno per Marco. ' + longTech }, { assistant: 'Ecco la bozza...' }])
      expect(published).toHaveLength(0)
      expect(fake.calls).toHaveLength(0)
      expect(store.listDecisions()[0]).toMatchObject({ outcome: 'blocked' })
    })

    it('sessione con dati di un cliente → privata', async () => {
      const p = make()
      await runSession(p, 'cust', [{ user: 'Il cliente Acme ci ha mandato i suoi dati. ' + longTech }, { assistant: 'LEZIONE: x | y' }])
      expect(published).toHaveLength(0)
      expect(store.listDecisions()[0].outcome).toBe('private')
    })

    it('sessione dubbia → i ricordi distillati vanno in inbox', async () => {
      const p = make()
      await runSession(p, 'dubbia', [{ user: '[incerto] ' + longTech }, { assistant: 'LEZIONE: Proxy aziendale | Serve HTTPS_PROXY in pipeline.' }])
      expect(published).toHaveLength(0)
      expect(store.listInbox().map((i) => i.memory.title)).toEqual(['Proxy aziendale'])
    })

    it('sessione troppo corta → ignorata senza chiamate LLM', async () => {
      const p = make()
      await runSession(p, 'corta', [{ user: 'ciao' }, { assistant: 'ciao!' }])
      expect(fake.calls).toHaveLength(0)
    })

    it('sessione ripresa: si elabora solo la parte nuova', async () => {
      const p = make()
      await runSession(p, 'ripresa', [{ user: longTech }, { assistant: 'LEZIONE: Prima lezione | uno' }])
      const file = writeTranscript(dir, 'ripresa', [{ user: 'Continuiamo. ' + longTech }, { assistant: 'LEZIONE: Seconda lezione | due' }], true)
      p.enqueueSession({ sessionId: 'ripresa', transcriptPath: file, cwd: dir })
      await p.tick()
      expect(published.map((m) => m.title)).toEqual(['Prima lezione', 'Seconda lezione'])
    })

    it('budget insufficiente → la sessione resta in coda (rinviata), senza perdere tentativi', async () => {
      const p = make({ budget: 1 }) // ne servono 2
      await runSession(p, 'budget', [{ user: longTech }, { assistant: 'LEZIONE: a | b' }])
      expect(published).toHaveLength(0)
      const job = store.recentJobs(1)[0]
      expect(job.status).toBe('pending')
      expect(job.attempts).toBe(0)
      expect(store.nextJob()).toBeNull() // rinviata a domani: ora non è eseguibile
    })
  })
})
