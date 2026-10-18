/**
 * @file Errori con il messaggio nelle due lingue dell'interfaccia.
 *
 * I messaggi pensati per l'utente (es. "Operazione riservata agli admin del team") nascono in
 * italiano, con la traduzione inglese accanto. Il filtro degli errori del daemon
 * (src/daemon/error.filter.ts) sceglie la lingua in base all'intestazione `x-micelio-lang` che
 * la UI invia con ogni richiesta; CLI e MCP ricevono l'italiano (il `message` dell'errore).
 */
export class LocalizedError extends Error {
  /**
   * @param message testo italiano (anche il `message` standard dell'errore)
   * @param en      lo stesso testo in inglese
   */
  constructor (message: string, readonly en?: string) {
    super(message)
  }

  /** Il messaggio nella lingua richiesta (italiano se manca la traduzione). */
  in (lang: string | undefined): string {
    return lang === 'en' && this.en ? this.en : this.message
  }
}
