/**
 * @file Team della richiesta in corso (B3).
 *
 * Con più team ogni richiesta all'API dice su quale team lavora, con l'intestazione
 * `x-micelio-team: <id o nome>` (la UI la manda sempre, la CLI con `--team`). Senza intestazione
 * si usa il team predefinito: così CLI, script e integrazioni scritti prima di B3 funzionano
 * come prima.
 *
 * Perché AsyncLocalStorage e non un parametro in ogni rotta: le rotte sono decine e tutte
 * chiamano `this.node`. Il middleware mette il team nel "contesto asincrono" della richiesta e
 * il getter `node` dei controller lo legge: le rotte restano identiche.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { NextFunction, Request, Response } from 'express'

/** Nome dell'intestazione HTTP con il team (id locale o nome). */
export const TEAM_HEADER = 'x-micelio-team'

/** Team indicato dalla richiesta in corso (undefined = predefinito). */
export const teamContext = new AsyncLocalStorage<string | undefined>()

/** Middleware Express: legge l'intestazione e fa proseguire la richiesta in quel contesto. */
export function teamMiddleware (req: Request, _res: Response, next: NextFunction): void {
  const raw = req.headers[TEAM_HEADER]
  const team = (Array.isArray(raw) ? raw[0] : raw)?.trim() || undefined
  teamContext.run(team, () => next())
}
