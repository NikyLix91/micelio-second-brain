/**
 * @file Aggiornamenti automatici dell'app desktop (B13 fase 4), con electron-updater e le release
 * di GitHub.
 *
 * EN: Automatic updates of the desktop app (B13 phase 4), with electron-updater and GitHub releases.
 *
 * FLUSSO.
 * 1. 30 secondi dopo l'avvio e poi ogni 4 ore l'app legge `latest.yml` (Windows) o
 *    `latest-linux.yml` (AppImage) dell'ultima release. Nessun account: la repository è pubblica.
 * 2. Se c'è una versione più nuova la scarica in background (electron-updater ne controlla lo
 *    SHA-512 scritto nel file .yml).
 * 3. Scarica `<pacchetto>.sig` dalla stessa release e verifica la NOSTRA firma Ed25519
 *    (update-signature.ts) con le chiavi di update-keys.ts. Se non torna, cancella il file e non
 *    installa nulla.
 * 4. Avvisa (notifica, voce nel menu dell'icona, scheda nelle Impostazioni) e installa SOLO
 *    quando l'utente sceglie «Riavvia e aggiorna»: prima ferma il daemon, poi electron-updater
 *    lancia l'installer in silenzio e riapre l'app, che riavvia il daemon nuovo.
 *    L'installazione automatica all'uscita di electron-updater è spenta: passerebbe senza la
 *    nostra verifica.
 *
 * EN: FLOW.
 * 1. 30 seconds after startup and then every 4 hours the app reads `latest.yml` (Windows) or
 *    `latest-linux.yml` (AppImage) of the latest release. No account: the repository is public.
 * 2. If there's a newer version it downloads it in the background (electron-updater checks the
 *    SHA-512 written in the .yml file).
 * 3. It downloads `<package>.sig` from the same release and verifies OUR Ed25519 signature
 *    (update-signature.ts) with the keys in update-keys.ts. If it doesn't match, it deletes the
 *    file and installs nothing.
 * 4. It notifies (notification, item in the icon menu, card in Settings) and installs ONLY when
 *    the user picks "Restart and update": first it stops the daemon, then electron-updater runs
 *    the installer silently and reopens the app, which restarts the new daemon.
 *    electron-updater's automatic install on quit is off: it would bypass our verification.
 *
 * MODALITÀ.
 * - `install`: installer di Windows e AppImage, il ciclo completo;
 * - `notify`: pacchetto .deb (lo aggiorna il gestore dei pacchetti, con la password di
 *   amministratore) o app senza chiavi pubbliche: solo l'avviso, con il link alla release;
 * - `off`: app avviata dai sorgenti (`npm run desktop`) o sistema non supportato.
 *
 * EN: MODES.
 * - `install`: Windows installer and AppImage, the full cycle;
 * - `notify`: .deb package (updated by the package manager, with the administrator password) or
 *   app without public keys: only the notice, with the link to the release;
 * - `off`: app started from source (`npm run desktop`) or unsupported system.
 *
 * PROVE. `MICELIO_UPDATE_URL=<url>` legge gli aggiornamenti da un server qualunque (provider
 * "generic" di electron-updater) invece che da GitHub: serve alla prova completa in locale. La
 * firma resta obbligatoria, quindi non apre nessuna porta: un pacchetto si installa solo se è
 * firmato con una chiave di update-keys.ts.
 *
 * EN: TESTS. `MICELIO_UPDATE_URL=<url>` reads updates from any server (electron-updater's
 * "generic" provider) instead of GitHub: it's used by the full local test. The signature stays
 * mandatory, so it opens no door: a package is installed only if signed with a key in update-keys.ts.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, net } from 'electron'
import { autoUpdater, type UpdateDownloadedEvent, type UpdateInfo } from 'electron-updater'
import { UPDATE_PUBLIC_KEYS } from './update-keys'
import { UpdateSignatureError, verifyUpdate, withIds } from './update-signature'
import type { UpdateState } from './update-types'

export type { UpdateState } from './update-types'

/** Repository delle release: la stessa di package.json. / EN: Releases repository: the same as package.json. */
const REPO = 'salvatorestracquadanio86/micelio-second-brain'
const FIRST_CHECK_MS = 30_000
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

type Listener = (state: UpdateState, previous: UpdateState) => void

/** Il modulo è un singleton, come autoUpdater. / EN: The module is a singleton, like autoUpdater. */
let state: UpdateState = { mode: 'off', auto: true, current: app.getVersion(), status: 'idle' }
const listeners: Listener[] = []
let feedUrl: string | null = null
let downloaded: { file: string, version: string } | null = null
let log: (m: string) => void = () => {}
let settingsFile = ''
/** Installazione già avviata: un secondo clic non la ripete. / EN: Install already started: a second click doesn't repeat it. */
let installing = false

