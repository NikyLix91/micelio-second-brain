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
 */

import { detectLang } from '../i18n'

const STORAGE_KEY = 'micelio.token'

let token: string | null = null

/** Token corrente, se già ottenuto. */
export function getToken (): string | null {
  return token
}

/**
 * Determina il token all'avvio della UI.
 * @returns il token, oppure null se la pagina è stata aperta senza un modo per autenticarsi
 * @throws Error se il link monouso è scaduto o già usato
 */
export async function initAuth (): Promise<string | null> {
  // 1. App desktop
  if (window.micelio?.token) {
    token = window.micelio.token
    return token
  }

  // 2. Link monouso nella query string
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  if (code) {
    // Togliamo il codice dall'URL PRIMA della chiamata: anche se fallisce, non deve restare visibile.
    url.searchParams.delete('code')
    window.history.replaceState(null, '', url.toString())
    const res = await fetch('/api/ui/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code })
    })
    // Siamo prima del provider della lingua: si usa quella salvata o del sistema.
    if (!res.ok) throw new Error(detectLang() === 'it' ? 'Link scaduto o già usato: esegui di nuovo `micelio ui`.' : 'Link expired or already used: run `micelio ui` again.')
    token = ((await res.json()) as { token: string }).token
    sessionStorage.setItem(STORAGE_KEY, token)
    return token
  }

  // 3. Sessione già aperta in questa scheda
  token = sessionStorage.getItem(STORAGE_KEY)
  return token
}

/** Usato dai test per impostare un token finto. */
export function setTokenForTests (t: string | null): void {
  token = t
}
