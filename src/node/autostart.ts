/**
 * @file Avvio automatico del daemon all'accesso al PC (`micelio autostart on|off|status`).
 *
 * In attesa degli installer (Fase 7, decisione D16) usiamo il meccanismo nativo di ogni sistema,
 * sempre a livello UTENTE (nessun privilegio di amministratore):
 * - Windows: uno script nella cartella "Esecuzione automatica" dell'utente
 *   (%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup). È un .vbs che lancia
 *   `micelio start` SENZA aprire finestre di console;
 * - macOS: un LaunchAgent in ~/Library/LaunchAgents (RunAtLoad);
 * - Linux: un servizio systemd dell'utente in ~/.config/systemd/user (WantedBy=default.target).
 *
 * MICELIO_AUTOSTART_DIR sostituisce la cartella di destinazione (test).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface AutostartTarget {
  /** File che abilita l'avvio automatico. */
  file: string
  /** Contenuto del file. */
  content: string
  /** Comandi da eseguire dopo la scrittura/rimozione (es. systemctl), se servono. */
  after?: { on: string[][], off: string[][] }
}

/**
 * File e contenuto per il sistema corrente.
 * @param cliMain percorso di dist/cli/main.js
 * @param home    cartella dati del nodo (MICELIO_HOME)
 */
export function autostartTarget (cliMain: string, home: string, platform = process.platform): AutostartTarget {
  const node = process.execPath
  const override = process.env.MICELIO_AUTOSTART_DIR
  if (platform === 'win32') {
    const dir = override ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
    // VBScript: Run(comando, 0 = finestra nascosta, False = non attendere). Le virgolette nel
    // comando vanno raddoppiate dentro la stringa VBScript.
    const cmd = `"${node}" "${cliMain}" --home "${home}" start`.replace(/"/g, '""')
    return { file: path.join(dir, 'micelio-start.vbs'), content: `' Avvio automatico di Micelio (creato da \`micelio autostart on\`)\r\nCreateObject("WScript.Shell").Run "${cmd}", 0, False\r\n` }
  }
  if (platform === 'darwin') {
    const dir = override ?? path.join(os.homedir(), 'Library', 'LaunchAgents')
    const file = path.join(dir, 'com.micelio.daemon.plist')
    const args = [node, cliMain, '--home', home, 'daemon'].map((a) => `    <string>${a}</string>`).join('\n')
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.micelio.daemon</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${path.join(home, 'logs', 'daemon.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(home, 'logs', 'daemon.log')}</string>
</dict>
</plist>
`
    return { file, content, after: { on: [['launchctl', 'load', '-w', file]], off: [['launchctl', 'unload', '-w', file]] } }
  }
  const dir = override ?? path.join(os.homedir(), '.config', 'systemd', 'user')
  const file = path.join(dir, 'micelio.service')
  const content = `[Unit]
Description=Micelio — nodo del secondo cervello del team

[Service]
ExecStart="${node}" "${cliMain}" --home "${home}" daemon
Restart=on-failure
Environment=NO_COLOR=1

[Install]
WantedBy=default.target
`
  return { file, content, after: { on: [['systemctl', '--user', 'enable', '--now', 'micelio.service']], off: [['systemctl', '--user', 'disable', '--now', 'micelio.service']] } }
}

/** Abilita l'avvio automatico. @returns il file creato */
export function autostartOn (cliMain: string, home: string): string {
  const t = autostartTarget(cliMain, home)
  fs.mkdirSync(path.dirname(t.file), { recursive: true })
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true })
  fs.writeFileSync(t.file, t.content)
  if (!process.env.MICELIO_AUTOSTART_DIR) for (const [cmd, ...args] of t.after?.on ?? []) spawnSync(cmd, args, { stdio: 'ignore' })
  return t.file
}

/** Disabilita l'avvio automatico. @returns true se era abilitato */
export function autostartOff (cliMain: string, home: string): boolean {
  const t = autostartTarget(cliMain, home)
  if (!fs.existsSync(t.file)) return false
  if (!process.env.MICELIO_AUTOSTART_DIR) for (const [cmd, ...args] of t.after?.off ?? []) spawnSync(cmd, args, { stdio: 'ignore' })
  fs.rmSync(t.file)
  return true
}

/** File dell'avvio automatico se abilitato, altrimenti null. */
export function autostartStatus (cliMain: string, home: string): string | null {
  const t = autostartTarget(cliMain, home)
  return fs.existsSync(t.file) ? t.file : null
}
