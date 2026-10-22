/**
 * @file Integrazione con i client AI: oggi Claude Code (DESIGN §11, §6.1).
 *
 * `setupClaudeCode` fa due cose, usate sia da `micelio setup claude-code` sia dal pulsante
 * nella schermata Impostazioni della UI:
 * 1. registra Micelio come server MCP di Claude Code (ambito utente), con `claude mcp add` (trovato
 *    anche se non è nel PATH, vedi claude-locator) o, se manca, scrivendo `.claude.json`;
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
 * 1. registers Micelio as a Claude Code MCP server (user scope), with `claude mcp add` (found even
 *    when it is not in the PATH, see claude-locator) or, if missing, by writing `.claude.json`;
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
import { locateClaude } from './claude-locator'
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

/**
 * Argomenti di `claude mcp add` per registrare Micelio in ambito utente. Si registra lo shim su
 * stdio (`micelio mcp`), NON l'endpoint HTTP: Claude Code avvia lo shim nella cartella del
 * progetto, lo shim la passa al daemon a ogni richiesta e il daemon sceglie il team che possiede
 * quella cartella. Con l'endpoint HTTP il daemon non sa dove lavora l'agente e usava sempre il
 * team predefinito: bug reale (2026-10-21), ricordi di un progetto del team A pubblicati nel
 * team B. Il token non compare: lo shim lo legge da config.json.
 *
 * EN: Arguments of `claude mcp add` to register Micelio in user scope. We register the stdio shim
 * (`micelio mcp`), NOT the HTTP endpoint: Claude Code starts the shim in the project folder, the
 * shim passes it to the daemon on every request and the daemon picks the team that owns that
 * folder. With the HTTP endpoint the daemon doesn't know where the agent works and always used the
 * default team: real bug (2026-10-21), memories of a team A project published in team B. The
 * token doesn't appear: the shim reads it from config.json.
 */
export function mcpAddArgs (home: string, cliMain = CLI_MAIN): string[] {
  const slash = (p: string) => p.replace(/\\/g, '/')
  return ['mcp', 'add', '--scope', 'user', 'micelio', '--', slash(process.execPath), slash(cliMain), '--home', slash(home), 'mcp']
}

/**
 * File di configurazione generale di Claude Code, dove stanno i server MCP dell'utente
 * (`mcpServers`) e quelli per progetto (`projects[<cartella>].mcpServers`). Con CLAUDE_CONFIG_DIR
 * sta in quella cartella, altrimenti nella cartella utente.
 *
 * EN: Claude Code's general configuration file, holding the user's MCP servers (`mcpServers`) and
 * the per-project ones (`projects[<folder>].mcpServers`). With CLAUDE_CONFIG_DIR it lives in that
 * folder, otherwise in the user folder.
 */
export function claudeConfigFile (): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), '.claude.json')
}

/**
 * true se Claude Code è mai stato usato dall'utente Windows/macOS/Linux che esegue Micelio.
 * Claude Code legge la configurazione dal profilo di chi lo esegue: se qui non c'è traccia, con
 * ogni probabilità lo si avvia con un altro utente (caso reale: Claude Code installato e usato da
 * un'utenza amministrativa, Micelio da quella personale) e la registrazione non verrà mai letta.
 *
 * EN: true if Claude Code has ever been used by the Windows/macOS/Linux user running Micelio.
 * Claude Code reads its configuration from the profile of whoever runs it: if there's no trace
 * here, it's most likely started with another user (real case: Claude Code installed and used by
 * an admin account, Micelio by the personal one) and the registration will never be read.
 */
export function claudeUsedByThisUser (): boolean {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  // Trascrizioni delle sessioni: le scrive solo Claude Code
  // EN: Session transcripts: only Claude Code writes them
  if (fs.existsSync(path.join(dir, 'projects'))) return true
  // .claude.json da solo non basta: può averlo creato Micelio stesso (registrazione senza CLI).
  // Si guarda un campo che scrive solo Claude Code al suo avvio.
  // EN: .claude.json alone isn't enough: Micelio itself may have created it (registration without
  //     the CLI). We look for a field only Claude Code writes when it starts.
  try {
    const cfg = JSON.parse(fs.readFileSync(claudeConfigFile(), 'utf8'))
    return cfg.numStartups != null || cfg.firstStartTime != null || cfg.userID != null
  } catch {
    return false
  }
}

