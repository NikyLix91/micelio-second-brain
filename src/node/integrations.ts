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
 *
 * EN: Integration with AI clients: today Claude Code (DESIGN §11, §6.1).
 *
 * EN: `setupClaudeCode` does two things, used both by `micelio setup claude-code` and by the button
 * in the UI's Settings screen:
 * 1. registers Micelio as a Claude Code MCP server (user scope), with `claude mcp add`;
 * 2. installs in ~/.claude/settings.json the SessionEnd hook that notifies the daemon when a session
 *    ends (automatic collection, active only in the enabled folders);
 * 3. (B4) installs the SessionStart and UserPromptSubmit hooks for AUTOMATIC CONTEXT: at session
 *    start and on every prompt they inject relevant Roots and memories into the conversation
 *    (src/context/agent-context.ts).
 *
 * EN: Both operations are idempotent: running them again replaces the previous configuration.
 */
import { spawnSync } from 'node:child_process'
import { LocalizedError } from '../core/errors'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Percorso della CLI compilata (dist/cli/main.js), che l'hook deve lanciare. / EN: Path of the compiled CLI (dist/cli/main.js), which the hook must run. */
export const CLI_MAIN = path.join(__dirname, '..', 'cli', 'main.js')

/** settings.json di Claude Code (rispetta CLAUDE_CONFIG_DIR se impostata). / EN: Claude Code's settings.json (honors CLAUDE_CONFIG_DIR if set). */
export function claudeSettingsFile (): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json')
}

/** Riconosce un hook installato da Micelio (per non duplicarlo e per poterlo sostituire). / EN: Recognizes a hook installed by Micelio (to avoid duplicating it and to be able to replace it). */
const isMicelioHook = (h: any) => typeof h?.command === 'string' && /hook (session-end|session-start|prompt)\b/.test(h.command) && h.command.includes('micelio')

/**
 * Hook di Micelio per evento di Claude Code: comando `micelio hook <arg>` e timeout in secondi.
 * - SessionEnd: raccolta (se il daemon è spento lo avvia, quindi più tempo);
 * - SessionStart / UserPromptSubmit: contesto automatico (B4), brevi per non rallentare l'utente.
 *
 * EN: Micelio hooks per Claude Code event: `micelio hook <arg>` command and timeout in seconds.
 * - SessionEnd: collection (if the daemon is off it starts it, hence more time);
 * - SessionStart / UserPromptSubmit: automatic context (B4), short so as not to slow the user down.
 */
export const MICELIO_HOOKS = {
  SessionEnd: { arg: 'session-end', timeout: 30 },
  SessionStart: { arg: 'session-start', timeout: 15 },
  UserPromptSubmit: { arg: 'prompt', timeout: 10 }
} as const
export type HookEvent = keyof typeof MICELIO_HOOKS

/** Errore di configurazione da mostrare all'utente così com'è. / EN: Configuration error to show to the user as is. */
export class IntegrationError extends LocalizedError {}

/**
 * Comando dell'hook. Usa percorsi assoluti (funziona anche se `micelio` non è nel PATH) e
 * barre "/" con virgolette, così è interpretabile sia da cmd sia da bash.
 *
 * EN: The hook command. It uses absolute paths (works even if `micelio` is not in the PATH) and
 * "/" separators with quotes, so both cmd and bash can parse it.
 */
export function hookCommand (home: string, cliMain = CLI_MAIN, arg: string = MICELIO_HOOKS.SessionEnd.arg): string {
  const slash = (p: string) => p.replace(/\\/g, '/')
  return `"${slash(process.execPath)}" "${slash(cliMain)}" --home "${slash(home)}" hook ${arg}`
}

/**
 * Installa (o reinstalla) l'hook SessionEnd di Micelio in settings.json di Claude Code.
 * Preserva tutto il resto del file e ne salva prima una copia (`settings.json.micelio-backup`).
 *
 * EN: Installs (or reinstalls) Micelio's SessionEnd hook in Claude Code's settings.json.
 * Keeps the rest of the file intact and saves a copy first (`settings.json.micelio-backup`).
 * @returns il percorso del file modificato
 *          EN: the path of the modified file
 */
export function installSessionEndHook (home: string, cliMain = CLI_MAIN): string {
  return installHooks(home, ['SessionEnd'], cliMain)
}

/**
 * Installa (o reinstalla) gli hook di Micelio indicati; toglie quelli di Micelio per gli eventi
 * NON indicati (così si possono anche disattivare). Il resto di settings.json non si tocca e se
 * ne salva prima una copia (`settings.json.micelio-backup`).
 *
 * EN: Installs (or reinstalls) the given Micelio hooks; removes Micelio's hooks for the events
 * NOT given (so they can also be turned off). The rest of settings.json is left untouched and a
 * copy is saved first (`settings.json.micelio-backup`).
 * @returns il percorso del file modificato
 *          EN: the path of the modified file
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
    // EN: Removes any previous Micelio installation, then (if requested) adds the current one.
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

/** Argomenti di `claude mcp add` per registrare il server MCP del daemon. / EN: Arguments of `claude mcp add` to register the daemon's MCP server. */
export function mcpAddArgs (mcpUrl: string, token: string): string[] {
  return ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'micelio', mcpUrl, '--header', `Authorization: Bearer ${token}`]
}

/**
 * Registra Micelio come server MCP in Claude Code. Rimuove prima un'eventuale registrazione
 * vecchia (es. con un token o una porta diversi).
 *
 * EN: Registers Micelio as an MCP server in Claude Code. First removes any old registration
 * (e.g. with a different token or port).
 * @throws IntegrationError se `claude` non è disponibile o il comando fallisce
 *         EN: IntegrationError if `claude` is not available or the command fails
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
  /** URL MCP registrato. / EN: Registered MCP URL. */
  mcpUrl: string
  /** File settings.json modificato, o null se l'hook non è stato richiesto. / EN: Modified settings.json file, or null if the hook was not requested. */
  hookFile: string | null
}

/**
 * Configurazione completa di Claude Code: MCP + (facoltativo) hook di fine sessione.
 *
 * EN: Full Claude Code setup: MCP + (optional) session-end hook.
 * @param hook true per installare anche l'hook della raccolta automatica
 *        EN: true to also install the automatic collection hook
 */
export function setupClaudeCode (opts: { mcpUrl: string, token: string, home: string, hook: boolean, context?: boolean }): ClaudeCodeSetupResult {
  registerMcp(opts.mcpUrl, opts.token)
  // Contesto automatico (B4): attivo salvo richiesta contraria
  // EN: Automatic context (B4): on unless asked otherwise
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
 *
 * EN: Registers Micelio as a Claude Code MCP server ONLY for a project folder (B3), with the
 * endpoint of a specific team (`/mcp/<team>`). Claude Code's "local" scope: the registration
 * applies when Claude Code is started in that folder, takes precedence over the user one (the
 * default team) and stays in the personal configuration (~/.claude.json), not in the repository:
 * the token never ends up in a file that could be committed.
 * @param dir cartella da cui si avvia Claude Code (di solito la radice del repository)
 *        EN: folder Claude Code is started from (usually the repository root)
 * @throws IntegrationError se la cartella non esiste o `claude` non è disponibile
 *         EN: IntegrationError if the folder doesn't exist or `claude` is not available
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
