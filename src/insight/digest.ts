/**
 * @file Riepilogo settimanale (B4): cosa ha imparato il team negli ultimi giorni.
 *
 * EN: Weekly digest (B4): what the team learned in the last few days.
 *
 * Rende visibile il valore di Micelio senza dover aprire ogni schermata: ricordi nuovi (per tipo e
 * per autore), nuove Radici e Radici da rivedere, ricordi più usati, lacune aperte, sogni, ricordi
 * con il codice cambiato. Si calcola al momento della richiesta dalla vista del team (uguale su
 * ogni PC) e da qualche segnale locale; non si salva da nessuna parte.
 *
 * EN: It makes Micelio's value visible without opening every screen: new memories (by kind and
 * by author), new Roots and Roots to review, most used memories, open knowledge gaps, dreams, memories
 * whose code changed. It is computed on request from the team view (the same on
 * every PC) and from a few local signals; it is not saved anywhere.
 */
import type { MemoryKind } from '../core/events'
import type { RecallHit, RootRecord } from '../core/model'

/** Una voce compatta del riepilogo. / EN: A compact digest entry. */
export interface DigestItem { id: string, title: string, detail?: string }

export interface Digest {
  /** Periodo coperto (ms). / EN: Period covered (ms). */
  from: number
  to: number
  memories: {
    /** Ricordi nuovi nel periodo (team, non personali). / EN: New memories in the period (team, not personal). */
    added: number
    byKind: Partial<Record<MemoryKind, number>>
    /** Chi ha contribuito, dal più attivo. / EN: Who contributed, most active first. */
    byAuthor: { name: string, count: number }[]
    /** I più recenti. / EN: The most recent ones. */
    latest: DigestItem[]
  }
  roots: {
    /** Promossi a Radice nel periodo. / EN: Promoted to Root in the period. */
    added: DigestItem[]
    /** Radici "da rivedere" (in questo momento). / EN: Roots "to review" (right now). */
    toReview: DigestItem[]
  }
  /** Ricordi usati nel periodo, dai più usati in totale. / EN: Memories used in the period, most used overall first. */
  mostUsed: DigestItem[]
  /** Lacune del team ancora aperte, dalle più condivise. / EN: The team's knowledge gaps still open, most shared first. */
  gaps: DigestItem[]
  /** Tue ricerche senza risposta nel periodo (solo su questo PC). / EN: Your unanswered searches in the period (this PC only). */
  myMisses: number
  dreams: { count: number, lastSummary: string | null }
  /** Ricordi con il codice citato cambiato (repository di questo PC). / EN: Memories whose cited code changed (repositories on this PC). */
  stale: number
}

export interface DigestInput {
  now: number
  days: number
  /** Ricordi attivi del team, già con i segnali (uses, root, stale). / EN: The team's active memories, already with signals (uses, root, stale). */
  memories: RecallHit[]
  roots: RootRecord[]
  /** Ultimo uso di ogni ricordo nel team (ms). / EN: Last use of each memory in the team (ms). */
  lastUsed: Map<string, number>
  gaps: { id: string, question: string, askers: string[], status: string }[]
  myMisses: { last: number }[]
  dreams: { ts: number, summary: string }[]
}

const DAY = 24 * 60 * 60 * 1000
const item = (h: RecallHit, detail?: string): DigestItem => ({ id: h.id, title: h.title, ...(detail ? { detail } : {}) })

/** Calcola il riepilogo degli ultimi `days` giorni. / EN: Computes the digest of the last `days` days. */
export function computeDigest (d: DigestInput): Digest {
  const from = d.now - d.days * DAY
  const added = d.memories.filter((m) => m.ts >= from).sort((a, b) => b.ts - a.ts)
  const byKind: Partial<Record<MemoryKind, number>> = {}
  const byAuthor = new Map<string, number>()
  for (const m of added) {
    byKind[m.kind] = (byKind[m.kind] ?? 0) + 1
    const name = m.authorName ?? m.author.slice(0, 8)
    byAuthor.set(name, (byAuthor.get(name) ?? 0) + 1)
  }
  const byId = new Map(d.memories.map((m) => [m.id, m]))
  const rootItems = (list: RootRecord[]) => list.flatMap((r) => { const m = byId.get(r.id); return m ? [item(m, r.category)] : [] })
  const dreams = d.dreams.filter((x) => x.ts >= from).sort((a, b) => b.ts - a.ts)
  return {
    from,
    to: d.now,
    memories: {
      added: added.length,
      byKind,
      byAuthor: [...byAuthor].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      latest: added.slice(0, 5).map((m) => item(m, m.kind))
    },
    roots: {
      added: rootItems(d.roots.filter((r) => r.ts >= from)),
      toReview: rootItems(d.roots.filter((r) => r.status === 'review'))
    },
    mostUsed: d.memories
      .filter((m) => (d.lastUsed.get(m.id) ?? 0) >= from)
      .sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0))
      .slice(0, 5)
      .map((m) => item(m, String(m.uses ?? 0))),
    gaps: d.gaps.filter((g) => g.status === 'open').sort((a, b) => b.askers.length - a.askers.length).slice(0, 5)
      .map((g) => ({ id: g.id, title: g.question, detail: String(g.askers.length) })),
    myMisses: d.myMisses.filter((m) => m.last >= from).length,
    dreams: { count: dreams.length, lastSummary: dreams[0]?.summary ?? null },
    stale: d.memories.filter((m) => m.stale).length
  }
}
