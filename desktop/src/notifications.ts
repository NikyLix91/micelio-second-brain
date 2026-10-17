/**
 * @file Notifiche di sistema (decisione D15), calcolate nel processo principale ascoltando lo
 * stream di eventi del daemon (GET /api/events), anche quando la finestra è nascosta.
 *
 * Tre notifiche:
 * - nuovi elementi in inbox (aumento del conteggio);
 * - nodo isolato da più di 10 minuti (nessun peer connesso);
 * - budget LLM oltre il 90% (una volta al giorno).
 *
 * La logica di "quando notificare" è in `NotificationRules`, pura e testabile; il resto è
 * collegamento allo stream.
 */
import type { DaemonInfo } from './daemon'
import { get } from './daemon'

export interface Notice { title: string, body: string, route: string }

/** Soglia oltre la quale un nodo senza peer è "isolato". */
export const ISOLATION_MS = 10 * 60 * 1000

/**
 * Regole delle notifiche. Riceve osservazioni (conteggio inbox, peer, budget) e decide se
 * mostrare qualcosa. Ricorda cosa ha già notificato per non ripetersi.
 */
export class NotificationRules {
  private lastInbox: number | null = null
  private isolatedSince: number | null = null
  private isolationNotified = false
  private budgetNotifiedDay: string | null = null

  /** Nuovi elementi in inbox: notifica solo gli AUMENTI (non al primo valore letto). */
  inbox (count: number): Notice | null {
    const prev = this.lastInbox
    this.lastInbox = count
    if (prev === null || count <= prev) return null
    const n = count - prev
    return { title: 'Micelio · da verificare', body: n === 1 ? 'Un nuovo ricordo attende la tua decisione.' : `${n} nuovi ricordi attendono la tua decisione.`, route: '/inbox' }
  }

  /** Isolamento: notifica una volta quando i peer restano a zero oltre ISOLATION_MS. */
  peers (count: number, now = Date.now()): Notice | null {
    if (count > 0) {
      this.isolatedSince = null
      this.isolationNotified = false
      return null
    }
    this.isolatedSince ??= now
    if (!this.isolationNotified && now - this.isolatedSince >= ISOLATION_MS) {
      this.isolationNotified = true
      return { title: 'Micelio · nodo isolato', body: 'Da più di 10 minuti nessun collega è raggiungibile: il sapere non si sta sincronizzando.', route: '/stato' }
    }
    return null
  }

  /** Budget: una notifica al giorno quando si supera il 90%. */
  budget (used: number, limit: number, now = Date.now()): Notice | null {
    const day = new Date(now).toISOString().slice(0, 10)
    if (limit <= 0 || used / limit < 0.9 || this.budgetNotifiedDay === day) return null
    this.budgetNotifiedDay = day
    return { title: 'Micelio · budget quasi esaurito', body: `Oggi ${used} chiamate su ${limit}. Oltre il limite il lavoro aspetta domani.`, route: '/impostazioni' }
  }
}

/**
 * Ascolta il daemon e chiama `notify` quando una regola scatta. Si riconnette da solo.
 * @returns funzione per fermare l'ascolto
 */
export function watchDaemon (info: DaemonInfo, notify: (n: Notice) => void): () => void {
  const rules = new NotificationRules()
  let stopped = false
  let controller: AbortController | null = null

  /** Rilegge i dati rilevanti per le regole e notifica se serve. */
  const check = async (topic: string) => {
    try {
      if (topic === 'inbox' || topic === 'jobs' || topic === 'init') {
        const s = await get<{ inbox: number, llm: { budget: { used: number, limit: number } } | null }>(info, '/api/ingest/status')
        const a = rules.inbox(s.inbox)
        if (a) notify(a)
        const b = s.llm ? rules.budget(s.llm.budget.used, s.llm.budget.limit) : null
        if (b) notify(b)
      }
      if (topic === 'status' || topic === 'init' || topic === 'tick') {
        const st = await get<{ configured: boolean, peers: number }>(info, '/api/status')
        const p = st.configured ? rules.peers(st.peers) : null
        if (p) notify(p)
      }
    } catch {
      // daemon momentaneamente non raggiungibile: riproveremo al prossimo evento
    }
  }

  // L'isolamento dipende dal TEMPO, non solo dagli eventi: controllo periodico ogni minuto.
  const tick = setInterval(() => void check('tick'), 60_000)

  void (async () => {
    while (!stopped) {
      controller = new AbortController()
      try {
        const res = await fetch(`${info.baseUrl}/api/events`, { headers: { authorization: `Bearer ${info.token}` }, signal: controller.signal })
        if (!res.ok || !res.body) throw new Error(String(res.status))
        await check('init')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!stopped) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const blocks = buffer.split('\n\n')
          buffer = blocks.pop() ?? ''
          for (const b of blocks) {
            const m = b.match(/^data: (.*)$/m)
            if (b.includes('event: change') && m) await check(JSON.parse(m[1]).topic)
          }
        }
      } catch {
        // stream caduto: riconnessione dopo una pausa
      }
      if (!stopped) await new Promise((r) => setTimeout(r, 5000))
    }
  })()

  return () => {
    stopped = true
    clearInterval(tick)
    controller?.abort()
  }
}
