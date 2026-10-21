/**
 * @file Link monouso per aprire la UI nel browser (decisione D14).
 *
 * EN: One-time link to open the UI in the browser (decision D14).
 *
 * Problema: la UI nel browser ha bisogno del token per chiamare l'API, ma non vogliamo che il
 * token compaia in un URL (resterebbe nella cronologia del browser).
 *
 * EN: Problem: the UI in the browser needs the token to call the API, but we do not want the
 * token to show up in a URL (it would stay in the browser history).
 *
 * Soluzione:
 * 1. la CLI (`micelio ui`), che ha già il token, chiede al daemon un CODICE monouso;
 * 2. il browser apre http://127.0.0.1:7337/ui/?code=<codice>;
 * 3. la pagina scambia il codice con il token (POST /api/ui/exchange) e lo toglie dall'URL.
 * Il codice vale una sola volta e scade dopo 60 secondi: anche se resta nella cronologia, è inutile.
 *
 * EN: Solution:
 * 1. the CLI (`micelio ui`), which already has the token, asks the daemon for a one-time CODE;
 * 2. the browser opens http://127.0.0.1:7337/ui/?code=<codice>;
 * 3. the page exchanges the code for the token (POST /api/ui/exchange) and removes it from the URL.
 * The code works only once and expires after 60 seconds: even if it stays in the history, it is useless.
 *
 * L'app desktop (Electron) non usa questo meccanismo: legge il token direttamente da config.json.
 *
 * EN: The desktop app (Electron) does not use this mechanism: it reads the token directly from config.json.
 */
import { randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'

const CODE_TTL_MS = 60_000

@Injectable()
export class UiLinkService {
  /** Codici validi → scadenza. In memoria: un riavvio del daemon li invalida tutti, ed è giusto così. / EN: Valid codes → expiry. In memory: a daemon restart invalidates them all, and that is intended. */
  private readonly codes = new Map<string, number>()

  /** Crea un nuovo codice monouso. / EN: Creates a new one-time code. */
  create (): string {
    this.purge()
    const code = randomBytes(16).toString('hex')
    this.codes.set(code, Date.now() + CODE_TTL_MS)
    return code
  }

  /** true se il codice è valido; in ogni caso lo consuma (monouso). / EN: true if the code is valid; consumes it in any case (one-time). */
  consume (code: string): boolean {
    const expires = this.codes.get(code)
    this.codes.delete(code)
    return expires !== undefined && expires > Date.now()
  }

  /** Rimuove i codici scaduti (chiamato a ogni creazione: la mappa resta piccola). / EN: Removes expired codes (called on every create, so the map stays small). */
  private purge (): void {
    const now = Date.now()
    for (const [code, expires] of this.codes) if (expires <= now) this.codes.delete(code)
  }
}
