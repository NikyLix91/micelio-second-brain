/**
 * @file Processo principale dell'app desktop di Micelio (Electron).
 *
 * EN: Main process of the Micelio desktop app (Electron).
 *
 * All'avvio:
 * 1. legge configurazione e token del nodo locale (stesso ~/.micelio della CLI);
 * 2. avvia il daemon se non è già attivo (desktop/src/daemon.ts);
 * 3. apre una finestra con la UI servita dal daemon (http://127.0.0.1:7337/ui/);
 * 4. mette un'icona nell'area di notifica e ascolta il daemon per le notifiche (D15).
 *
 * EN: On startup:
 * 1. reads the local node's configuration and token (same ~/.micelio as the CLI);
 * 2. starts the daemon if it isn't already running (desktop/src/daemon.ts);
 * 3. opens a window with the UI served by the daemon (http://127.0.0.1:7337/ui/);
 * 4. puts an icon in the notification area and listens to the daemon for notifications (D15).
 *
 * Chiudere la finestra la NASCONDE (l'app resta nell'area di notifica e continua a notificare).
 * "Esci" dal menu dell'icona chiude l'app; il daemon resta attivo (si ferma con `micelio stop`).
 *
 * EN: Closing the window HIDES it (the app stays in the notification area and keeps notifying).
 * "Quit" from the icon menu closes the app; the daemon keeps running (stop it with `micelio stop`).
 *
 * Sicurezza: la UI gira isolata (contextIsolation, sandbox, niente Node) e può navigare solo
 * dentro il daemon locale; i link esterni si aprono nel browser di sistema.
 *
 * EN: Security: the UI runs isolated (contextIsolation, sandbox, no Node) and can only navigate
 * within the local daemon; external links open in the system browser.
 *
 * Modalità `--screenshots [cartella]`: cattura le schermate principali in PNG ed esce. Serve a
 * verificare l'aspetto reale delle viste (anche quella 3D) senza un tester umano.
 *
 * EN: `--screenshots [cartella]` mode: captures the main screens as PNG and exits. It's used to
 * check the real look of the views (the 3D one too) without a human tester.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import { type DaemonInfo, daemonInfo, ensureDaemon } from './daemon'
import { nucleusIconPng } from './icon'
import { watchDaemon } from './notifications'
import { langFromLocale, setDesktopLang, t } from './strings'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
const icon = nativeImage.createFromBuffer(nucleusIconPng(64))
const log = (m: string) => console.log(`[micelio-desktop] ${m}`)

/** Indice dell'argomento `--screenshots` (−1 se assente) e cartella di destinazione. / EN: Index of the `--screenshots` argument (−1 if missing) and target folder. */
const shotIdx = process.argv.indexOf('--screenshots')
const screenshotDir = shotIdx >= 0
  ? path.resolve(process.argv[shotIdx + 1] && !process.argv[shotIdx + 1].startsWith('-') ? process.argv[shotIdx + 1] : 'screenshots')
  : null

// Linux: Wayland nativo se c'è un display Wayland, altrimenti X11.
// Chromium sceglie la piattaforma grafica prima che parta il JavaScript: `appendSwitch` qui è
// troppo tardi, e `ozone-platform-hint=auto` sceglie Wayland solo con XDG_SESSION_TYPE=wayland,
// vuoto su WSLg (avvio dal menu di Windows). Quindi si rilancia l'app con il flag esplicito.
// Electron imposta già da solo `ozone-platform` (a x11 se XDG_SESSION_TYPE non è wayland), quindi
// si guarda il valore e non la presenza del flag. Per restare su X11 basta ELECTRON_OZONE_PLATFORM_HINT=x11.
// Il rilancio avviene una sola volta: al secondo giro il valore è già wayland.
// EN: Linux: native Wayland if there is a Wayland display, otherwise X11.
//     Chromium picks the graphics platform before JavaScript starts: `appendSwitch` here is too
//     late, and `ozone-platform-hint=auto` picks Wayland only with XDG_SESSION_TYPE=wayland, which
//     is empty on WSLg (launched from the Windows menu). So the app is relaunched with the explicit
//     flag. Electron already sets `ozone-platform` by itself (to x11 if XDG_SESSION_TYPE isn't
//     wayland), so we check the value and not the flag's presence. To stay on X11 set
//     ELECTRON_OZONE_PLATFORM_HINT=x11. The relaunch happens only once: the second time the value
//     is already wayland.
if (process.platform === 'linux' && process.env.WAYLAND_DISPLAY && !process.env.ELECTRON_OZONE_PLATFORM_HINT &&
    app.commandLine.getSwitchValue('ozone-platform') !== 'wayland') {
  app.relaunch({ args: [...process.argv.slice(1), '--ozone-platform=wayland'] })
  app.exit(0)
}

