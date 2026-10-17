/**
 * @file Integrazione con i client AI: oggi Claude Code (DESIGN §11, §6.1).
 *
 * `setupClaudeCode` fa due cose, usate sia da `micelio setup claude-code` sia dal pulsante
 * nella schermata Impostazioni della UI:
 * 1. registra Micelio come server MCP di Claude Code (ambito utente), con `claude mcp add`;
 * 2. installa in ~/.claude/settings.json l'hook SessionEnd che avvisa il daemon a fine sessione
 *    (raccolta automatica, attiva solo nelle cartelle abilitate).
 *
 * Entrambe le operazioni sono idempotenti: rieseguirle sostituisce la configurazione precedente.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Percorso della CLI compilata (dist/cli/main.js), che l'hook deve lanciare. */
export const CLI_MAIN = path.join(__dirname, '..', 'cli', 'main.js')

/** settings.json di Claude Code (rispetta CLAUDE_CONFIG_DIR se impostata). */
export function claudeSettingsFile (): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json')
}

/** Riconosce un hook installato da Micelio (per non duplicarlo e per poterlo sostituire). */
const isMicelioHook = (h: any) => typeof h?.command === 'string' && h.command.includes('hook session-end') && h.command.includes('micelio')

/** Errore di configurazione da mostrare all'utente così com'è. */
export class IntegrationError extends Error {}

/**
 * Comando dell'hook. Usa percorsi assoluti (funziona anche se `micelio` non è nel PATH) e
 * barre "/" con virgolette, così è interpretabile sia da cmd sia da bash.
 */
export function hookCommand (home: string, cliMain = CLI_MAIN): string {
  const slash = (p: string) => p.replace(/\\/g, '/')
  return `"${slash(process.execPath)}" "${slash(cliMain)}" --home "${slash(home)}" hook session-end`
}

/**
 * Installa (o reinstalla) l'hook SessionEnd di Micelio in settings.json di Claude Code.
 * Preserva tutto il resto del file e ne salva prima una copia (`settings.json.micelio-backup`).
 * @returns il percorso del file modificato
 */
export function installSessionEndHook (home: string, cliMain = CLI_MAIN): string {
  const file = claudeSettingsFile()
  let settings: any = {}
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8')
    try { settings = JSON.parse(raw) } catch { throw new IntegrationError(`${file} non è JSON valido: correggilo prima di installare l'hook`) }
    fs.writeFileSync(file + '.micelio-backup', raw)
  }
  settings.hooks ??= {}
  // Rimuove eventuali installazioni precedenti, poi aggiunge quella attuale.
  const groups: any[] = (settings.hooks.SessionEnd ?? [])
    .map((g: any) => ({ ...g, hooks: (g.hooks ?? []).filter((h: any) => !isMicelioHook(h)) }))
    .filter((g: any) => g.hooks.length > 0)
  groups.push({ hooks: [{ type: 'command', command: hookCommand(home, cliMain), timeout: 10 }] })
  settings.hooks.SessionEnd = groups
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(settings, null, 2))
  return file
}

/** Argomenti di `claude mcp add` per registrare il server MCP del daemon. */
export function mcpAddArgs (mcpUrl: string, token: string): string[] {
  return ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'micelio', mcpUrl, '--header', `Authorization: Bearer ${token}`]
}

/**
 * Registra Micelio come server MCP in Claude Code. Rimuove prima un'eventuale registrazione
 * vecchia (es. con un token o una porta diversi).
 * @throws IntegrationError se `claude` non è disponibile o il comando fallisce
 */
export function registerMcp (mcpUrl: string, token: string): void {
  spawnSync('claude', ['mcp', 'remove', '--scope', 'user', 'micelio'], { stdio: 'ignore', windowsHide: true })
  const r = spawnSync('claude', mcpAddArgs(mcpUrl, token), { encoding: 'utf8', windowsHide: true })
  if (r.error || r.status !== 0) {
    throw new IntegrationError(`Registrazione MCP non riuscita: ${(r.error?.message ?? r.stderr ?? '').toString().trim() || 'claude non disponibile'}`)
  }
}

export interface ClaudeCodeSetupResult {
  /** URL MCP registrato. */
  mcpUrl: string
  /** File settings.json modificato, o null se l'hook non è stato richiesto. */
  hookFile: string | null
}

/**
 * Configurazione completa di Claude Code: MCP + (facoltativo) hook di fine sessione.
 * @param hook true per installare anche l'hook della raccolta automatica
 */
export function setupClaudeCode (opts: { mcpUrl: string, token: string, home: string, hook: boolean }): ClaudeCodeSetupResult {
  registerMcp(opts.mcpUrl, opts.token)
  const hookFile = opts.hook ? installSessionEndHook(opts.home) : null
  return { mcpUrl: opts.mcpUrl, hookFile }
}
