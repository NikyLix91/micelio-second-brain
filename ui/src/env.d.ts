/**
 * Ponte con l'app desktop. Quando la UI gira dentro Electron, il preload (desktop/src/preload.ts)
 * espone `window.micelio` con il token e alcune funzioni native. Nel browser è `undefined`.
 *
 * EN: Bridge to the desktop app. When the UI runs inside Electron, the preload (desktop/src/preload.ts)
 * exposes `window.micelio` with the token and a few native functions. In the browser it is `undefined`.
 */
interface MicelioDesktopBridge {
  /** Token dell'API locale, letto da config.json dal processo principale di Electron. / EN: Local API token, read from config.json by the Electron main process. */
  token: string
  /** Apre il selettore di cartelle del sistema operativo; null se annullato. / EN: Opens the operating system folder picker; null if canceled. */
  pickFolder?: () => Promise<string | null>
  /** Mostra un file nella cartella che lo contiene (Esplora file / Finder). / EN: Shows a file in its containing folder (File Explorer / Finder). */
  showInFolder?: (path: string) => Promise<void>
  /** Comunica la lingua scelta all'app desktop (menu dell'icona e notifiche). / EN: Tells the desktop app the chosen language (tray icon menu and notifications). */
  setLang?: (lang: string) => void
  /** Aggiornamenti dell'app (desktop/src/updater.ts); solo nell'app desktop. / EN: App updates (desktop/src/updater.ts); desktop app only. */
  updates?: {
    state: () => Promise<DesktopUpdateState>
    check: () => Promise<void>
    install: () => Promise<void>
    setAuto: (on: boolean) => Promise<DesktopUpdateState>
    onChange: (cb: (state: DesktopUpdateState) => void) => () => void
  }
}

/** Stato degli aggiornamenti (desktop/src/update-types.ts). / EN: Update state (desktop/src/update-types.ts). */
type DesktopUpdateState = import('../../desktop/src/update-types').UpdateState

interface Window {
  micelio?: MicelioDesktopBridge
}

/**
 * Versione dell'app (da package.json della radice), iniettata da Vite in fase di build.
 * Serve alla scheda «Informazioni» delle Impostazioni.
 *
 * EN: App version (from the root package.json), injected by Vite at build time.
 * Used by the «Informazioni» (About) card in Settings.
 */
declare const __MICELIO_VERSION__: string
