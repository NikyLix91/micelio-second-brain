/**
 * @file Ripristino di un backup (B7): dal contenuto alla SEQUENZA di eventi da scrivere nel team.
 *
 * Il ripristino non copia la vista: riscrive il sapere come eventi normali del team, firmati dal
 * nodo che ripristina. Così vale per tutti i colleghi (che li ricevono come ogni altro evento) e
 * passa dalle stesse regole di `apply` (src/net/apply.ts). Funzione pura: testabile senza rete.
 *
 * Ordine, perché alcuni eventi valgono solo se ne precedono altri:
 * 1. configurazione condivisa del team;
 * 2. tutti i ricordi (attivi e storico) con `memory.add`, con autore e data ORIGINALI in
 *    `source.origin` (l'autore "vero" per apply è chi ripristina: il feed firmato non si falsifica);
 * 3. lo storico: sostituzioni (`memory.supersede` verso il ricordo che li ha sostituiti) e
 *    archiviazioni. PRIMA di Radici e ricordi fissati: apply non archivia né fonde quelli;
 * 4. Radici e loro segnalazioni, collegamenti, ricordi fissati;
 * 5. voti (uno, con il segno della somma originale), uso (come contatore di chi ripristina),
 *    lacune di conoscenza.
 *
 * Ripristino in un team che ha già una parte di quei ricordi: l'id di un ricordo deriva dal suo
 * contenuto, quindi `memory.add` di un ricordo già presente non fa nulla e il team esistente
 * vince (stato, Radice, storico restano i suoi). Ripristinare due volte lo stesso backup è innocuo.
 */
import type { EventPayload, MemoryData } from '../core/events'
import type { BackupContent, BackupMemory } from './archive'

/** Massimo di vecchi ricordi per `memory.supersede` (limite dello schema). */
const SUPERSEDE_MAX = 20
/** Ricordi per `usage.report`: eventi piccoli, come quelli normali. */
const USAGE_PER_EVENT = 200
const LINK_RELS = new Set(['relates', 'refines', 'contradicts', 'depends-on'])

/**
 * Eventi che ricostruiscono il sapere del backup.
 * @param includeConfig false per non toccare la configurazione condivisa (ripristino in un team esistente
 *                      che ha già la sua)
 */
export function planRestore (content: BackupContent, { includeConfig = true, sourceTeam }: { includeConfig?: boolean, sourceTeam?: string } = {}): EventPayload[] {
  const out: EventPayload[] = []
  // Solo i ricordi che tornano: un redatto non si ripristina, e nemmeno ciò che lo cita
  const byId = new Map(content.memories.filter((m) => m.status !== 'redacted').map((m) => [m.id, m]))

  // 1. Configurazione condivisa
  if (includeConfig) for (const [key, value] of Object.entries(content.config ?? {})) out.push({ type: 'team.config', key, value })

  // 2. Ricordi, con autore e data d'origine
  for (const m of content.memories) {
    if (m.status === 'redacted') continue
    out.push({ type: 'memory.add', memory: toInput(m, sourceTeam) })
  }

  // 3. Storico: sostituiti (raggruppati per successore) e archiviati
  const supersededBy = new Map<string, string[]>()
  for (const m of content.memories) {
    if (m.status !== 'superseded') continue
    const next = m.supersededBy && byId.get(m.supersededBy)
    // Successore mancante o redatto: si conserva comunque come storico, archiviato
    if (!next) { out.push({ type: 'memory.archive', id: m.id, reason: m.statusReason ?? 'sostituito' }); continue }
    if (!supersededBy.has(next.id)) supersededBy.set(next.id, [])
    supersededBy.get(next.id)!.push(m.id)
  }
  for (const [nextId, olds] of supersededBy) {
    const next = byId.get(nextId)!
    const reason = byId.get(olds[0])?.statusReason ?? 'fusione'
    for (let i = 0; i < olds.length; i += SUPERSEDE_MAX) {
      out.push({ type: 'memory.supersede', old: olds.slice(i, i + SUPERSEDE_MAX), memory: toInput(next, sourceTeam), reason: reason.slice(0, 500) })
    }
  }
  for (const m of content.memories) {
    if (m.status === 'archived') out.push({ type: 'memory.archive', id: m.id, reason: (m.statusReason ?? 'archiviato').slice(0, 500) })
  }

  // 4. Radici (e segnalazioni aperte), collegamenti, ricordi fissati
  for (const r of content.roots) {
    if (!byId.has(r.id)) continue
    out.push({ type: 'root.set', id: r.id, category: r.category })
    for (const f of r.flags ?? []) out.push({ type: 'root.flag', id: r.id, reason: f.reason.slice(0, 500), refs: (f.refs ?? []).slice(0, 20) })
  }
  for (const l of content.links) {
    if (LINK_RELS.has(l.rel) && byId.has(l.from) && byId.has(l.to)) out.push({ type: 'memory.link', from: l.from, to: l.to, rel: l.rel as 'relates' })
  }
  for (const id of content.pins) if (byId.has(id)) out.push({ type: 'memory.pin', id })

  // 5. Voti, uso, lacune
  for (const [id, sum] of Object.entries(content.votes ?? {})) {
    if (sum !== 0 && byId.has(id)) out.push({ type: 'memory.vote', id, delta: sum > 0 ? 1 : -1 })
  }
  const usage = Object.entries(content.usage ?? {}).filter(([id, u]) => byId.has(id) && u.count > 0)
  for (let i = 0; i < usage.length; i += USAGE_PER_EVENT) {
    out.push({ type: 'usage.report', counts: Object.fromEntries(usage.slice(i, i + USAGE_PER_EVENT)) })
  }
  for (const g of content.gaps ?? []) {
    out.push({ type: 'gap.report', id: g.id, question: g.question })
    if (g.status === 'closed') out.push({ type: 'gap.close', id: g.id, ...(g.memory && byId.has(g.memory) ? { memory: g.memory } : {}) })
  }
  return out
}

/**
 * Ricordo del backup → ricordo da scrivere. Autore e data d'origine in `source.origin`; se il
 * ricordo era già stato ripristinato da un altro backup si tiene l'origine PRIMA.
 */
function toInput (m: BackupMemory, sourceTeam?: string): MemoryData {
  const origin = m.source?.origin ?? { author: m.authorName ?? undefined, key: m.author, ts: m.ts, ...(sourceTeam ? { team: sourceTeam } : {}) }
  return { kind: m.kind, title: m.title, body: m.body, tags: m.tags, source: { ...m.source, origin } as MemoryData['source'] }
}
