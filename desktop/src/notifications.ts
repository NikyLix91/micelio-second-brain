/**
 * @file Notifiche di sistema (decisione D15), calcolate nel processo principale ascoltando lo
 * stream di eventi del daemon (GET /api/events), anche quando la finestra è nascosta.
 *
 * EN: System notifications (decision D15), computed in the main process by listening to the
 * daemon event stream (GET /api/events), even when the window is hidden.
 *
 * Quattro notifiche:
 * - nuovi elementi in inbox (aumento del conteggio);
 * - nodo isolato da più di 10 minuti (nessun peer connesso), tranne in modalità solo locale (B4);
 * - budget LLM oltre il 90% (una volta al giorno);
 * - riepilogo settimanale (B4): il lunedì dalle 9, una volta a settimana, se c'è qualcosa da dire;
 * - efficacia (B11): un ricordo è stato utile a un agente (confermato) o era sbagliato. Il daemon
 *   restituisce questi esiti solo se le notifiche sono accese in Impostazioni.
 *
 * EN: Four notifications:
 * - new items in the Inbox (count increase);
 * - node isolated for more than 10 minutes (no connected peer), except in local-only mode (B4);
 * - LLM budget above 90% (once a day);
 * - weekly digest (B4): on Monday from 9 am, once a week, if there is something to say;
 * - efficacy (B11): a memory was useful to an agent (confirmed) or was wrong. The daemon
 *   returns these outcomes only if notifications are on in Settings.
 *
 * La logica di "quando notificare" è in `NotificationRules`, pura e testabile; il resto è
 * collegamento allo stream.
 *
 * EN: The "when to notify" logic lives in `NotificationRules`, pure and testable; the rest is
 * wiring to the stream.
 */
import type { DaemonInfo } from './daemon'
import { get } from './daemon'
import { t } from './strings'

export interface Notice { title: string, body: string, route: string }

/** Soglia oltre la quale un nodo senza peer è "isolato". / EN: Threshold after which a node without peers is "isolated". */
export const ISOLATION_MS = 10 * 60 * 1000

/**
 * Regole delle notifiche. Riceve osservazioni (conteggio inbox, peer, budget) e decide se
 * mostrare qualcosa. Ricorda cosa ha già notificato per non ripetersi.
 *
 * EN: Notification rules. Receives observations (Inbox count, peers, budget) and decides whether
 * to show something. Remembers what it already notified so it does not repeat itself.
 */
export class NotificationRules {
  private lastInbox: number | null = null
  private isolatedSince: number | null = null
  private isolationNotified = false
  private budgetNotifiedDay: string | null = null
  /** Ultimo esito di efficacia già visto (all'avvio: adesso, così non si ripetono quelli vecchi). / EN: Last efficacy outcome already seen (at startup: now, so old ones are not repeated). */
  private efficacySince = Date.now()
  /** Da quando chiedere gli esiti al daemon. / EN: From when to ask the daemon for outcomes. */
  get efficacyCursor (): number { return this.efficacySince }

  /** Nuovi elementi in inbox: notifica solo gli AUMENTI (non al primo valore letto). / EN: New Inbox items: notifies only INCREASES (not on the first value read). */
  inbox (count: number): Notice | null {
    const prev = this.lastInbox
    this.lastInbox = count
    if (prev === null || count <= prev) return null
    const n = count - prev
    return { title: t().inboxTitle, body: t().inboxBody(n), route: '/inbox' }
  }

  /** Isolamento: notifica una volta quando i peer restano a zero oltre ISOLATION_MS. / EN: Isolation: notifies once when peers stay at zero beyond ISOLATION_MS. */
  peers (count: number, now = Date.now()): Notice | null {
    if (count > 0) {
      this.isolatedSince = null
      this.isolationNotified = false
      return null
    }
    this.isolatedSince ??= now
    if (!this.isolationNotified && now - this.isolatedSince >= ISOLATION_MS) {
      this.isolationNotified = true
      return { title: t().isolatedTitle, body: t().isolatedBody, route: '/stato' }
    }
    return null
  }

  /**
   * Riepilogo settimanale: true se è ora di notificarlo (lunedì dalle 9, non ancora fatto questa
   * settimana). `lastWeek` arriva da disco (vedi watchDaemon), così un riavvio non lo ripete.
   *
   * EN: Weekly digest: true if it is time to notify it (Monday from 9 am, not done yet this
   * week). `lastWeek` comes from disk (see watchDaemon), so a restart does not repeat it.
   * @returns la settimana da ricordare come notificata, o null
   *          EN: the week to remember as notified, or null
   */
  weekly (lastWeek: string | null, now = Date.now()): string | null {
    const d = new Date(now)
    if (d.getDay() !== 1 || d.getHours() < 9) return null
    const week = d.toISOString().slice(0, 10) // il lunedì identifica la settimana / EN: the Monday identifies the week
    return week === lastWeek ? null : week
  }

