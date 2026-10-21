/**
 * @file Ripristino di un backup (B7): dal contenuto alla SEQUENZA di eventi da scrivere nel team.
 *
 * EN: Restoring a backup (B7): from the content to the SEQUENCE of events to write to the team.
 *
 * Il ripristino non copia la vista: riscrive il sapere come eventi normali del team, firmati dal
 * nodo che ripristina. Così vale per tutti i colleghi (che li ricevono come ogni altro evento) e
 * passa dalle stesse regole di `apply` (src/net/apply.ts). Funzione pura: testabile senza rete.
 *
 * EN: The restore does not copy the view: it rewrites the knowledge as normal team events, signed by
 * the restoring node. This way it applies to all colleagues (who receive them like any other event)
 * and goes through the same rules as `apply` (src/net/apply.ts). Pure function: testable without network.
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
 * EN: Order, because some events only take effect if others come first:
 * 1. shared team configuration;
 * 2. all memories (active and history) with `memory.add`, with ORIGINAL author and date in
 *    `source.origin` (the "real" author for apply is whoever restores: the signed feed cannot be forged);
 * 3. the history: supersessions (`memory.supersede` towards the memory that replaced them) and
 *    archivings. BEFORE Roots and pinned memories: apply neither archives nor merges those;
 * 4. Roots and their flags, links, pinned memories;
 * 5. votes (one, with the sign of the original sum), usage (as a counter of whoever restores),
 *    knowledge gaps.
 *
 * Ripristino in un team che ha già una parte di quei ricordi: l'id di un ricordo deriva dal suo
 * contenuto, quindi `memory.add` di un ricordo già presente non fa nulla e il team esistente
 * vince (stato, Radice, storico restano i suoi). Ripristinare due volte lo stesso backup è innocuo.
 *
 * EN: Restoring into a team that already has some of those memories: a memory's id derives from its
 * content, so `memory.add` of a memory already present does nothing and the existing team
 * wins (status, Root, history stay its own). Restoring the same backup twice is harmless.
 */
import type { EventPayload, MemoryData } from '../core/events'
import type { BackupContent, BackupMemory } from './archive'

/** Massimo di vecchi ricordi per `memory.supersede` (limite dello schema). / EN: Max old memories per `memory.supersede` (schema limit). */
const SUPERSEDE_MAX = 20
/** Ricordi per `usage.report`: eventi piccoli, come quelli normali. / EN: Memories per `usage.report`: small events, like the normal ones. */
const USAGE_PER_EVENT = 200
const LINK_RELS = new Set(['relates', 'refines', 'contradicts', 'depends-on'])

/**
 * Eventi che ricostruiscono il sapere del backup.
 *
 * EN: Events that rebuild the knowledge in the backup.
 * @param includeConfig false per non toccare la configurazione condivisa (ripristino in un team esistente
 *                      che ha già la sua)
 *                      EN: false to leave the shared configuration alone (restore into an existing team
 *                      that already has its own)
 */
export function planRestore (content: BackupContent, { includeConfig = true, sourceTeam }: { includeConfig?: boolean, sourceTeam?: string } = {}): EventPayload[] {
  const out: EventPayload[] = []
  // Solo i ricordi che tornano: un redatto non si ripristina, e nemmeno ciò che lo cita
  // EN: Only the memories that come back: a redacted one is not restored, nor is anything citing it
  const byId = new Map(content.memories.filter((m) => m.status !== 'redacted').map((m) => [m.id, m]))

  // 1. Configurazione condivisa
  // EN: 1. Shared configuration
  if (includeConfig) for (const [key, value] of Object.entries(content.config ?? {})) out.push({ type: 'team.config', key, value })

  // 2. Ricordi, con autore e data d'origine
  // EN: 2. Memories, with original author and date
  for (const m of content.memories) {
    if (m.status === 'redacted') continue
    out.push({ type: 'memory.add', memory: toInput(m, sourceTeam) })
  }

  // 3. Storico: sostituiti (raggruppati per successore) e archiviati
  // EN: 3. History: superseded (grouped by successor) and archived
  const supersededBy = new Map<string, string[]>()
  for (const m of content.memories) {
    if (m.status !== 'superseded') continue
    const next = m.supersededBy && byId.get(m.supersededBy)
    // Successore mancante o redatto: si conserva comunque come storico, archiviato
    // EN: Successor missing or redacted: keep it anyway as history, archived
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
  // EN: 4. Roots (and open flags), links, pinned memories
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
  // EN: 5. Votes, usage, knowledge gaps
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
 *
 * EN: Backup memory → memory to write. Original author and date in `source.origin`; if the
 * memory had already been restored from another backup, the FIRST origin is kept.
 */
function toInput (m: BackupMemory, sourceTeam?: string): MemoryData {
  const origin = m.source?.origin ?? { author: m.authorName ?? undefined, key: m.author, ts: m.ts, ...(sourceTeam ? { team: sourceTeam } : {}) }
  return { kind: m.kind, title: m.title, body: m.body, tags: m.tags, source: { ...m.source, origin } as MemoryData['source'] }
}