/**
 * Modifica `.claude.json` direttamente, senza la CLI di Claude Code. Si usa solo quando `claude`
 * non si trova: Claude Code scrive spesso questo file, quindi lo si rilegge subito prima, si
 * cambia solo la voce di Micelio, si salva una copia (`.claude.json.micelio-backup`) e si scrive
 * con un file temporaneo e un rename, così non resta mai a metà.
 *
 * EN: Edits `.claude.json` directly, without the Claude Code CLI. Used only when `claude` can't be
 * found: Claude Code writes this file often, so it is re-read right before, only Micelio's entry
 * is changed, a copy is saved (`.claude.json.micelio-backup`) and it is written through a
 * temporary file and a rename, so it's never left half-written.
 * @throws IntegrationError se il file esiste ma non è JSON valido (meglio fermarsi che rovinarlo)
 *         EN: IntegrationError if the file exists but isn't valid JSON (better to stop than to damage it)
 */
function editClaudeConfig (change: (cfg: any) => void): string {
  const file = claudeConfigFile()
  let cfg: any = {}
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8')
    try {
      cfg = text.trim() ? JSON.parse(text) : {}
    } catch {
      throw new IntegrationError(`${file} non è un JSON valido: correggilo o registra Micelio a mano (micelio setup claude-code --print)`, `${file} is not valid JSON: fix it or register Micelio by hand (micelio setup claude-code --print)`)
    }
    fs.copyFileSync(file, file + '.micelio-backup')
  }
  change(cfg)
  const tmp = `${file}.micelio-${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2))
  fs.renameSync(tmp, file)
  return file
}

/** Come è stata fatta la registrazione: con la CLI di Claude Code o scrivendo `.claude.json`. / EN: How the registration was done: with the Claude Code CLI or by writing `.claude.json`. */
export interface McpRegistration {
  via: 'cli' | 'file'
  /** Eseguibile di Claude Code usato (null se non trovato). / EN: Claude Code executable used (null if not found). */
  claude: string | null
}

/**
 * Lancia la CLI di Claude Code, trovata con locateClaude (anche `claude.cmd` di npm o quella
 * dell'estensione di VS Code). null se non si trova.
 *
 * EN: Runs the Claude Code CLI, found with locateClaude (also npm's `claude.cmd` or the VS Code
 * extension's one). null if it can't be found.
 */
function runClaude (args: string[], cwd?: string): { status: number | null, detail: string, file: string } | null {
  const c = locateClaude()
  if (!c) return null
  const r = spawnSync(c.command, [...c.prefix, ...args], { cwd, encoding: 'utf8', windowsHide: true })
  return { status: r.error ? null : r.status, detail: (r.error?.message ?? r.stderr ?? '').toString().trim(), file: c.file }
}

/**
 * Registra Micelio come server MCP in Claude Code (ambito utente). Rimuove prima un'eventuale
 * registrazione vecchia (es. quella HTTP delle versioni precedenti, o con una porta diversa).
 * Se la CLI di Claude Code non si trova scrive la stessa voce direttamente in `.claude.json`:
 * il risultato per Claude Code è identico.
 *
 * EN: Registers Micelio as an MCP server in Claude Code (user scope). First removes any old
 * registration (e.g. the HTTP one of previous versions, or one with a different port).
 * If the Claude Code CLI can't be found it writes the same entry directly into `.claude.json`:
 * for Claude Code the result is identical.
 * @throws IntegrationError se la CLI c'è ma il comando fallisce
 *         EN: IntegrationError if the CLI is there but the command fails
 */
export function registerMcp (home: string, cliMain = CLI_MAIN): McpRegistration {
  const args = mcpAddArgs(home, cliMain)
  if (runClaude(['mcp', 'remove', '--scope', 'user', 'micelio'])) {
    const r = runClaude(args)!
    if (r.status !== 0) {
      throw new IntegrationError(`Registrazione MCP non riuscita: ${r.detail || 'errore di claude'}`, `MCP registration failed: ${r.detail || 'claude error'}`)
    }
    return { via: 'cli', claude: r.file }
  }
  // Senza CLI: la stessa voce che scriverebbe `claude mcp add` (tutto ciò che segue "--")
  // EN: Without the CLI: the same entry `claude mcp add` would write (everything after "--")
  const [command, ...rest] = args.slice(args.indexOf('--') + 1)
  editClaudeConfig((cfg) => {
    cfg.mcpServers = { ...(cfg.mcpServers ?? {}), micelio: { type: 'stdio', command, args: rest, env: {} } }
  })
  return { via: 'file', claude: null }
}

export interface ClaudeCodeSetupResult extends McpRegistration {
  /** URL MCP registrato. / EN: Registered MCP URL. */
  mcpUrl: string
  /** File settings.json modificato, o null se l'hook non è stato richiesto. / EN: Modified settings.json file, or null if the hook was not requested. */
  hookFile: string | null
  /** Utente del sistema che esegue Micelio: la configurazione vale solo per lui. / EN: OS user running Micelio: the configuration only applies to them. */
  user: string
  /**
   * true se Claude Code non è mai stato usato da questo utente: probabilmente si avvia con un
   * altro utente e non vedrà Micelio (vedi claudeUsedByThisUser).
   *
   * EN: true if Claude Code has never been used by this user: it's probably started with another
   * user and won't see Micelio (see claudeUsedByThisUser).
   */
  otherUser: boolean
}

/**
 * Configurazione completa di Claude Code: MCP + (facoltativo) hook di fine sessione.
 *
 * EN: Full Claude Code setup: MCP + (optional) session-end hook.
 * @param hook true per installare anche l'hook della raccolta automatica
 *        EN: true to also install the automatic collection hook
 */
export function setupClaudeCode (opts: { mcpUrl: string, token: string, home: string, hook: boolean, context?: boolean }): ClaudeCodeSetupResult {
  const otherUser = !claudeUsedByThisUser()
  // mcpUrl e token restano nei parametri per compatibilità: lo shim li legge da config.json
  // EN: mcpUrl and token stay in the parameters for compatibility: the shim reads them from config.json
  const reg = registerMcp(opts.home)
  // Contesto automatico (B4): attivo salvo richiesta contraria
  // EN: Automatic context (B4): on unless asked otherwise
  const events: HookEvent[] = [...(opts.hook ? ['SessionEnd' as const] : []), ...(opts.context !== false ? ['SessionStart' as const, 'UserPromptSubmit' as const] : [])]
  const hookFile = events.length ? installHooks(opts.home, events) : null
  return { mcpUrl: opts.mcpUrl, hookFile, ...reg, user: os.userInfo().username, otherUser }
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
export function registerProjectMcp (dir: string, mcpUrl: string, token: string): { dir: string, mcpUrl: string } & McpRegistration {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new IntegrationError(`Cartella inesistente: ${dir}`, `Folder not found: ${dir}`)
  if (runClaude(['mcp', 'remove', '--scope', 'local', 'micelio'], dir)) {
    const r = runClaude(['mcp', 'add', '--transport', 'http', '--scope', 'local', 'micelio', mcpUrl, '--header', `Authorization: Bearer ${token}`], dir)!
    if (r.status !== 0) {
      throw new IntegrationError(`Registrazione MCP non riuscita: ${r.detail || 'errore di claude'}`, `MCP registration failed: ${r.detail || 'claude error'}`)
    }
    return { dir, mcpUrl, via: 'cli', claude: r.file }
  }
  // Senza CLI: la voce del progetto in .claude.json. Claude Code usa come chiave il percorso con
  // "/"; su Windows si riusa una chiave esistente che differisce solo per le maiuscole.
  // EN: Without the CLI: the project's entry in .claude.json. Claude Code uses the path with "/"
  //     as key; on Windows an existing key that only differs in case is reused.
  editClaudeConfig((cfg) => {
    cfg.projects ??= {}
    const wanted = path.resolve(dir).replace(/\\/g, '/')
    const key = Object.keys(cfg.projects).find((k) => process.platform === 'win32' ? k.toLowerCase() === wanted.toLowerCase() : k === wanted) ?? wanted
    const project = cfg.projects[key] ?? {}
    project.mcpServers = { ...(project.mcpServers ?? {}), micelio: { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } }
    cfg.projects[key] = project
  })
  return { dir, mcpUrl, via: 'file', claude: null }
}
