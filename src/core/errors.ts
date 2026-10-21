/**
 * @file Errori con il messaggio nelle due lingue dell'interfaccia.
 *
 * EN: Errors with the message in both interface languages.
 *
 * I messaggi pensati per l'utente (es. "Operazione riservata agli admin del team") nascono in
 * italiano, con la traduzione inglese accanto. Il filtro degli errori del daemon
 * (src/daemon/error.filter.ts) sceglie la lingua in base all'intestazione `x-micelio-lang` che
 * la UI invia con ogni richiesta; CLI e MCP ricevono l'italiano (il `message` dell'errore).
 *
 * EN: User-facing messages (e.g. "Operazione riservata agli admin del team") are written in
 * Italian, with the English translation next to them. The daemon error filter
 * (src/daemon/error.filter.ts) picks the language from the `x-micelio-lang` header that the UI
 * sends with every request; the CLI and MCP get the Italian text (the error `message`).
 */
export class LocalizedError extends Error {
  /**
   * @param message testo italiano (anche il `message` standard dell'errore)
   *        EN: Italian text (also the error's standard `message`)
   * @param en      lo stesso testo in inglese
   *        EN: the same text in English
   */
  constructor (message: string, readonly en?: string) {
    super(message)
  }

  /** Il messaggio nella lingua richiesta (italiano se manca la traduzione). / EN: The message in the requested language (Italian if the translation is missing). */
  in (lang: string | undefined): string {
    return lang === 'en' && this.en ? this.en : this.message
  }
}
