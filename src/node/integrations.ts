/**
 * @file Integrazione con i client AI: oggi Claude Code (DESIGN §11, §6.1).
 *
 * `setupClaudeCode` fa due cose, usate sia da `micelio setup claude-code` sia dal pulsante
 * nella schermata Impostazioni della UI:
 * 1. registra Micelio come server MCP di Claude Code (ambito utente), con `claude mcp add`;
 * 2. installa in ~/.claude/settings.json l'hook SessionEnd che avvisa il daemon a fine sessione
 *    (raccolta automatica, attiva solo nelle cartelle abilitate);
 * 3. (B4) installa gli hook SessionStart e UserPromptSubmit del CONTESTO AUTOMATICO: a inizio
 *    sessione e a ogni richiesta inseriscono nella conversazione Radici e ricordi pertinenti
 *    (src/context/agent-context.ts).
 *
 * Entrambe le operazioni sono idempotenti: rieseguirle sostituisce la configurazione precedente.
 */
import { spawnSync } from 'node:child_process'
import { LocalizedError } from '../core/errors'
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
const isMicelioHook = (h: any) => typeof h?.command === 'string' && /hook (session-end|session-start|prompt)\b/.test(h.command) && h.command.includes('micelio')

/**
 * Hook di Micelio per evento di Claude Code: comando `micelio hook <arg>` e timeout in secondi.
 * - SessionEnd: raccolta (se il daemon è spento lo avvia, quindi più tempo);
 * - SessionStart / UserPromptSubmit: contesto automatico (B4), brevi per non rallentare l'utente.
 */
export const MICELIO_HOOKS = {
  SessionEnd: { arg: 'session-end', timeout: 30 },
  SessionStart: { arg: 'session-start', timeout: 15 },
  UserPromptSubmit: { arg: 'prompt', timeout: 10 }
} as const
export type HookEvent = keyof typeof MICELIO_HOOKS

/** Errore di configurazione da mostrare all'utente così com'è. */
export class IntegrationError extends LocalizedError {}

/**
 * Comando dell'hook. Usa percorsi assoluti (funziona anche se `micelio` non è nel PATH) e
 * barre "/" con virgolette, così è interpretabile sia da cmd sia da bash.
 */
export function hookCommand (home: string, cliMain = CLI_MAIN, arg: string = MICELIO_HOOKS.SessionEnd.arg): string {
  const slash = (p: string) => p.replace(/\\/g, '/')
  return `"${slash(process.execPath)}" "${slash(cliMain)}" --home "${slash(home)}" hook ${arg}`
}

/**
 * Installa (o reinstalla) l'hook SessionEnd di Micelio in settings.json di Claude Code.
 * Preserva tutto il resto del file e ne salva prima una copia (`settings.json.micelio-backup`).
 * @returns il percorso del file modificato
 */
export function installSessionEndHook (home: string, cliMain = CLI_MAIN): string {
  return installHooks(home, ['SessionEnd'], cliMain)
}

/**
 * Installa (o reinstalla) gli hook di Micelio indicati; toglie quelli di Micelio per gli eventi
 * NON indicati (così si possono anche disattivare). Il resto di settings.json non si tocca e se
 * ne salva prima una copia (`settings.json.micelio-backup`).
 * @returns il percorso del file modificato
 */
export function installHooks (home: string, events: HookEvent[], cliMain = CLI_MAIN): string {
  const file = claudeSettingsFile()
  let settings: any = {}
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8')
    try { settings = JSON.parse(raw) } catch { throw new IntegrationError(`${file} non è JSON valido: correggilo prima di installare l'hook`, `${file} is not valid JSON: fix it before installing the hook`) }
    fs.writeFileSync(file + '.micelio-backup', raw)
  }
  settings.hooks ??= {}
  for (const ev of Object.keys(MICELIO_HOOKS) as HookEvent[]) {
    // Rimuove eventuali installazioni precedenti di Micelio, poi (se richiesto) aggiunge quella attuale.
    const groups: any[] = (settings.hooks[ev] ?? [])
      .map((g: any) => ({ ...g, hooks: (g.hooks ?? []).filter((h: any) => !isMicelioHook(h)) }))
      .filter((g: any) => g.hooks.length > 0)
    if (events.includes(ev)) groups.push({ hooks: [{ type: 'command', command: hookCommand(home, cliMain, MICELIO_HOOKS[ev].arg), timeout: MICELIO_HOOKS[ev].timeout }] })
    if (groups.length) settings.hooks[ev] = groups
    else delete settings.hooks[ev]
  }
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
    const detail = (r.error?.message ?? r.stderr ?? '').toString().trim()
    throw new IntegrationError(`Registrazione MCP non riuscita: ${detail || 'claude non disponibile'}`, `MCP registration failed: ${detail || 'claude not available'}`)
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
export function setupClaudeCode (opts: { mcpUrl: string, token: string, home: string, hook: boolean, context?: boolean }): ClaudeCodeSetupResult {
  registerMcp(opts.mcpUrl, opts.token)
  // Contesto automatico (B4): attivo salvo richiesta contraria
  const events: HookEvent[] = [...(opts.hook ? ['SessionEnd' as const] : []), ...(opts.context !== false ? ['SessionStart' as const, 'UserPromptSubmit' as const] : [])]
  const hookFile = events.length ? installHooks(opts.home, events) : null
  return { mcpUrl: opts.mcpUrl, hookFile }
}

/**
 * Registra Micelio come server MCP di Claude Code SOLO per una cartella di progetto (B3), con
 * l'endpoint di un team preciso (`/mcp/<team>`). Ambito "local" di Claude Code: la registrazione
 * vale quando Claude Code è avviato in quella cartella, prevale su quella utente (il team
 * predefinito) e resta nella configurazione personale (~/.claude.json), non nel repository:
 * il token non finisce mai in un file che si potrebbe committare.
 * @param dir cartella da cui si avvia Claude Code (di solito la radice del repository)
 * @throws IntegrationError se la cartella non esiste o `claude` non è disponibile
 */
export function registerProjectMcp (dir: string, mcpUrl: string, token: string): { dir: string, mcpUrl: string } {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new IntegrationError(`Cartella inesistente: ${dir}`, `Folder not found: ${dir}`)
  const opts = { cwd: dir, windowsHide: true }
  spawnSync('claude', ['mcp', 'remove', '--scope', 'local', 'micelio'], { ...opts, stdio: 'ignore' })
  const args = ['mcp', 'add', '--transport', 'http', '--scope', 'local', 'micelio', mcpUrl, '--header', `Authorization: Bearer ${token}`]
  const r = spawnSync('claude', args, { ...opts, encoding: 'utf8' })
  if (r.error || r.status !== 0) {
    const detail = (r.error?.message ?? r.stderr ?? '').toString().trim()
    throw new IntegrationError(`Registrazione MCP non riuscita: ${detail || 'claude non disponibile'}`, `MCP registration failed: ${detail || 'claude not available'}`)
  }
  return { dir, mcpUrl }
}
