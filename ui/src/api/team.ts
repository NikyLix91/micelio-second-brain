/**
 * @file Team su cui lavora l'interfaccia (B3: più team sullo stesso PC).
 *
 * Ogni chiamata all'API e lo stream degli eventi portano l'intestazione `x-micelio-team` con
 * l'id del team scelto nel selettore della barra laterale; senza scelta (null) il daemon usa il
 * team predefinito. La scelta è PERSONALE e di questa finestra: si ricorda nel browser
 * (localStorage), non cambia il predefinito del PC, che vale per CLI e agenti.
 *
 * È uno "store" minimo fuori da React (come la lingua in src/i18n), perché lo leggono anche
 * funzioni non React come `call()`; i componenti lo seguono con `useCurrentTeam`.
 */
import { useSyncExternalStore } from 'react'

/** Intestazione HTTP con il team (vedi src/daemon/team-context.ts). */
export const TEAM_HEADER = 'x-micelio-team'
const STORAGE_KEY = 'micelio.team'

/** Lettura protetta: in alcune modalità del browser localStorage non è disponibile. */
function readStored (): string | null {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

let current: string | null = readStored()
const listeners = new Set<() => void>()

/** Id del team scelto, o null = predefinito del PC. */
export function currentTeam (): string | null {
  return current
}

/** Sceglie il team (null = torna al predefinito) e avvisa i componenti che lo seguono. */
export function setCurrentTeam (id: string | null): void {
  if (id === current) return
  current = id
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {}
  for (const l of listeners) l()
}

/** Intestazioni da aggiungere alle richieste (nessuna se si usa il predefinito). */
export function teamHeaders (): Record<string, string> {
  return current ? { [TEAM_HEADER]: current } : {}
}

/** Hook React: il team scelto, aggiornato quando cambia. */
export function useCurrentTeam (): string | null {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb) } }, currentTeam)
}