// Una sola istanza: un secondo avvio riporta in primo piano la finestra esistente.
// EN: Single instance: a second launch brings the existing window to the front.
if (!screenshotDir && !app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => showWindow())

/** Crea (o mostra) la finestra principale. / EN: Creates (or shows) the main window. */
function showWindow (route = ''): void {
  if (win) {
    if (route) void win.loadURL(`${uiUrl}#${route}`)
    win.show()
    win.focus()
    return
  }
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Micelio',
    icon,
    backgroundColor: '#03060a',
    show: !screenshotDir,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  // Link esterni (es. nei ricordi) nel browser di sistema, mai dentro l'app.
  // EN: External links (e.g. in memories) open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // La finestra può navigare solo dentro la UI locale.
  // EN: The window can only navigate within the local UI.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(uiUrl)) {
      e.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    }
  })
  // Chiudere = nascondere (si resta nell'area di notifica), salvo uscita esplicita.
  // EN: Close = hide (stay in the notification area), unless quitting explicitly.
  win.on('close', (e) => {
    if (!quitting && !screenshotDir) {
      e.preventDefault()
      win?.hide()
    }
  })
  // Messaggi della console della UI nel log dell'app (utile per la diagnostica).
  // EN: UI console messages go to the app log (useful for diagnostics).
  win.webContents.on('console-message', (e: any) => { if (String(e.message ?? '').startsWith('[nucleus]')) log(e.message) })
  // F5 / Ctrl+R ricaricano la UI (senza menu applicativo le scorciatoie standard non esistono):
  // utile dopo un aggiornamento di Micelio, quando il daemon serve una UI nuova.
  // EN: F5 / Ctrl+R reload the UI (without an application menu the standard shortcuts don't exist):
  //     useful after a Micelio update, when the daemon serves a new UI.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r'))) {
      e.preventDefault()
      win?.webContents.reload()
    }
  })
  win.on('closed', () => { win = null })
  void win.loadURL(`${uiUrl}${route ? '#' + route : ''}`)
}

let uiUrl = ''

/** Icona e menu nell'area di notifica. / EN: Icon and menu in the notification area. */
function createTray (info: DaemonInfo): void {
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Micelio')
  trayInfo = info
  buildTrayMenu()
  tray.on('click', () => showWindow())
}

let trayInfo: DaemonInfo | null = null

/** Menu dell'icona nella lingua corrente (ricostruito quando l'utente cambia lingua nella UI). / EN: Icon menu in the current language (rebuilt when the user changes language in the UI). */
function buildTrayMenu (): void {
  if (!tray || !trayInfo) return
  const info = trayInfo
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t().trayOpen, click: () => showWindow() },
    { label: t().trayInbox, click: () => showWindow('/inbox') },
    { label: t().trayBrowser, click: () => void shell.openExternal(`${info.baseUrl}/ui/`) },
    { type: 'separator' },
    { label: t().trayQuit, click: () => { quitting = true; app.quit() } }
  ]))
}

/**
 * Cattura le schermate principali in PNG. Per ogni rotta: carica, attende che la scena si
 * assesti (la vista 3D ha un'animazione d'ingresso), cattura.
 *
 * EN: Captures the main screens as PNG. For each route: load, wait for the scene to settle
 * (the 3D view has an intro animation), capture.
 */
