/**
 * @file Ricerca dell'eseguibile di Claude Code (`claude`) su questo PC.
 *
 * EN: Finding the Claude Code executable (`claude`) on this PC.
 *
 * Micelio lancia `claude` per due motivi: registrare il server MCP (`claude mcp add`) e
 * distillare con l'LLM (`claude -p`). Lanciarlo come semplice "claude" fallisce in casi reali:
 * - installazione con npm: su Windows è `claude.cmd`, e Node senza shell avvia solo i `.exe`;
 * - solo l'estensione di VS Code: il suo `claude.exe` sta nella cartella dell'estensione, non nel PATH;
 * - Claude Code installato da un altro utente Windows (policy aziendali) o PATH non aggiornato;
 * - macOS: le app avviate dal Finder hanno un PATH minimo, senza ~/.local/bin né Homebrew.
 * Bug reale del 2026-10-22: colleghi che non vedevano Micelio in `/mcp` dopo «Collega Claude Code».
 *
 * EN: Micelio runs `claude` for two reasons: registering the MCP server (`claude mcp add`) and
 * distilling with the LLM (`claude -p`). Running it as plain "claude" fails in real cases:
 * - npm install: on Windows it's `claude.cmd`, and Node without a shell only starts `.exe` files;
 * - VS Code extension only: its `claude.exe` lives in the extension folder, not in the PATH;
 * - Claude Code installed by another Windows user (company policies) or a stale PATH;
 * - macOS: apps started from the Finder have a minimal PATH, without ~/.local/bin or Homebrew.
 * Real bug of 2026-10-22: colleagues not seeing Micelio in `/mcp` after "Connect Claude Code".
 *
 * Un `claude.cmd` di npm non si lancia: si lancia direttamente il suo `cli.js` con il Node di
 * Micelio. Così non serve mai `shell: true`, che su Windows concatena gli argomenti senza escape
 * (spike B) e romperebbe i prompt e i percorsi con spazi.
 *
 * EN: An npm `claude.cmd` is not run: its `cli.js` is run directly with Micelio's Node. This way
 * `shell: true` is never needed, which on Windows joins the arguments without escaping (spike B)
 * and would break prompts and paths with spaces.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Come lanciare Claude Code: `command` seguito da `prefix` e poi dagli argomenti. / EN: How to run Claude Code: `command` followed by `prefix` and then the arguments. */
export interface ClaudeCommand {
  command: string
  prefix: string[]
  /** File trovato (per i messaggi e la diagnostica). / EN: File found (for messages and diagnostics). */
  file: string
}

/** Ambiente della ricerca: sostituibile nei test. / EN: Search environment: replaceable in tests. */
export interface LocateOptions {
  env?: NodeJS.ProcessEnv
  home?: string
  platform?: NodeJS.Platform
}

/** Cartelle degli editor che possono contenere l'estensione di Claude Code. / EN: Editor folders that may contain the Claude Code extension. */
const EDITOR_DIRS = ['.vscode', '.vscode-insiders', '.cursor', '.windsurf', '.vscode-server']

/**
 * Trova Claude Code. Ordine: percorso configurato, PATH, installazioni note, estensioni degli
 * editor (la più recente). null se non c'è da nessuna parte.
 *
 * EN: Finds Claude Code. Order: configured path, PATH, known installs, editor extensions (the
 * newest). null if it is nowhere to be found.
 * @param name "claude" (predefinito), un altro nome da cercare nel PATH o un percorso
 *        EN: "claude" (default), another name to look up in the PATH, or a path
 */
export function locateClaude (name = 'claude', o: LocateOptions = {}): ClaudeCommand | null {
  const env = o.env ?? process.env
  const home = o.home ?? os.homedir()
  const win = (o.platform ?? process.platform) === 'win32'
  // Percorso esplicito (Impostazioni → LLM): si usa quello e basta
  // EN: Explicit path (Settings → LLM): use that and nothing else
  if (name.includes('/') || name.includes('\\')) return toCommand(name)
  const names = win ? [`${name}.exe`, `${name}.cmd`] : [name]
  const pathDirs = (env.PATH ?? env.Path ?? '').split(win ? ';' : ':').filter(Boolean)
  const candidates: string[] = []
  for (const dir of pathDirs) for (const n of names) candidates.push(path.join(dir, n))
  // Le installazioni note valgono solo per il nome standard
  // EN: Known installs only apply to the standard name
  if (name === 'claude') candidates.push(...knownInstalls(home, env, win), ...editorBinaries(home, win))
  for (const c of candidates) {
    const cmd = toCommand(c)
    if (cmd) return cmd
  }
  return null
}

