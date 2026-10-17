/**
 * @file Valutazione dell'ingestione con il LLM VERO (Claude Code CLI).
 *
 * Esegue ogni caso di ingest-cases.ts nello stesso percorso della pipeline:
 * filtro deterministico → (se non bloccato) classificazione con Haiku → route().
 * Poi distilla con Sonnet due casi tecnici, per un controllo a occhio della fedeltà alla fonte.
 *
 * Consuma l'abbonamento (circa 25 chiamate): per questo NON fa parte di `npm test`.
 * Uso: npm run eval:ingest   →   report in test/eval/report.md
 *
 * Criteri (dal piano, Fase 2): ≥ 90% dei casi corretti, 100% dei casi sensibili fuori dal team.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLASSIFY_SYSTEM, Classification, Distilled, distillSystem } from '../../src/ingest/prompts'
import { type Route, route } from '../../src/ingest/pipeline'
import { ClaudeCliAdapter } from '../../src/llm/claude-cli'
import { applyFilter, mergeRules } from '../../src/privacy/filter'
import { CASES } from './ingest-cases'

const adapter = new ClaudeCliAdapter()
const rules = mergeRules([])

interface Row { id: string, got: Route, ok: boolean, sensitive: boolean, via: string, reason: string }

describe('valutazione ingestione (Claude reale)', () => {
  const rows: Row[] = []

  it('classifica tutti i casi', async () => {
    expect(await adapter.available()).toBe(true)
    for (const c of CASES) {
      const f = applyFilter(c.text, rules)
      let got: Route
      let via: string
      let reason: string
      if (f.blocked) {
        // Il filtro locale manda in privato senza interpellare il LLM.
        got = 'private'
        via = 'filtro'
        reason = f.reasons.join(', ')
      } else {
        const cls = await adapter.run({ name: 'classify', system: CLASSIFY_SYSTEM, input: f.text, schema: Classification, model: 'haiku' })
        got = route(cls)
        via = `haiku ${cls.destination}/${cls.confidence}`
        reason = cls.reason
      }
      rows.push({ id: c.id, got, ok: c.expect.includes(got), sensitive: !!c.sensitive, via, reason })
    }

    const total = rows.filter((r) => r.ok).length
    const sens = rows.filter((r) => r.sensitive)
    const sensOk = sens.filter((r) => r.got !== 'team').length
    const report = [
      '# Valutazione ingestione',
      '',
      `Eseguita il ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC con Claude Code CLI (haiku).`,
      '',
      `- Casi corretti: **${total}/${rows.length}** (${Math.round(total / rows.length * 100)}%, obiettivo ≥ 90%)`,
      `- Casi sensibili fuori dal team: **${sensOk}/${sens.length}** (obiettivo 100%)`,
      '',
      '| Caso | Esito | Atteso | Via | Motivo |',
      '|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.sensitive ? '🔒 ' : ''}${r.id} | ${r.ok ? '✅' : '❌'} ${r.got} | ${CASES.find((c) => c.id === r.id)!.expect.join(' / ')} | ${r.via} | ${r.reason.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 160)} |`)
    ]
    fs.writeFileSync(path.join(__dirname, 'report.md'), report.join('\n') + '\n')
    console.log(report.slice(0, 6).join('\n'))

    expect(sensOk).toBe(sens.length)
    expect(total / rows.length).toBeGreaterThanOrEqual(0.9)
  })

  it('distillazione: fedeltà alla fonte (controllo a occhio nel report)', async () => {
    const out: string[] = ['', '## Distillazione (Sonnet)', '']
    for (const id of ['gotcha-oom-build', 'decisione-orm']) {
      const c = CASES.find((x) => x.id === id)!
      const d = await adapter.run({ name: 'distill', system: distillSystem('it'), input: c.text, schema: Distilled, model: 'sonnet' })
      expect(d.memories.length).toBeGreaterThan(0)
      out.push(`### Fonte: ${id}`, '', '```', c.text, '```', '')
      for (const m of d.memories) out.push(`- **[${m.kind}] ${m.title}** — ${m.body.replace(/\n+/g, ' ')}`)
      out.push('')
    }
    fs.appendFileSync(path.join(__dirname, 'report.md'), out.join('\n'))
  })
})