function set (patch: Partial<UpdateState>): void {
  const previous = state
  state = { ...state, ...patch }
  for (const l of listeners) l(state, previous)
}

/** Stato corrente. / EN: Current state. */
export const updateState = (): UpdateState => state
/** Avvisa a ogni cambio di stato. / EN: Notifies on every state change. */
export const onUpdateState = (l: Listener): void => { listeners.push(l) }

/** In che modo questa installazione può aggiornarsi. / EN: How this installation can update itself. */
function detectMode (): Pick<UpdateState, 'mode' | 'notifyReason'> {
  if (!app.isPackaged || (process.platform !== 'win32' && process.platform !== 'linux')) return { mode: 'off' }
  // Su Linux senza APPIMAGE l'app viene dal .deb / EN: On Linux without APPIMAGE the app comes from the .deb
  if (process.platform === 'linux' && !process.env.APPIMAGE) return { mode: 'notify', notifyReason: 'deb' }
  if (UPDATE_PUBLIC_KEYS.length === 0) return { mode: 'notify', notifyReason: 'no-keys' }
  return { mode: 'install' }
}

/** Indirizzo da cui scaricare un file della release `version`. / EN: Address to download a file of release `version` from. */
function assetUrl (version: string, file: string): string {
  return feedUrl
    ? `${feedUrl.replace(/\/$/, '')}/${encodeURIComponent(file)}`
    : `https://github.com/${REPO}/releases/download/v${version}/${encodeURIComponent(file)}`
}

/**
 * Avvia gli aggiornamenti: legge la preferenza salvata, collega gli eventi di electron-updater e
 * programma i controlli. Da chiamare una volta, ad app pronta.
 *
 * EN: Starts updates: reads the saved preference, wires electron-updater's events and schedules
 * the checks. Call once, when the app is ready.
 */
export function startUpdates (logger: (m: string) => void): void {
  // Anche su file: nell'app installata la console non la vede nessuno, e "perché non si è
  // aggiornata?" deve avere una risposta. Sopra 1 MB il file riparte da zero.
  // EN: Also to a file: in the installed app nobody sees the console, and "why didn't it
  //     update?" needs an answer. Above 1 MB the file starts over.
  const logFile = path.join(app.getPath('logs'), 'updates.log')
  log = (m) => {
    logger(`aggiornamenti: ${m}`)
    try {
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1024 * 1024) fs.rmSync(logFile)
      fs.mkdirSync(path.dirname(logFile), { recursive: true })
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${m}\n`)
    } catch { /* il registro non deve fermare gli aggiornamenti / EN: the log must not stop updates */ }
  }
  settingsFile = path.join(app.getPath('userData'), 'micelio-updates.json')
  let auto = true
  try { auto = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).auto !== false } catch { /* prima volta / EN: first time */ }
  set({ ...detectMode(), auto })
  if (state.mode === 'off') return

  feedUrl = process.env.MICELIO_UPDATE_URL || null
  if (feedUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
    log(`fonte di prova: ${feedUrl}`)
  }
  // Scarica da solo solo se poi può installare; .deb e app senza chiavi si fermano all'avviso
  // EN: Downloads by itself only if it can then install; .deb and apps without keys stop at the notice
  autoUpdater.autoDownload = state.mode === 'install'
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  // Pubblichiamo installer completi, non il "web installer" che scarica il resto durante l'installazione
  // EN: We publish full installers, not the "web installer" that downloads the rest while installing
  autoUpdater.disableWebInstaller = true
  autoUpdater.logger = { info: (m) => log(String(m)), warn: (m) => log(`attenzione: ${String(m)}`), error: (m) => log(`errore: ${String(m)}`), debug: () => {} }

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: undefined, detail: undefined }))
  autoUpdater.on('update-not-available', () => set({ status: 'up-to-date', checkedAt: Date.now(), version: undefined, percent: undefined }))
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    const releaseUrl = `https://github.com/${REPO}/releases/tag/v${info.version}`
    set({ status: state.mode === 'install' ? 'downloading' : 'available', version: info.version, percent: 0, checkedAt: Date.now(), releaseUrl })
  })
  autoUpdater.on('download-progress', (p) => set({ percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (e: UpdateDownloadedEvent) => { void onDownloaded(e) })
  autoUpdater.on('error', (err: Error) => {
    // Un errore durante l'installazione già avviata lo segnala install(); qui i controlli e i download
    // EN: An error during an install already started is reported by install(); here checks and downloads
    if (state.status === 'ready') return
    const network = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|net::ERR_|getaddrinfo|socket hang up/i.test(err.message)
    set({ status: 'error', error: network ? 'network' : 'other', detail: err.message.split('\n')[0], checkedAt: Date.now() })
  })

  setTimeout(() => { if (state.auto) void checkNow() }, FIRST_CHECK_MS)
  setInterval(() => { if (state.auto) void checkNow() }, CHECK_EVERY_MS)
}

/** Controlla subito (pulsante «Controlla ora» o timer). / EN: Checks right away ("Check now" button or timer). */
export async function checkNow (): Promise<void> {
  if (state.mode === 'off') return
  // Un download in corso o un aggiornamento pronto non si riparte da capo
  // EN: A download in progress or a ready update isn't restarted from scratch
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // Già segnalato dall'evento 'error' / EN: Already reported by the 'error' event
  }
}

