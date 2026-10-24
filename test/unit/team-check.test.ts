// 0.6.1: controllo del team dei salvataggi degli agenti e migrazione delle registrazioni MCP vecchie.
// Bug reale (2026-10-24): con la registrazione HTTP vecchia i ricordi di un progetto finivano nel
// team predefinito.
// EN: 0.6.1: team check of agents' saves and migration of the old MCP registrations.
//     Real bug (2026-10-24): with the old HTTP registration a project's memories ended up in the
//     default team.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkSessionTeam, teamCheckReason, teamCheckSolution } from '../../src/core/team-check'
import { isLegacyMicelioEntry, migrateMcpConfig, shimEntry } from '../../src/node/integrations'
import { PrivateStore } from '../../src/store/private-store'
import { tmpHome } from '../helpers'

const A = { id: 'aaaa1111', name: 'Team A' }
const B = { id: 'bbbb2222', name: 'Team B' }
const owners: Record<string, string> = { 'C:/repo/apm': A.id, 'C:/repo/mpd': B.id }
const ownerOf = (d: string) => Object.entries(owners).find(([dir]) => d.startsWith(dir))?.[1] ?? null
const nameOf = (id: string) => [A, B].find((t) => t.id === id)!.name

describe('controllo del team', () => {
  it('cartella del team della sessione: nessun problema', () => {
    expect(checkSessionTeam('C:/repo/apm/sub', A, ownerOf, nameOf)).toBeNull()
  })

  it('cartella di un altro team, non abilitata, sconosciuta', () => {
    const other = checkSessionTeam('C:/repo/apm', B, ownerOf, nameOf)!
    expect(other).toEqual({ problem: 'other-team', cwd: 'C:/repo/apm', session: B, folder: A })
    expect(teamCheckReason(other)).toBe('la cartella C:/repo/apm è abilitata nel team «Team A», ma la sessione salvava nel team «Team B»')
    expect(teamCheckSolution(other)).toMatch(/Inbox del team «Team A».*approvarlo/)

    const off = checkSessionTeam('C:/altrove', B, ownerOf, nameOf)!
    expect(off).toEqual({ problem: 'not-enabled', cwd: 'C:/altrove', session: B })
    expect(teamCheckSolution(off)).toMatch(/Abilita la cartella/)

    const none = checkSessionTeam(null, B, ownerOf, nameOf)!
    expect(none).toEqual({ problem: 'no-folder', cwd: null, session: B })
    expect(teamCheckSolution(none)).toMatch(/Configura.*riapri/)
  })
})

describe('migrazione delle registrazioni MCP vecchie', () => {
  const shim = shimEntry('C:/Users/mario/.micelio', 'C:/Micelio/dist/cli/main.js')

  it('riconosce solo le voci HTTP di questo daemon', () => {
    expect(isLegacyMicelioEntry({ type: 'http', url: 'http://127.0.0.1:7337/mcp' }, 7337)).toBe(true)
    expect(isLegacyMicelioEntry({ type: 'http', url: 'http://localhost:7337/mcp/ff172421' }, 7337)).toBe(true)
    expect(isLegacyMicelioEntry({ url: 'http://127.0.0.1:7337/mcp/' }, 7337)).toBe(true)
    expect(isLegacyMicelioEntry({ type: 'http', url: 'http://127.0.0.1:7338/mcp' }, 7337)).toBe(false) // altro daemon (demo) / EN: another daemon (demo)
    expect(isLegacyMicelioEntry({ type: 'http', url: 'https://example.com/mcp' }, 7337)).toBe(false)
    expect(isLegacyMicelioEntry(shim, 7337)).toBe(false)
    expect(isLegacyMicelioEntry(undefined, 7337)).toBe(false)
  })

  it('sostituisce con lo shim la voce utente e quelle dei progetti, e niente altro', () => {
    const http = (team = '') => ({ type: 'http', url: `http://127.0.0.1:7337/mcp${team}`, headers: { Authorization: 'Bearer x' } })
    const cfg: any = {
      numStartups: 42,
      mcpServers: { micelio: http(), other: { type: 'http', url: 'http://127.0.0.1:7337/mcp' } },
      projects: {
        'C:/repo/apm': { mcpServers: { micelio: http('/ff172421') }, allowedTools: ['x'] },
        'C:/repo/mpd': { mcpServers: { micelio: shim } },
        'C:/repo/vuoto': {}
      }
    }
    expect(migrateMcpConfig(cfg, shim, 7337)).toBe(2)
    expect(cfg.mcpServers.micelio).toEqual(shim)
    expect(cfg.mcpServers.other.type).toBe('http') // non è nostro per nome / EN: not ours by name
    expect(cfg.projects['C:/repo/apm']).toEqual({ mcpServers: { micelio: shim }, allowedTools: ['x'] })
    expect(cfg.numStartups).toBe(42)
    expect(migrateMcpConfig(cfg, shim, 7337)).toBe(0) // idempotente / EN: idempotent
    expect(shim.args).toEqual(['C:/Micelio/dist/cli/main.js', '--home', 'C:/Users/mario/.micelio', 'mcp'])
  })
})

describe('archivio privato: Inbox con il controllo del team', () => {
  it('un archivio di prima della 0.6.1 riceve la colonna, e gli elementi la conservano', () => {
    const file = path.join(tmpHome('inbox-team-check'), 'private.db')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // Tabella com'era prima / EN: Table as it was before
    const old = new DatabaseSync(file)
    old.exec('CREATE TABLE inbox (id TEXT PRIMARY KEY, created INTEGER NOT NULL, expires INTEGER NOT NULL, source TEXT NOT NULL, reason TEXT NOT NULL, memory TEXT NOT NULL)')
    old.prepare('INSERT INTO inbox VALUES (?, ?, ?, ?, ?, ?)').run('vecchio1', 1, 2, '{"type":"cli"}', 'dubbio', JSON.stringify({ kind: 'fact', title: 'Vecchio', body: 'x', tags: [] }))
    old.close()

    const store = new PrivateStore(file)
    expect(store.getInbox('vecchio1')).toMatchObject({ reason: 'dubbio' })
    expect(store.getInbox('vecchio1')!.teamCheck).toBeUndefined()
    const check = { problem: 'not-enabled' as const, cwd: 'C:/altrove', session: A }
    const item = store.addInbox({ kind: 'fact', title: 'Nuovo', body: 'y', tags: [] } as any, { type: 'mcp' }, 'motivo', Date.now(), check)
    expect(store.getInbox(item.id)!.teamCheck).toEqual(check)
    store.close()
  })
})
