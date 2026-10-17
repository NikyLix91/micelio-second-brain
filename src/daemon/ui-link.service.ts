/**
 * @file Link monouso per aprire la UI nel browser (decisione D14).
 *
 * Problema: la UI nel browser ha bisogno del token per chiamare l'API, ma non vogliamo che il
 * token compaia in un URL (resterebbe nella cronologia del browser).
 *
 * Soluzione:
 * 1. la CLI (`micelio ui`), che ha già il token, chiede al daemon un CODICE monouso;
 * 2. il browser apre http://127.0.0.1:7337/ui/?code=<codice>;
 * 3. la pagina scambia il codice con il token (POST /api/ui/exchange) e lo toglie dall'URL.
 * Il codice vale una sola volta e scade dopo 60 secondi: anche se resta nella cronologia, è inutile.
 *
 * L'app desktop (Electron) non usa questo meccanismo: legge il token direttamente da config.json.
 */
import { randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'

const CODE_TTL_MS = 60_000

@Injectable()
export class UiLinkService {
  /** Codici validi → scadenza. In memoria: un riavvio del daemon li invalida tutti, ed è giusto così. */
  private readonly codes = new Map<string, number>()

  /** Crea un nuovo codice monouso. */
  create (): string {
    this.purge()
    const code = randomBytes(16).toString('hex')
    this.codes.set(code, Date.now() + CODE_TTL_MS)
    return code
  }

  /** true se il codice è valido; in ogni caso lo consuma (monouso). */
  consume (code: string): boolean {
    const expires = this.codes.get(code)
    this.codes.delete(code)
    return expires !== undefined && expires > Date.now()
  }

  /** Rimuove i codici scaduti (chiamato a ogni creazione: la mappa resta piccola). */
  private purge (): void {
    const now = Date.now()
    for (const [code, expires] of this.codes) if (expires <= now) this.codes.delete(code)
  }
}
