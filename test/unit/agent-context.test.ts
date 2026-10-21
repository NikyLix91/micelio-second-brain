/**
 * Contesto automatico per gli agenti (B4): composizione compatta del testo (righe con id e avvisi,
 * limite di caratteri senza righe tagliate) e installazione degli hook in settings.json di Claude
 * Code (idempotente, rispetta gli hook non di Micelio, si disattiva).
 *
 * EN: Automatic context for agents (B4): compact composition of the text (lines with ids and warnings,
 * character limit without cut lines) and installation of the hooks in the Claude Code settings.json
 * (idempotent, respects non-Micelio hooks, can be turned off).
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { contextLine, firstLine, promptContext, sessionContext } from '../../src/context/agent-context'
import type { RecallHit } from '../../src/core/model'
import { installHooks, mcpAddArgs } from '../../src/node/integrations'
import { relevanceCutoff } from '../../src/node/micelio-node'
import { tmpHome } from '../helpers'

const hit = (n: number, extra: Partial<RecallHit> = {}): RecallHit =>
  ({ id: String(n).repeat(64).slice(0, 64), kind: 'gotcha', title: `Ricordo ${n}`, body: `# Titolo\n\nPrima riga utile del ricordo ${n}.\nSeconda riga.`, tags: [], author: 'a', authorName: 'ada', ts: 0, score: 0, ...extra }) as RecallHit

describe('composizione del contesto', () => {
  it('una riga per ricordo: tipo o Radice, titolo, prima riga, id e avvisi', () => {
    expect(firstLine('# Titolo\n\n> nota importante')).toBe('Titolo')
    // callout di Obsidian: l'intestazione da sola non dice nulla, conta la riga dopo
    // EN: Obsidian callout: the header alone says nothing, the next line is what counts
    expect(firstLine('> [!abstract] TL;DR\n> Il deploy usa blu-verde.')).toBe('Il deploy usa blu-verde.')
    expect(contextLine(hit(1))).toBe(`- [gotcha] Ricordo 1 — Titolo (id:${'1'.repeat(12)})`)
    const root = contextLine(hit(2, { root: { category: 'policy', status: 'review' } }))
    expect(root).toContain('[RADICE policy, da rivedere]')
    const marks = contextLine(hit(3, { personal: true, stale: { commits: 2, missing: 0 } }))
    expect(marks).toContain('personale; codice cambiato da allora')
  })

  it('inizio sessione: Radici e ricordi del progetto, oppure niente', () => {
    expect(sessionContext({ team: 'T', project: 'ordini', roots: [], memories: [] })).toBe('')
    const t = sessionContext({ team: 'Prodotto', project: 'ordini', roots: [hit(1, { root: { category: 'architecture', status: 'ok' } })], memories: [hit(2)] })
    expect(t).toMatch(/^## Micelio — memoria del team «Prodotto» per il progetto «ordini»/)
    expect(t).toContain('Radici (sapere fondante del team: rispettale):')
    expect(t).toContain('Ricordi del team più utili per questo progetto:')
    expect(t).toContain('tool MCP "get"')
  })

  it('rispetta il limite di caratteri senza tagliare le righe', () => {
    const many = Array.from({ length: 30 }, (_, i) => hit(i + 1))
    const t = promptContext({ team: 'T', memories: many, maxChars: 600 })
    expect(t.length).toBeLessThanOrEqual(600)
    expect(t.split('\n').filter((l) => l.startsWith('- [')).every((l) => l.endsWith(')'))).toBe(true)
    expect(promptContext({ team: 'T', memories: [] })).toBe('')
  })
})

describe('installazione degli hook', () => {
  const dir = tmpHome('claude-config')
  const file = path.join(dir, 'settings.json')
  afterEach(() => { delete process.env.CLAUDE_CONFIG_DIR })

  it('aggiunge SessionEnd, SessionStart e UserPromptSubmit senza toccare gli altri hook; si ripete e si spegne', () => {
    process.env.CLAUDE_CONFIG_DIR = dir
    fs.writeFileSync(file, JSON.stringify({ theme: 'dark', hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo mio' }] }] } }))
    installHooks('/home/ada/.micelio', ['SessionEnd', 'SessionStart', 'UserPromptSubmit'], '/opt/micelio/cli/main.js')
    installHooks('/home/ada/.micelio', ['SessionEnd', 'SessionStart', 'UserPromptSubmit'], '/opt/micelio/cli/main.js') // idempotente / EN: idempotent
    let s = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(s.theme).toBe('dark')
    const cmds = (ev: string) => (s.hooks[ev] ?? []).flatMap((g: any) => g.hooks.map((h: any) => h.command))
    expect(cmds('SessionEnd')).toHaveLength(1)
    expect(cmds('SessionStart')[0]).toMatch(/micelio.*hook session-start$/)
    expect(cmds('UserPromptSubmit')).toEqual(['echo mio', expect.stringMatching(/hook prompt$/)])
    expect(fs.existsSync(file + '.micelio-backup')).toBe(true)
    // contesto spento: restano la raccolta e l'hook dell'utente
    // EN: context off: collection and the user's hook remain
    installHooks('/home/ada/.micelio', ['SessionEnd'], '/opt/micelio/cli/main.js')
    s = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(s.hooks.SessionStart).toBeUndefined()
    expect(cmds('UserPromptSubmit')).toEqual(['echo mio'])
    expect(cmds('SessionEnd')).toHaveLength(1)
  })
})

describe('registrazione MCP', () => {
  // Lo shim stdio, non l'endpoint HTTP: Claude Code lo avvia nella cartella del progetto e il daemon
  // ne ricava il team (bug del 2026-10-21). Nessun token negli argomenti: lo shim lo legge da config.json.
  // EN: The stdio shim, not the HTTP endpoint: Claude Code starts it in the project folder and the daemon
  //     derives the team from it (bug of 2026-10-21). No token in the arguments: the shim reads it from config.json.
  it('registra lo shim `micelio mcp` in ambito utente, senza token', () => {
    const args = mcpAddArgs('C:\\Users\\me\\.micelio', 'C:\\app\\dist\\cli\\main.js')
    expect(args.slice(0, 6)).toEqual(['mcp', 'add', '--scope', 'user', 'micelio', '--'])
    expect(args.slice(-4)).toEqual(['C:/app/dist/cli/main.js', '--home', 'C:/Users/me/.micelio', 'mcp'])
    expect(args.join(' ')).not.toMatch(/Bearer|--transport|http/)
  })
})

describe('pertinenza del contesto per richiesta', () => {
  it('passa solo ciò che si distacca nettamente dagli altri, oltre alla soglia fissa', () => {
    // tutto «somiglia un po'» (punteggi compressi): nessuno si distacca → soglia sopra a tutti
    // EN: everything "looks a bit alike" (compressed scores): nothing stands out → threshold above all of
    //     them
    const flat = [0.861, 0.862, 0.86, 0.863, 0.861, 0.862, 0.864, 0.86, 0.861, 0.862]
    expect(Math.max(...flat)).toBeLessThan(relevanceCutoff(flat, 0.86) + 1e-9 + 0.001)
    expect(flat.filter((x) => x >= relevanceCutoff(flat, 0.86)).length).toBeLessThanOrEqual(1)
    // uno chiaramente più pertinente: passa solo lui
    // EN: one clearly more relevant: only that one passes
    const peak = [...flat.map((x) => x - 0.02), 0.91]
    expect(peak.filter((x) => x >= relevanceCutoff(peak, 0.86))).toEqual([0.91])
    // pochi ricordi: vale la soglia fissa
    // EN: few memories: the fixed threshold applies
    expect(relevanceCutoff([0.9, 0.5], 0.86)).toBe(0.86)
  })
})
