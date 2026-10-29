/**
 * @file Colore di ogni team, per riconoscere a colpo d'occhio su quale team si sta lavorando.
 *
 * EN: Color of each team, to recognize at a glance which team you are working on.
 *
 * È una preferenza PERSONALE, come la scelta del team (vedi api/team.ts): si ricorda nel browser
 * (localStorage) e non arriva al daemon né ai colleghi. I colori vengono da una tavolozza fissa
 * (le tinte, chiare e scure, sono in styles.css come `--team-<colore>`): ogni team ne riceve uno
 * diverso in automatico, il predefinito tiene il verde di Micelio, e si cambia nella pagina Team.
 *
 * EN: It is a PERSONAL preference, like the team choice (see api/team.ts): it is remembered in the
 * browser (localStorage) and reaches neither the daemon nor colleagues. Colors come from a fixed
 * palette (the light and dark shades are in styles.css as `--team-<color>`): each team gets a
 * different one automatically, the default keeps Micelio green, and it is changed in the Team page.
 *
 * L'app si colora solo con più di un team: con uno solo non c'è niente da distinguere e resta
 * com'è sempre stata. Il colore va sull'elemento radice come `data-team-color`.
 *
 * EN: The app is colored only with more than one team: with just one there is nothing to tell
 * apart and it stays as it always was. The color goes on the root element as `data-team-color`.
 */
import { useEffect, useSyncExternalStore } from 'react'

/** La tavolozza, nell'ordine in cui si assegna. / EN: The palette, in assignment order. */
export const TEAM_COLORS = ['green', 'blue', 'violet', 'orange', 'raspberry', 'teal', 'ochre', 'slate'] as const
export type TeamColor = typeof TEAM_COLORS[number]
/** Id del team → colore. / EN: Team id → color. */
export type TeamColorMap = Record<string, TeamColor>

const STORAGE_KEY = 'micelio.teamColors'
const isColor = (c: unknown): c is TeamColor => (TEAM_COLORS as readonly unknown[]).includes(c)

/**
 * Colori di tutti i team: tiene quelli già scelti, toglie quelli dei team non più presenti e
 * assegna ai nuovi il primo colore libero (il predefinito prova prima il verde). Finita la
 * tavolozza, i colori si ripetono.
 *
 * EN: Colors of all teams: keeps the ones already chosen, drops those of teams no longer present
 * and gives new ones the first free color (the default tries green first). Once the palette runs
 * out, colors repeat.
 */
export function assignColors (teams: ReadonlyArray<{ id: string, isDefault: boolean }>, stored: TeamColorMap): TeamColorMap {
  const out: TeamColorMap = {}
  for (const t of teams) if (isColor(stored[t.id])) out[t.id] = stored[t.id]
  const missing = teams.filter((t) => !(t.id in out)).sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
  for (const t of missing) {
    const used = new Set(Object.values(out))
    const free = TEAM_COLORS.filter((c) => !used.has(c))
    out[t.id] = free[0] ?? TEAM_COLORS[Object.keys(out).length % TEAM_COLORS.length]
  }
  return out
}

/** Lettura protetta: localStorage può mancare o contenere altro. / EN: Guarded read: localStorage may be missing or hold something else. */
function readStored (): TeamColorMap {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

let stored: TeamColorMap = readStored()
const listeners = new Set<() => void>()

function save (next: TeamColorMap): void {
  stored = next
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
  for (const l of listeners) l()
}

/** Sceglie il colore di un team e avvisa i componenti che lo seguono. / EN: Picks a team's color and notifies the components that follow it. */
export function setTeamColor (id: string, color: TeamColor): void {
  if (stored[id] !== color) save({ ...stored, [id]: color })
}

/**
 * Hook React: il colore di ogni team dell'elenco, aggiornato quando cambia. Se servono colori
 * nuovi (o se ne liberano) li salva; con l'elenco vuoto (non ancora arrivato) non tocca niente.
 *
 * EN: React hook: the color of every team in the list, updated when it changes. If new colors are
 * needed (or some are freed) it saves them; with an empty list (not arrived yet) it touches nothing.
 */
export function useTeamColors (teams: ReadonlyArray<{ id: string, isDefault: boolean }>): TeamColorMap {
  const current = useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => stored)
  const colors = assignColors(teams, current)
  const changed = teams.length > 0 && JSON.stringify(colors) !== JSON.stringify(current)
  useEffect(() => { if (changed) save(colors) }, [changed, colors])
  return colors
}

/** Colora l'app con il colore dato (null = aspetto normale). / EN: Colors the app with the given color (null = normal look). */
export function useTeamTheme (color: TeamColor | null): void {
  useEffect(() => {
    const root = document.documentElement
    if (color) root.dataset.teamColor = color
    else delete root.dataset.teamColor
    return () => { delete root.dataset.teamColor }
  }, [color])
}
