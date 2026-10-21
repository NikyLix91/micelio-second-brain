/**
 * @file Team della richiesta in corso (B3).
 *
 * EN: Team of the current request (B3).
 *
 * Con più team ogni richiesta all'API dice su quale team lavora, con l'intestazione
 * `x-micelio-team: <id o nome>` (la UI la manda sempre, la CLI con `--team`). Senza intestazione
 * si usa il team predefinito: così CLI, script e integrazioni scritti prima di B3 funzionano
 * come prima.
 *
 * EN: With several teams, every API request says which team it works on, through the
 * `x-micelio-team: <id o nome>` header (the UI always sends it, the CLI with `--team`). Without the
 * header the default team is used, so CLI, scripts and integrations written before B3 keep
 * working as before.
 *
 * Perché AsyncLocalStorage e non un parametro in ogni rotta: le rotte sono decine e tutte
 * chiamano `this.node`. Il middleware mette il team nel "contesto asincrono" della richiesta e
 * il getter `node` dei controller lo legge: le rotte restano identiche.
 *
 * EN: Why AsyncLocalStorage and not a parameter on every route: there are dozens of routes and they
 * all call `this.node`. The middleware puts the team in the request's "async context" and the
 * controllers' `node` getter reads it, so the routes stay unchanged.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { NextFunction, Request, Response } from 'express'

/** Nome dell'intestazione HTTP con il team (id locale o nome). / EN: Name of the HTTP header carrying the team (local id or name). */
export const TEAM_HEADER = 'x-micelio-team'

/** Team indicato dalla richiesta in corso (undefined = predefinito). / EN: Team named by the current request (undefined = default). */
export const teamContext = new AsyncLocalStorage<string | undefined>()

/** Middleware Express: legge l'intestazione e fa proseguire la richiesta in quel contesto. / EN: Express middleware: reads the header and runs the rest of the request in that context. */
export function teamMiddleware (req: Request, _res: Response, next: NextFunction): void {
  const raw = req.headers[TEAM_HEADER]
  const team = (Array.isArray(raw) ? raw[0] : raw)?.trim() || undefined
  teamContext.run(team, () => next())
}
