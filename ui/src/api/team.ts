/**
 * @file Team su cui lavora l'interfaccia (B3: più team sullo stesso PC).
 *
 * EN: The team the interface works on (B3: several teams on the same PC).
 *
 * Ogni chiamata all'API e lo stream degli eventi portano l'intestazione `x-micelio-team` con
 * l'id del team scelto nel selettore della barra laterale; senza scelta (null) il daemon usa il
 * team predefinito. La scelta è PERSONALE e di questa finestra: si ricorda nel browser
 * (localStorage), non cambia il predefinito del PC, che vale per CLI e agenti.
 *
 * EN: Every API call and the event stream carry the `x-micelio-team` header with the id of the
 * team chosen in the sidebar selector; with no choice (null) the daemon uses the default team.
 * The choice is PERSONAL and belongs to this window: it is remembered in the browser
 * (localStorage) and does not change the PC default, which applies to the CLI and agents.
 *
 * È uno "store" minimo fuori da React (come la lingua in src/i18n), perché lo leggono anche
 * funzioni non React come `call()`; i componenti lo seguono con `useCurrentTeam`.
 *
 * EN: It is a minimal "store" outside React (like the language in src/i18n), because non-React
 * functions such as `call()` read it too; components follow it with `useCurrentTeam`.
 */
import { useSyncExternalStore } from 'react'

/** Intestazione HTTP con il team (vedi src/daemon/team-context.ts). / EN: HTTP header carrying the team (see src/daemon/team-context.ts). */
export const TEAM_HEADER = 'x-micelio-team'
const STORAGE_KEY = 'micelio.team'

/** Lettura protetta: in alcune modalità del browser localStorage non è disponibile. / EN: Guarded read: in some browser modes localStorage is not available. */
function readStored (): string | null {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

let current: string | null = readStored()
const listeners = new Set<() => void>()

/** Id del team scelto, o null = predefinito del PC. / EN: Id of the chosen team, or null = PC default. */
export function currentTeam (): string | null {
  return current
}

/** Sceglie il team (null = torna al predefinito) e avvisa i componenti che lo seguono. / EN: Picks the team (null = back to the default) and notifies the components that follow it. */
export function setCurrentTeam (id: string | null): void {
  if (id === current) return
  current = id
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {}
  for (const l of listeners) l()
}

/** Intestazioni da aggiungere alle richieste (nessuna se si usa il predefinito). / EN: Headers to add to requests (none when using the default). */
export function teamHeaders (): Record<string, string> {
  return current ? { [TEAM_HEADER]: current } : {}
}

/** Hook React: il team scelto, aggiornato quando cambia. / EN: React hook: the chosen team, updated when it changes. */
export function useCurrentTeam (): string | null {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb) } }, currentTeam)
}