async function takeScreenshots (dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true })
  // Errori della pagina nel log: una schermata vuota senza spiegazione non aiuta nessuno.
  // EN: Page errors go to the log: a blank screenshot with no explanation helps nobody.
  win!.webContents.on('console-message', (e: any) => {
    const level = e.level ?? ''
    if (level === 'error' || level === 3) log(`pagina: ${e.message ?? ''}`)
  })
  const routes: [string, string, number][] = [
    ['nucleo', '/', 9000], ['nucleo-tour', '/?tour=1', 11000], ['nucleo-autori', '/?colori=autore', 9000], ['mappa-2d', '/mappa', 6000], ['memoria', '/memoria', 2000], ['inbox', '/inbox', 2000],
    ['team', '/team', 2000], ['sogni', '/sogni', 2000], ['stato', '/stato', 2000], ['privato', '/privato', 2000], ['impostazioni', '/impostazioni', 2000]
  ]
  // MICELIO_SCREENSHOT_ONLY=nucleo,team limita le catture ad alcune schermate (diagnostica).
  // EN: MICELIO_SCREENSHOT_ONLY=nucleo,team limits the captures to some screens (diagnostics).
  const only = process.env.MICELIO_SCREENSHOT_ONLY?.split(',')
  // MICELIO_SCREENSHOT_EXTRA="/?a=1|/?b=2" aggiunge rotte da catturare (extra1, extra2…).
  // EN: MICELIO_SCREENSHOT_EXTRA="/?a=1|/?b=2" adds routes to capture (extra1, extra2…).
  const extra: [string, string, number][] = (process.env.MICELIO_SCREENSHOT_EXTRA ?? '').split('|').filter(Boolean).map((r, i) => [`extra${i + 1}`, r, 9000])
  for (const [name, route, wait] of [...routes, ...extra].filter(([n]) => !only || only.includes(n))) {
    await win!.loadURL(`${uiUrl}#${route}`)
    await new Promise((r) => setTimeout(r, wait))
    const img = await win!.webContents.capturePage()
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG())
    log(`schermata salvata: ${name}.png`)
  }
}

app.whenReady().then(async () => {
  setDesktopLang(langFromLocale(app.getLocale()))
  // Niente menu applicativo: la navigazione è nella UI.
  // EN: No application menu: navigation is in the UI.
  Menu.setApplicationMenu(null)
  let info: DaemonInfo
  try {
    info = daemonInfo()
    await ensureDaemon(info, log)
  } catch (err) {
    dialog.showErrorBox('Micelio', (err as Error).message)
    app.quit()
    return
  }
  uiUrl = `${info.baseUrl}/ui/`

  // Ponte con la UI (vedi preload.ts).
  // EN: Bridge with the UI (see preload.ts).
  ipcMain.on('micelio:token', (e) => { e.returnValue = info.token })
  ipcMain.handle('micelio:pick-folder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: t().pickFolder })
    return r.canceled ? null : r.filePaths[0]
  })

  // Mostra un file nella sua cartella. Solo "mostra", mai "esegui": un documento arrivato da un
  // collega non viene aperto automaticamente.
  // EN: Shows a file in its folder. Only "show", never "run": a document received from a
  //     colleague is never opened automatically.
  // Lingua scelta nella UI: la seguono menu e notifiche (vedi strings.ts).
  // EN: Language chosen in the UI: menu and notifications follow it (see strings.ts).
  ipcMain.on('micelio:set-lang', (_e, l: unknown) => {
    if (l === 'it' || l === 'en') { setDesktopLang(l); buildTrayMenu() }
  })
  ipcMain.handle('micelio:show-in-folder', (_e, file: string) => { if (typeof file === 'string' && fs.existsSync(file)) shell.showItemInFolder(file) })

  if (screenshotDir) {
    showWindow()
    await takeScreenshots(screenshotDir)
    quitting = true
    app.quit()
    return
  }

  createTray(info)
  showWindow()
  // Settimana dell'ultimo riepilogo notificato (B4): su disco, così un riavvio non lo ripete
  // EN: Week of the last notified digest (B4): on disk, so a restart doesn't repeat it
  const weekFile = path.join(app.getPath('userData'), 'micelio-digest-week.txt')
  const weekState = {
    get: () => { try { return fs.readFileSync(weekFile, 'utf8').trim() || null } catch { return null } },
    set: (week: string) => { try { fs.writeFileSync(weekFile, week) } catch {} }
  }
  watchDaemon(info, (n) => {
    const notification = new Notification({ title: n.title, body: n.body, icon })
    notification.on('click', () => showWindow(n.route))
    notification.show()
  }, weekState)
}).catch((err) => {
  log(`errore all'avvio: ${err?.stack ?? err}`)
  app.quit()
})

// Con la finestra chiusa l'app resta nell'area di notifica: non usciamo su "tutte le finestre chiuse".
// EN: With the window closed the app stays in the notification area: we don't quit on "all windows closed".
app.on('window-all-closed', () => {
  if (screenshotDir) app.quit()
})
app.on('before-quit', () => { quitting = true })
