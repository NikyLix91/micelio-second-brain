/**
 * @file Testi dell'app desktop (processo principale): menu dell'area di notifica, notifiche,
 * finestre di dialogo. Nelle due lingue dell'interfaccia (italiano, inglese).
 *
 * EN: Texts for the desktop app (main process): tray menu, notifications,
 * dialogs. In both interface languages (Italian, English).
 *
 * LINGUA. All'avvio si usa quella del sistema (`app.getLocale()`); poi la decide l'utente nella UI:
 * l'interfaccia la comunica al processo principale tramite il preload (`window.micelio.setLang`)
 * quando parte e a ogni cambio, e menu e notifiche si aggiornano subito.
 *
 * EN: LANGUAGE. At startup we use the system one (`app.getLocale()`); then the user picks it in the UI:
 * the interface passes it to the main process through the preload (`window.micelio.setLang`)
 * when it starts and on every change, and the menu and notifications update right away.
 */
export type Lang = 'it' | 'en'

let current: Lang = 'it'
export const desktopLang = (): Lang => current
export function setDesktopLang (l: Lang): void { current = l }
/** Lingua iniziale dal locale del sistema (es. "it-IT" → it). / EN: Initial language from the system locale (e.g. "it-IT" → it). */
export const langFromLocale = (locale: string): Lang => (locale.toLowerCase().startsWith('it') ? 'it' : 'en')

const STRINGS = {
  it: {
    trayOpen: 'Apri Micelio',
    trayInbox: 'Inbox',
    trayBrowser: 'Apri nel browser',
    trayQuit: 'Esci (il nodo resta attivo)',
    pickFolder: 'Scegli la cartella del progetto',
    inboxTitle: 'Micelio · da verificare',
    inboxBody: (n: number) => (n === 1 ? 'Un nuovo ricordo attende la tua decisione.' : `${n} nuovi ricordi attendono la tua decisione.`),
    isolatedTitle: 'Micelio · nodo isolato',
    isolatedBody: 'Da più di 10 minuti nessun collega è raggiungibile: il sapere non si sta sincronizzando.',
    budgetTitle: 'Micelio · budget quasi esaurito',
    budgetBody: (used: number, limit: number) => `Oggi ${used} chiamate su ${limit}. Oltre il limite il lavoro aspetta domani.`,
    usefulTitle: 'Micelio · ricordo utile 👍',
    usefulBody: (title: string) => `L'agente ha usato «${title}». Pollice in su dato in automatico.`,
    wrongTitle: 'Micelio · ricordo forse sbagliato',
    wrongBody: (title: string, reason: string | null) => `«${title}»${reason ? `: ${reason}` : ''}. Aprilo in Efficacia e decidi.`,
    digestTitle: 'Micelio · la settimana del team',
    digestBody: (added: number, gaps: number) => `${added === 1 ? 'Un ricordo nuovo' : `${added} ricordi nuovi`}${gaps ? `, ${gaps === 1 ? 'una lacuna aperta' : `${gaps} lacune aperte`}` : ''}. Apri il riepilogo.`
  },
  en: {
    trayOpen: 'Open Micelio',
    trayInbox: 'Inbox',
    trayBrowser: 'Open in the browser',
    trayQuit: 'Quit (the node keeps running)',
    pickFolder: 'Choose the project folder',
    inboxTitle: 'Micelio · to check',
    inboxBody: (n: number) => (n === 1 ? 'A new memory is waiting for your decision.' : `${n} new memories are waiting for your decision.`),
    isolatedTitle: 'Micelio · isolated node',
    isolatedBody: 'No colleague has been reachable for more than 10 minutes: knowledge is not being synchronised.',
    budgetTitle: 'Micelio · budget almost used up',
    budgetBody: (used: number, limit: number) => `Today ${used} calls out of ${limit}. Beyond the limit work waits for tomorrow.`,
    usefulTitle: 'Micelio · useful memory 👍',
    usefulBody: (title: string) => `The agent used "${title}". Thumbs up given automatically.`,
    wrongTitle: 'Micelio · memory possibly wrong',
    wrongBody: (title: string, reason: string | null) => `"${title}"${reason ? `: ${reason}` : ''}. Open it in Efficacy and decide.`,
    digestTitle: 'Micelio · the team\'s week',
    digestBody: (added: number, gaps: number) => `${added === 1 ? 'One new memory' : `${added} new memories`}${gaps ? `, ${gaps === 1 ? 'one open gap' : `${gaps} open gaps`}` : ''}. Open the digest.`
  }
}

/** I testi nella lingua corrente. / EN: The texts in the current language. */
export const t = (): typeof STRINGS.it => STRINGS[current]