/** Percorsi d'installazione di Claude Code noti, per piattaforma. / EN: Known Claude Code install paths, per platform. */
function knownInstalls (home: string, env: NodeJS.ProcessEnv, win: boolean): string[] {
  if (win) {
    return [
      path.join(home, '.local', 'bin', 'claude.exe'), // installer nativo / EN: native installer
      ...(env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'claude.exe')] : []),
      ...(env.APPDATA ? [path.join(env.APPDATA, 'npm', 'claude.cmd')] : []), // npm -g
      path.join(home, '.claude', 'local', 'claude.cmd') // vecchia installazione "locale" / EN: old "local" install
    ]
  }
  return [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'local', 'claude'),
    path.join(home, '.npm-global', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude'
  ]
}

/**
 * `claude` incluso nelle estensioni di VS Code e simili, dalla versione installata più di recente.
 *
 * EN: `claude` bundled in the VS Code (and similar) extensions, from the most recently installed one.
 */
function editorBinaries (home: string, win: boolean): string[] {
  const found: Array<{ file: string, mtime: number }> = []
  for (const editor of EDITOR_DIRS) {
    const dir = path.join(home, editor, 'extensions')
    let entries: string[]
    try { entries = fs.readdirSync(dir) } catch { continue }
    for (const e of entries) {
      if (!e.toLowerCase().startsWith('anthropic.claude-code-')) continue
      const file = path.join(dir, e, 'resources', 'native-binary', win ? 'claude.exe' : 'claude')
      try { found.push({ file, mtime: fs.statSync(file).mtimeMs }) } catch { /* versione senza binario / EN: version without a binary */ }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).map((f) => f.file)
}

/**
 * Trasforma un file in un comando lanciabile senza shell. Un `.cmd`/`.ps1` di npm diventa
 * "node cli.js"; se il `cli.js` non si trova, il file non è utilizzabile (null).
 *
 * EN: Turns a file into a command that can run without a shell. An npm `.cmd`/`.ps1` becomes
 * "node cli.js"; if the `cli.js` can't be found, the file isn't usable (null).
 */
function toCommand (file: string): ClaudeCommand | null {
  try {
    if (!fs.statSync(file).isFile()) return null
  } catch {
    return null
  }
  if (!/\.(cmd|bat|ps1)$/i.test(file)) return { command: file, prefix: [], file }
  const dir = path.dirname(file)
  // 1) Lo script di npm dice a cosa punta: "%dp0%\node_modules\...\cli.js" (o un .exe nelle
  //    versioni native). Si legge quello, così si segue qualunque struttura del pacchetto.
  // EN: 1) The npm script says what it points to: "%dp0%\node_modules\...\cli.js" (or an .exe in
  //     native versions). We read that, so any package layout is followed.
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { /* illeggibile: si prova con i percorsi noti / EN: unreadable: try the known paths */ }
  for (const m of text.matchAll(/%~?dp0%?\\([^"\r\n]+?\.(?:js|exe))"/gi)) {
    const target = path.join(dir, m[1])
    if (/[\\/]node\.exe$/i.test(target) || !fs.existsSync(target)) continue
    return target.toLowerCase().endsWith('.js') ? { command: process.execPath, prefix: [target], file } : { command: target, prefix: [], file }
  }
  // 2) Percorsi noti: npm -g mette lo script accanto a node_modules, l'installazione "locale" in
  //    node_modules/.bin
  // EN: 2) Known paths: npm -g puts the script next to node_modules, the "local" install in
  //     node_modules/.bin
  for (const base of [path.join(dir, 'node_modules'), path.join(dir, '..')]) {
    const cli = path.join(base, '@anthropic-ai', 'claude-code', 'cli.js')
    if (fs.existsSync(cli)) return { command: process.execPath, prefix: [cli], file }
  }
  return null
}