  /**
   * Efficacia (B11): esiti nuovi da notificare. Al massimo 3 per volta: una sessione lunga può
   * giudicarne molti insieme, e una raffica di notifiche è peggio di nessuna.
   *
   * EN: Efficacy (B11): new outcomes to notify. At most 3 at a time: a long session can judge
   * many at once, and a burst of notifications is worse than none.
   */
  efficacy (notices: { ts: number, verdict: string, title: string, reason: string | null }[]): Notice[] {
    const fresh = notices.filter((n) => n.ts > this.efficacySince).sort((a, b) => a.ts - b.ts)
    if (!fresh.length) return []
    this.efficacySince = fresh[fresh.length - 1].ts
    return fresh.slice(-3).map((n) => n.verdict === 'wrong'
      ? { title: t().wrongTitle, body: t().wrongBody(n.title, n.reason), route: '/efficacia' }
      : { title: t().usefulTitle, body: t().usefulBody(n.title), route: '/efficacia' })
  }

  /** Budget: una notifica al giorno quando si supera il 90%. / EN: Budget: one notification a day when it goes above 90%. */
  budget (used: number, limit: number, now = Date.now()): Notice | null {
    const day = new Date(now).toISOString().slice(0, 10)
    if (limit <= 0 || used / limit < 0.9 || this.budgetNotifiedDay === day) return null
    this.budgetNotifiedDay = day
    return { title: t().budgetTitle, body: t().budgetBody(used, limit), route: '/impostazioni' }
  }
}

/**
 * Ascolta il daemon e chiama `notify` quando una regola scatta. Si riconnette da solo.
 *
 * EN: Listens to the daemon and calls `notify` when a rule fires. Reconnects by itself.
 * @returns funzione per fermare l'ascolto
 *          EN: function that stops listening
 */
export function watchDaemon (info: DaemonInfo, notify: (n: Notice) => void, weekState?: { get: () => string | null, set: (week: string) => void }): () => void {
  const rules = new NotificationRules()
  let stopped = false
  let controller: AbortController | null = null

  /** Rilegge i dati rilevanti per le regole e notifica se serve. / EN: Rereads the data relevant to the rules and notifies if needed. */
  const check = async (topic: string) => {
    try {
      if (topic === 'inbox' || topic === 'jobs' || topic === 'init') {
        const s = await get<{ inbox: number, llm: { budget: { used: number, limit: number } } | null }>(info, '/api/ingest/status')
        const a = rules.inbox(s.inbox)
        if (a) notify(a)
        const b = s.llm ? rules.budget(s.llm.budget.used, s.llm.budget.limit) : null
        if (b) notify(b)
      }
      if (topic === 'efficacy') {
        const list = await get<{ ts: number, verdict: string, title: string, reason: string | null }[]>(info, `/api/efficacy/notices?since=${rules.efficacyCursor}`)
        for (const n of rules.efficacy(list)) notify(n)
      }
      if (topic === 'status' || topic === 'init' || topic === 'tick') {
        const st = await get<{ configured: boolean, peers: number, localOnly?: boolean }>(info, '/api/status')
        // Solo locale: nessun peer è la normalità, non un problema da segnalare
        // EN: Local only: having no peers is normal, not a problem to report
        const p = st.configured ? rules.peers(st.localOnly ? 1 : st.peers) : null
        if (p) notify(p)
        const week = st.configured && weekState ? rules.weekly(weekState.get()) : null
        if (week) {
          weekState!.set(week)
          const d = await get<{ memories: { added: number }, gaps: unknown[] }>(info, '/api/digest?days=7')
          if (d.memories.added || d.gaps.length) notify({ title: t().digestTitle, body: t().digestBody(d.memories.added, d.gaps.length), route: '/riepilogo' })
        }
      }
    } catch {
      // daemon momentaneamente non raggiungibile: riproveremo al prossimo evento
      // EN: daemon temporarily unreachable: we will retry on the next event
    }
  }

  // L'isolamento dipende dal TEMPO, non solo dagli eventi: controllo periodico ogni minuto.
  // EN: Isolation depends on TIME, not only on events: periodic check every minute.
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
        // EN: stream dropped: reconnect after a pause
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
