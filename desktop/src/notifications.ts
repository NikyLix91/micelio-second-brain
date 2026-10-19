/**
 * @file Notifiche di sistema (decisione D15), calcolate nel processo principale ascoltando lo
 * stream di eventi del daemon (GET /api/events), anche quando la finestra è nascosta.
 *
 * Quattro notifiche:
 * - nuovi elementi in inbox (aumento del conteggio);
 * - nodo isolato da più di 10 minuti (nessun peer connesso), tranne in modalità solo locale (B4);
 * - budget LLM oltre il 90% (una volta al giorno);
 * - riepilogo settimanale (B4): il lunedì dalle 9, una volta a settimana, se c'è qualcosa da dire;
 * - efficacia (B11): un ricordo è stato utile a un agente (confermato) o era sbagliato. Il daemon
 *   restituisce questi esiti solo se le notifiche sono accese in Impostazioni.
 *
 * La logica di "quando notificare" è in `NotificationRules`, pura e testabile; il resto è
 * collegamento allo stream.
 */
import type { DaemonInfo } from './daemon'
import { get } from './daemon'
import { t } from './strings'

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
  /** Ultimo esito di efficacia già visto (all'avvio: adesso, così non si ripetono quelli vecchi). */
  private efficacySince = Date.now()
  /** Da quando chiedere gli esiti al daemon. */
  get efficacyCursor (): number { return this.efficacySince }

  /** Nuovi elementi in inbox: notifica solo gli AUMENTI (non al primo valore letto). */
  inbox (count: number): Notice | null {
    const prev = this.lastInbox
    this.lastInbox = count
    if (prev === null || count <= prev) return null
    const n = count - prev
    return { title: t().inboxTitle, body: t().inboxBody(n), route: '/inbox' }
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
      return { title: t().isolatedTitle, body: t().isolatedBody, route: '/stato' }
    }
    return null
  }

  /**
   * Riepilogo settimanale: true se è ora di notificarlo (lunedì dalle 9, non ancora fatto questa
   * settimana). `lastWeek` arriva da disco (vedi watchDaemon), così un riavvio non lo ripete.
   * @returns la settimana da ricordare come notificata, o null
   */
  weekly (lastWeek: string | null, now = Date.now()): string | null {
    const d = new Date(now)
    if (d.getDay() !== 1 || d.getHours() < 9) return null
    const week = d.toISOString().slice(0, 10) // il lunedì identifica la settimana
    return week === lastWeek ? null : week
  }

  /**
   * Efficacia (B11): esiti nuovi da notificare. Al massimo 3 per volta: una sessione lunga può
   * giudicarne molti insieme, e una raffica di notifiche è peggio di nessuna.
   */
  efficacy (notices: { ts: number, verdict: string, title: string, reason: string | null }[]): Notice[] {
    const fresh = notices.filter((n) => n.ts > this.efficacySince).sort((a, b) => a.ts - b.ts)
    if (!fresh.length) return []
    this.efficacySince = fresh[fresh.length - 1].ts
    return fresh.slice(-3).map((n) => n.verdict === 'wrong'
      ? { title: t().wrongTitle, body: t().wrongBody(n.title, n.reason), route: '/efficacia' }
      : { title: t().usefulTitle, body: t().usefulBody(n.title), route: '/efficacia' })
  }

  /** Budget: una notifica al giorno quando si supera il 90%. */
  budget (used: number, limit: number, now = Date.now()): Notice | null {
    const day = new Date(now).toISOString().slice(0, 10)
    if (limit <= 0 || used / limit < 0.9 || this.budgetNotifiedDay === day) return null
    this.budgetNotifiedDay = day
    return { title: t().budgetTitle, body: t().budgetBody(used, limit), route: '/impostazioni' }
  }
}

/**
 * Ascolta il daemon e chiama `notify` quando una regola scatta. Si riconnette da solo.
 * @returns funzione per fermare l'ascolto
 */
export function watchDaemon (info: DaemonInfo, notify: (n: Notice) => void, weekState?: { get: () => string | null, set: (week: string) => void }): () => void {
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
      if (topic === 'efficacy') {
        const list = await get<{ ts: number, verdict: string, title: string, reason: string | null }[]>(info, `/api/efficacy/notices?since=${rules.efficacyCursor}`)
        for (const n of rules.efficacy(list)) notify(n)
      }
      if (topic === 'status' || topic === 'init' || topic === 'tick') {
        const st = await get<{ configured: boolean, peers: number, localOnly?: boolean }>(info, '/api/status')
        // Solo locale: nessun peer è la normalità, non un problema da segnalare
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