/** Attiva o spegne il controllo automatico (salvato in userData). / EN: Turns the automatic check on or off (saved in userData). */
export function setAutoUpdates (on: boolean): void {
  set({ auto: on })
  try { fs.writeFileSync(settingsFile, JSON.stringify({ auto: on })) } catch (err) { log(`preferenza non salvata: ${(err as Error).message}`) }
}

/** Scarica il `.sig` di un pacchetto (testo non fidato: lo controlla verifyUpdate). / EN: Downloads a package's `.sig` (untrusted text: verifyUpdate checks it). */
async function fetchSignature (version: string, file: string): Promise<string> {
  const res = await net.fetch(assetUrl(version, `${file}.sig`))
  if (!res.ok) throw new UpdateSignatureError('malformed', `signature not found (HTTP ${res.status})`)
  return await res.text()
}

/** Verifica la nostra firma del file scaricato. / EN: Verifies our signature of the downloaded file. */
async function verifyDownloaded (file: string, version: string): Promise<void> {
  const name = path.basename(file)
  await verifyUpdate(file, await fetchSignature(version, name), { file: name, version }, withIds(UPDATE_PUBLIC_KEYS))
}

async function onDownloaded (e: UpdateDownloadedEvent): Promise<void> {
  try {
    await verifyDownloaded(e.downloadedFile, e.version)
    downloaded = { file: e.downloadedFile, version: e.version }
    log(`${e.version} scaricata e firma verificata`)
    set({ status: 'ready', version: e.version, percent: 100 })
  } catch (err) {
    // Firma assente o sbagliata: il file non deve restare pronto per essere installato
    // EN: Missing or wrong signature: the file must not stay ready to be installed
    log(`firma NON valida per ${e.version}: ${(err as Error).message}. File cancellato.`)
    try { fs.rmSync(e.downloadedFile, { force: true }) } catch {}
    downloaded = null
    set({ status: 'error', error: 'signature', detail: (err as Error).message })
  }
}

/**
 * Installa l'aggiornamento pronto: verifica di nuovo la firma (il file è rimasto sul disco per
 * ore), ferma il daemon e lascia fare a electron-updater (installer silenzioso, poi l'app si riapre).
 *
 * EN: Installs the ready update: verifies the signature again (the file sat on disk for hours),
 * stops the daemon and lets electron-updater do the rest (silent installer, then the app reopens).
 * @param stopDaemon ferma il daemon in modo ordinato; su Windows lo fa anche l'installer, con
 *        l'AppImage no, e l'app nuova troverebbe ancora attivo il daemon vecchio
 *        EN: stops the daemon in an orderly way; on Windows the installer does it too, with the
 *        AppImage it doesn't, and the new app would find the old daemon still running
 */
export async function installUpdate (stopDaemon: () => Promise<void>): Promise<void> {
  if (state.status !== 'ready' || !downloaded || installing) return
  installing = true
  try {
    await verifyDownloaded(downloaded.file, downloaded.version)
  } catch (err) {
    try { fs.rmSync(downloaded.file, { force: true }) } catch {}
    downloaded = null
    installing = false
    set({ status: 'error', error: 'signature', detail: (err as Error).message })
    return
  }
  log(`installazione di ${downloaded.version}`)
  try {
    await stopDaemon()
  } catch (err) {
    log(`daemon non fermato: ${(err as Error).message}`)
  }
  try {
    // isSilent: niente finestre dell'installer; isForceRunAfter: riapre Micelio alla fine
    // EN: isSilent: no installer windows; isForceRunAfter: reopens Micelio at the end
    autoUpdater.quitAndInstall(true, true)
  } catch (err) {
    installing = false
    set({ status: 'error', error: 'install', detail: (err as Error).message })
  }
}
