/**
 * @file Il daemon dimostra di essere quello dell'utente, prima che un client gli mandi il token.
 *
 * EN: The daemon proves it is the user's own, before a client sends it the token.
 *
 * Revisione di sicurezza 2026-10-26: CLI, hook, shim MCP e app desktop mandavano il token a
 * chiunque rispondesse su 127.0.0.1:<porta>. Su un PC con più utenti, un altro utente poteva
 * occupare la porta per primo (per esempio a daemon spento) e ricevere il token, i ricordi salvati
 * e le sessioni. Ora il client manda un numero casuale e il daemon risponde con un HMAC calcolato
 * con il token: solo chi conosce il token sa calcolarlo, e il token non viaggia. Se la prova non
 * torna, il client non manda niente.
 *
 * EN: Security review 2026-10-26: CLI, hooks, MCP shim and desktop app sent the token to whatever
 * answered on 127.0.0.1:<port>. On a PC with several users, another user could occupy the port
 * first (for example while the daemon was off) and receive the token, the saved memories and the
 * sessions. Now the client sends a random number and the daemon answers with an HMAC computed with
 * the token: only whoever knows the token can compute it, and the token doesn't travel. If the
 * proof doesn't match, the client sends nothing.
 *
 * Un impostore non può nemmeno girare la domanda al daemon vero: se il daemon vero è acceso la
 * porta è sua, e l'impostore non può ascoltarci.
 *
 * EN: An impostor can't even forward the question to the real daemon: if the real daemon is on,
 * the port is its own, and the impostor can't listen on it.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** Rotta pubblica della prova. / EN: Public route of the proof. */
export const PROOF_ROUTE = '/api/hello'

/** Numero casuale del client: da 32 a 64 cifre esadecimali. / EN: The client's random number: 32 to 64 hex digits. */
export const NONCE_RE = /^[0-9a-f]{32,64}$/

/**
 * La prova: HMAC-SHA256 del numero casuale, con il token come chiave. Il prefisso la lega a questo
 * uso, così non vale per nient'altro.
 *
 * EN: The proof: HMAC-SHA256 of the random number, keyed with the token. The prefix ties it to this
 * use, so it's worth nothing elsewhere.
 */
export function daemonProof (token: string, nonce: string): string {
  return createHmac('sha256', token).update(`micelio-daemon/v1\n${nonce}`).digest('hex')
}

/** Risultati già verificati in questo processo, per indirizzo. / EN: Results already checked in this process, by address. */
const verified = new Map<string, Promise<boolean>>()

/**
 * true se su `baseUrl` risponde il daemon che conosce `token`. Il risultato positivo resta valido
 * per tutta la vita del processo (una CLI o un hook vivono pochi secondi); uno negativo no, così
 * un daemon che riparte viene riconosciuto. I processi che vivono a lungo (shim MCP, notifiche
 * dell'app) chiedono una prova nuova a ogni chiamata con `fresh`: il daemon può essere ripartito,
 * e nel frattempo la porta può essere passata ad altri.
 *
 * EN: true if the daemon that knows `token` answers on `baseUrl`. A positive result stays valid for
 * the whole life of the process (a CLI or a hook live a few seconds); a negative one doesn't, so a
 * restarting daemon gets recognized. Long-lived processes (MCP shim, app notifications) ask for a
 * new proof on every call with `fresh`: the daemon may have restarted, and meanwhile the port may
 * have passed to someone else.
 */
export async function verifyDaemon (baseUrl: string, token: string, opts: { fresh?: boolean, timeoutMs?: number } = {}): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 3000
  const key = `${baseUrl}\n${token}`
  const cached = opts.fresh ? undefined : verified.get(key)
  if (cached) return await cached
  const check = (async () => {
    const nonce = randomBytes(16).toString('hex')
    try {
      const res = await fetch(`${baseUrl}${PROOF_ROUTE}?nonce=${nonce}`, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) return false
      const { proof } = await res.json() as { proof?: unknown }
      if (typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof)) return false
      return timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(daemonProof(token, nonce), 'hex'))
    } catch {
      return false
    }
  })()
  if (opts.fresh) return await check
  verified.set(key, check)
  const ok = await check
  if (!ok) verified.delete(key)
  return ok
}

/** Messaggio per l'utente quando la prova non torna. / EN: Message for the user when the proof doesn't match. */
export function impostorMessage (baseUrl: string): { it: string, en: string } {
  return {
    it: `Su ${baseUrl} risponde un programma che non è il tuo daemon Micelio (non conosce il tuo token): non gli mando niente. Può essere il daemon di un altro utente di questo PC, o un altro programma sulla stessa porta. Cambia la porta in ~/.micelio/config.json oppure chiudi quel programma.`,
    en: `Something that isn't your Micelio daemon answers on ${baseUrl} (it doesn't know your token): nothing is sent to it. It may be another user's daemon on this PC, or another program on the same port. Change the port in ~/.micelio/config.json or close that program.`
  }
}
