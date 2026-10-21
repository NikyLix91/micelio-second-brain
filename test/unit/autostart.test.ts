/**
 * Avvio automatico (src/node/autostart.ts): file generati per ogni sistema, attivazione e
 * disattivazione in una cartella di prova (MICELIO_AUTOSTART_DIR), senza toccare il sistema reale.
 *
 * EN: Autostart (src/node/autostart.ts): files generated for each OS, enabling and disabling in a
 * test folder (MICELIO_AUTOSTART_DIR), without touching the real system.
 */
import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { autostartOff, autostartOn, autostartStatus, autostartTarget } from '../../src/node/autostart'
import { tmpHome } from '../helpers'

describe('autostart', () => {
  const prev = process.env.MICELIO_AUTOSTART_DIR
  beforeEach(() => { process.env.MICELIO_AUTOSTART_DIR = tmpHome('autostart') })
  afterEach(() => { if (prev === undefined) delete process.env.MICELIO_AUTOSTART_DIR; else process.env.MICELIO_AUTOSTART_DIR = prev })

  it('Windows: script .vbs che avvia `micelio start` senza finestra', () => {
    const t = autostartTarget('C:/m/dist/cli/main.js', 'C:/Users/x/.micelio', 'win32')
    expect(t.file).toMatch(/micelio-start\.vbs$/)
    expect(t.content).toContain('.Run ')
    expect(t.content).toContain(', 0, False') // finestra nascosta, non attende / EN: hidden window, does not wait
    expect(t.content).toContain('""C:/m/dist/cli/main.js"" --home ""C:/Users/x/.micelio"" start')
  })

  it('macOS: LaunchAgent con RunAtLoad; Linux: servizio systemd utente', () => {
    const mac = autostartTarget('/m/main.js', '/h', 'darwin')
    expect(mac.content).toContain('<key>RunAtLoad</key><true/>')
    expect(mac.after?.on[0]).toEqual(['launchctl', 'load', '-w', mac.file])
    const linux = autostartTarget('/m/main.js', '/h', 'linux')
    expect(linux.content).toContain('WantedBy=default.target')
    expect(linux.content).toContain('--home "/h" daemon')
  })

  it('on / status / off', () => {
    const home = tmpHome('home')
    expect(autostartStatus('/m/main.js', home)).toBeNull()
    const file = autostartOn('/m/main.js', home)
    expect(fs.existsSync(file)).toBe(true)
    expect(autostartStatus('/m/main.js', home)).toBe(file)
    expect(autostartOff('/m/main.js', home)).toBe(true)
    expect(fs.existsSync(file)).toBe(false)
    expect(autostartOff('/m/main.js', home)).toBe(false)
  })
})
