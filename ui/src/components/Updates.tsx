/**
 * @file Scheda «Aggiornamenti» delle Impostazioni (B13 fase 4): versione installata, stato del
 * controllo, «Controlla ora», «Riavvia e aggiorna» e il controllo automatico sì/no.
 *
 * EN: «Updates» card in Settings (B13 phase 4): installed version, check state, "Check now",
 * "Restart and update" and the automatic check on/off.
 *
 * Gli aggiornamenti li fa l'app desktop (desktop/src/updater.ts), non il daemon: la scheda parla
 * con il processo principale tramite `window.micelio.updates` e nel browser non compare.
 *
 * EN: Updates are done by the desktop app (desktop/src/updater.ts), not by the daemon: the card
 * talks to the main process through `window.micelio.updates` and doesn't appear in the browser.
 */
import { useEffect, useState } from 'react'
import { Card, Meter } from './ui'
import { defineStrings, useStrings } from '../i18n'
import { dateTime } from '../format'

const S = defineStrings({
  it: {
    title: 'Aggiornamenti',
    installed: (v: string) => `Versione installata: ${v}`,
    checking: 'Controllo in corso…',
    upToDate: 'Micelio è aggiornata.',
    downloading: (v: string) => `Download di Micelio ${v}…`,
    ready: (v: string) => `Micelio ${v} è scaricata e la firma è verificata. Riavvia per installarla: Micelio si chiude, l'installazione va avanti senza finestre per qualche minuto e poi Micelio si riapre da sola, con la versione nuova. I dati restano dove sono.`,
    available: (v: string) => `È disponibile Micelio ${v}.`,
    notifyDeb: 'Con il pacchetto .deb l\'aggiornamento lo installa il gestore dei pacchetti: scarica il .deb nuovo dalla pagina della versione.',
    notifyNoKeys: 'Questa versione non sa verificare gli aggiornamenti: scarica e installa a mano quella nuova dalla pagina della versione.',
    lastCheck: (when: string) => `Ultimo controllo: ${when}`,
    neverChecked: 'Nessun controllo ancora: il primo parte 30 secondi dopo l\'avvio.',
    errNetwork: 'Non riesco a raggiungere GitHub: niente rete, o un proxy che blocca. Riprovo fra 4 ore.',
    errSignature: 'L\'aggiornamento scaricato non ha una firma valida: l\'ho cancellato e non l\'ho installato. Se succede di nuovo, segnalalo.',
    errInstall: 'L\'installazione non è partita.',
    errOther: 'Il controllo non è riuscito.',
    detail: 'Dettaglio tecnico',
    check: 'Controlla ora',
    install: 'Riavvia e aggiorna',
    openRelease: 'Pagina della versione',
    auto: 'Controlla gli aggiornamenti da solo (all\'avvio e ogni 4 ore)',
    autoOff: 'Controllo automatico spento: usa «Controlla ora».'
  },
  en: {
    title: 'Updates',
    installed: (v: string) => `Installed version: ${v}`,
    checking: 'Checking…',
    upToDate: 'Micelio is up to date.',
    downloading: (v: string) => `Downloading Micelio ${v}…`,
    ready: (v: string) => `Micelio ${v} is downloaded and its signature is verified. Restart to install it: Micelio closes, the installation runs without windows for a few minutes and then Micelio reopens by itself, with the new version. Your data stays where it is.`,
    available: (v: string) => `Micelio ${v} is available.`,
    notifyDeb: 'With the .deb package the update is installed by the package manager: download the new .deb from the version page.',
    notifyNoKeys: "This version can't verify updates: download and install the new one by hand from the version page.",
    lastCheck: (when: string) => `Last check: ${when}`,
    neverChecked: 'No check yet: the first one starts 30 seconds after launch.',
    errNetwork: "I can't reach GitHub: no network, or a proxy blocking it. I'll try again in 4 hours.",
    errSignature: "The downloaded update doesn't have a valid signature: I deleted it and didn't install it. If it happens again, please report it.",
    errInstall: "The installation didn't start.",
    errOther: 'The check failed.',
    detail: 'Technical detail',
    check: 'Check now',
    install: 'Restart and update',
    openRelease: 'Version page',
    auto: 'Check for updates by itself (at launch and every 4 hours)',
    autoOff: 'Automatic check off: use "Check now".'
  }
})

/** Lo stato dell'app desktop, seguito in tempo reale; null nel browser. / EN: The desktop app's state, followed live; null in the browser. */
function useUpdateState (): DesktopUpdateState | null {
  const [state, setState] = useState<DesktopUpdateState | null>(null)
  useEffect(() => {
    const u = window.micelio?.updates
    if (!u) return
    void u.state().then(setState)
    return u.onChange(setState)
  }, [])
  return state
}

export function UpdatesCard () {
  const t = useStrings(S)
  const u = useUpdateState()
  const bridge = window.micelio?.updates
  // Nel browser, o con l'app avviata dai sorgenti, non c'è niente da aggiornare da qui
  // EN: In the browser, or with the app started from source, there's nothing to update from here
  if (!bridge || !u || u.mode === 'off') return null
  const busy = u.status === 'checking' || u.status === 'downloading'
  const error = { network: t.errNetwork, signature: t.errSignature, install: t.errInstall, other: t.errOther }
  return (
    <Card help='updates' title={t.title}>
      <p style={{ marginTop: 0 }}><strong>{t.installed(u.current)}</strong></p>
      {u.status === 'checking' && <p className='muted'>{t.checking}</p>}
      {u.status === 'up-to-date' && <p>{t.upToDate}</p>}
      {u.status === 'downloading' && u.version && (
        <>
          <p>{t.downloading(u.version)} {u.percent ?? 0}%</p>
          <Meter value={u.percent ?? 0} max={100} />
        </>
      )}
      {u.status === 'ready' && u.version && <div className='notice ok' style={{ marginBottom: 10 }}>{t.ready(u.version)}</div>}
      {u.status === 'available' && u.version && (
        <div className='notice warn' style={{ marginBottom: 10 }}>
          {t.available(u.version)} {u.notifyReason === 'deb' ? t.notifyDeb : u.notifyReason === 'no-keys' ? t.notifyNoKeys : null}
        </div>
      )}
      {u.status === 'error' && u.error && (
        <div className='notice warn' style={{ marginBottom: 10 }}>
          {error[u.error]}
          {u.detail && <details style={{ marginTop: 6 }}><summary>{t.detail}</summary><code>{u.detail}</code></details>}
        </div>
      )}
      <div className='row'>
        {u.status === 'ready'
          ? <button className='btn primary' onClick={() => void bridge.install()}>{t.install}</button>
          : <button className='btn' disabled={busy} onClick={() => void bridge.check()}>{t.check}</button>}
        {u.releaseUrl && u.version && <a href={u.releaseUrl} target='_blank' rel='noreferrer'>{t.openRelease}</a>}
      </div>
      <label className='row' style={{ marginTop: 10 }}>
        <input type='checkbox' style={{ width: 'auto' }} checked={u.auto} onChange={(e) => void bridge.setAuto(e.target.checked)} /> {t.auto}
      </label>
      <p className='muted' style={{ marginBottom: 0 }}>
        {!u.auto ? t.autoOff : u.checkedAt ? t.lastCheck(dateTime(u.checkedAt)) : t.neverChecked}
      </p>
    </Card>
  )
}
