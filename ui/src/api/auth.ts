/**
 * @file Come la UI ottiene il token dell'API locale (decisione D14).
 *
 * Tre fonti, in ordine:
 * 1. **App desktop**: il preload di Electron espone `window.micelio.token` (letto da config.json);
 * 2. **Link monouso** (`micelio ui`): l'URL contiene `?code=…`; lo scambiamo con il token tramite
 *    POST /api/ui/exchange e togliamo subito il codice dall'URL;
 * 3. **Sessione già aperta**: il token salvato in sessionStorage (sopravvive al ricaricamento
 *    della pagina, sparisce chiudendo la scheda).
 *
 * Il token non viene mai messo in un URL né in localStorage (persistente).
 *
 * EN: How the UI gets the local API token (decision D14).
 *
 * EN: Three sources, in order:
 * 1. **Desktop app**: the Electron preload exposes `window.micelio.token` (read from config.json);
 * 2. **One-time link** (`micelio ui`): the URL contains `?code=…`; we exchange it for the token via
 *    POST /api/ui/exchange and remove the code from the URL right away;
 * 3. **Session already open**: the token saved in sessionStorage (survives a page reload,
 *    disappears when the tab is closed).
 *
 * EN: The token is never put in a URL or in localStorage (persistent).
 */

import { detectLang } from '../i18n'

const STORAGE_KEY = 'micelio.token'

let token: string | null = null

/** Token corrente, se già ottenuto. / EN: Current token, if already obtained. */
export function getToken (): string | null {
  return token
}

/**
 * Determina il token all'avvio della UI.
 *
 * EN: Determines the token when the UI starts.
 * @returns il token, oppure null se la pagina è stata aperta senza un modo per autenticarsi
 *          EN: the token, or null if the page was opened without a way to authenticate
 * @throws Error se il link monouso è scaduto o già usato
 *         EN: Error if the one-time link has expired or was already used
 */
export async function initAuth (): Promise<string | null> {
  // 1. App desktop
  // EN: 1. Desktop app
  if (window.micelio?.token) {
    token = window.micelio.token
    return token
  }

  // 2. Link monouso nella query string
  // EN: 2. One-time link in the query string
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  if (code) {
    // Togliamo il codice dall'URL PRIMA della chiamata: anche se fallisce, non deve restare visibile.
    // EN: We remove the code from the URL BEFORE the call: even if it fails, it must not stay visible.
    url.searchParams.delete('code')
    window.history.replaceState(null, '', url.toString())
    const res = await fetch('/api/ui/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code })
    })
    // Siamo prima del provider della lingua: si usa quella salvata o del sistema.
    // EN: We are before the language provider: use the saved language or the system one.
    if (!res.ok) throw new Error(detectLang() === 'it' ? 'Link scaduto o già usato: esegui di nuovo `micelio ui`.' : 'Link expired or already used: run `micelio ui` again.')
    token = ((await res.json()) as { token: string }).token
    sessionStorage.setItem(STORAGE_KEY, token)
    return token
  }

  // 3. Sessione già aperta in questa scheda
  // EN: 3. Session already open in this tab
  token = sessionStorage.getItem(STORAGE_KEY)
  return token
}

/** Usato dai test per impostare un token finto. / EN: Used by tests to set a fake token. */
export function setTokenForTests (t: string | null): void {
  token = t
}
