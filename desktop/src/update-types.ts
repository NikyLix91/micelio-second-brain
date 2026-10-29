/**
 * @file Forma dello stato degli aggiornamenti, condivisa fra il processo principale
 * (updater.ts) e la UI (ui/src/env.d.ts). Solo tipi, senza import: la UI la legge senza tirarsi
 * dietro Electron.
 *
 * EN: Shape of the update state, shared between the main process (updater.ts) and the UI
 * (ui/src/env.d.ts). Types only, no imports: the UI reads it without pulling in Electron.
 */
export type UpdateMode = 'install' | 'notify' | 'off'
export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'available' | 'error'
/** Perché un controllo è fallito: la UI lo spiega nelle due lingue. / EN: Why a check failed: the UI explains it in both languages. */
export type UpdateError = 'network' | 'signature' | 'install' | 'other'

/** Lo stato che vede la UI (Impostazioni → Aggiornamenti). / EN: The state the UI sees (Settings → Updates). */
export interface UpdateState {
  mode: UpdateMode
  /** Perché la modalità è `notify`: pacchetto .deb o app senza chiavi pubbliche. / EN: Why the mode is `notify`: .deb package or app without public keys. */
  notifyReason?: 'deb' | 'no-keys'
  /** Controllo automatico attivo. / EN: Automatic check on. */
  auto: boolean
  current: string
  status: UpdateStatus
  /** Versione trovata (scaricata o solo annunciata). / EN: Version found (downloaded or only announced). */
  version?: string
  percent?: number
  error?: UpdateError
  /** Messaggio tecnico dell'errore, in inglese (per la diagnostica). / EN: Technical error message (for diagnostics). */
  detail?: string
  checkedAt?: number
  /** Pagina della release trovata. / EN: Page of the release found. */
  releaseUrl?: string
}
