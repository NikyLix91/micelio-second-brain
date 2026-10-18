/**
 * Ponte con l'app desktop. Quando la UI gira dentro Electron, il preload (desktop/src/preload.ts)
 * espone `window.micelio` con il token e alcune funzioni native. Nel browser è `undefined`.
 */
interface MicelioDesktopBridge {
  /** Token dell'API locale, letto da config.json dal processo principale di Electron. */
  token: string
  /** Apre il selettore di cartelle del sistema operativo; null se annullato. */
  pickFolder?: () => Promise<string | null>
  /** Mostra un file nella cartella che lo contiene (Esplora file / Finder). */
  showInFolder?: (path: string) => Promise<void>
  /** Comunica la lingua scelta all'app desktop (menu dell'icona e notifiche). */
  setLang?: (lang: string) => void
}

interface Window {
  micelio?: MicelioDesktopBridge
}
