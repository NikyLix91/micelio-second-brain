/**
 * @file Dreaming (DESIGN §10, Fase 6): il consolidamento periodico del sapere del team.
 *
 * Come il sonno per la memoria umana: periodicamente UN nodo del team rilegge il sapere e
 * 1. FONDE i ricordi quasi duplicati in uno solo (memory.supersede; i vecchi restano come storico);
 * 2. ARCHIVIA quelli resi obsoleti da ricordi più recenti (memory.archive, con il motivo);
 * 3. COLLEGA quelli correlati (memory.link), arricchendo la costellazione;
 * 4. lascia DECADERE i ricordi che nessuno usa più da tempo (archiviazione reversibile);
 * 5. scrive un DIARIO di cosa ha fatto (dream.complete), visibile a tutti.
 *
 * Coordinamento (§10.1): ogni "epoca" (un giorno) ha un solo sognatore. L'ordine dei candidati è
 * deterministico (hash di epoca + chiave), quindi ogni nodo sa quando tocca a lui: il primo dopo
 * l'ora di inizio, il secondo 30 minuti dopo se il primo non ha rivendicato l'epoca, e così via.
 * Se due nodi rivendicano comunque in parallelo, vince la prima rivendicazione nell'ordine
 * linearizzato (apply) e l'altro si ferma.
 *
 * Guardrail (§10.3): il dreaming non cancella mai (archivia o sostituisce, tutto ripristinabile),
 * non tocca i ricordi fissati, ha un budget massimo di chiamate LLM per sogno.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { MEMORY_KINDS, type EventPayload } from '../core/events'
import type { RecallHit } from '../core/model'
import { cosine } from '../rank/hybrid'
import type { LlmRunner } from '../llm/runner'

/** Chiamate LLM massime per sogno (oltre al budget giornaliero del nodo). */
export const MAX_CALLS_PER_DREAM = 30
/** Gruppi di duplicati esaminati al massimo per sogno. */
const MAX_GROUPS = 12
/** Ricordi per gruppo al massimo. */
const MAX_GROUP_SIZE = 5
/** Decadimento: attivazione sotto questa soglia… */
export const DECAY_ACTIVATION = 0.15
/** …e più vecchio di così (giorni) → archiviato. */
export const DECAY_MIN_AGE_DAYS = 90
/** Archiviazioni per decadimento al massimo per sogno (prudenza). */
const MAX_DECAY = 20

/** Esito di un sogno, mostrato nel diario. */
export interface DreamReport {
  epoch: string
  examined: number
  merged: number
  obsolete: number
  linked: number
  decayed: number
  calls: number
  summary: string
}

/** Decisione del modello su un gruppo di ricordi simili. */
export const Consolidation = z.object({
  action: z.enum(['merge', 'obsolete', 'link', 'none']),
  /** Per "merge": il ricordo che sostituisce tutto il gruppo. */
  merged: z.object({ kind: z.enum(MEMORY_KINDS), title: z.string(), body: z.string(), tags: z.array(z.string()) }).optional(),
  /** Per "obsolete": gli id (anche abbreviati) dei ricordi superati da altri del gruppo. */
  obsolete: z.array(z.string()).optional(),
  reason: z.string()
})
export type Consolidation = z.infer<typeof Consolidation>

export const CONSOLIDATE_SYSTEM = `Sei il "sogno" di Micelio, la memoria condivisa di un team di sviluppo: periodicamente riordini il sapere.
Ricevi un gruppo di ricordi molto simili fra loro (id, data, titolo, contenuto). Decidi UNA azione:
- "merge": dicono la stessa cosa (o si completano) → scrivi in "merged" UN ricordo che li sostituisce tutti,
  fedele ai contenuti originali: non aggiungere nulla che non sia in almeno uno dei ricordi.
- "obsolete": alcuni sono superati da altri più recenti del gruppo (es. una decisione cambiata) → elenca in
  "obsolete" gli id di quelli superati.
- "link": sono correlati ma distinti → vanno solo collegati.
- "none": nessuna relazione utile.
Nel dubbio scegli "link" o "none": fondere o archiviare per errore è peggio che non fare nulla.
Scrivi nella stessa lingua dei ricordi. "reason" spiega la scelta in una frase.`

export interface DreamDeps {
  /** Chiave del nodo locale (funzione: è nota solo quando il team è aperto). */
  me: () => string
  llm: LlmRunner | null
  model: () => string
  /** Ricordi attivi, con attivazione e pin. */
  memories: () => RecallHit[]
  /** Vettori di significato (id → vettore) e soglia "quasi duplicato" del modello. */
  vectors: () => { map: Map<string, Float32Array>, duplicate: number }
  append: (p: EventPayload) => Promise<void>
  sync: () => Promise<void>
  claimOf: (epoch: string) => Promise<string | null>
  /**
   * Attesa dopo la rivendicazione, perché eventuali rivendicazioni concorrenti di altri nodi si
   * replichino prima di ricontrollare chi ha vinto. Riduce i sogni doppi (la correttezza finale
   * è comunque garantita da apply: vince la prima rivendicazione, il diario dell'altro è scartato).
   */
  settleMs?: number
  log: (m: string) => void
}

/** Epoca corrente: il giorno (UTC), es. "2026-10-17". */
export function currentEpoch (now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

/**
 * Posizione di ogni membro nella "turnazione" dell'epoca: ordinamento deterministico per
 * hash(epoca + chiave). Tutti i nodi calcolano la stessa sequenza senza parlarsi.
 */
export function dreamOrder (epoch: string, members: string[]): string[] {
  const h = (k: string) => createHash('sha256').update(`${epoch}|${k}`).digest('hex')
  return [...members].sort((a, b) => h(a).localeCompare(h(b)))
}

/**
 * Gruppi di ricordi quasi duplicati: coppie con similarità ≥ soglia, unite per transitività
 * (union-find). Esclusi i ricordi fissati. Al massimo MAX_GROUPS gruppi da MAX_GROUP_SIZE.
 */
export function duplicateGroups (memories: RecallHit[], vectors: Map<string, Float32Array>, threshold: number): string[][] {
  const ids = memories.filter((m) => !m.pinned && vectors.has(m.id)).map((m) => m.id)
  const parent = new Map(ids.map((id) => [id, id]))
  const find = (x: string): string => { while (parent.get(x) !== x) x = parent.get(x)!; return x }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (cosine(vectors.get(ids[i])!, vectors.get(ids[j])!) >= threshold) parent.set(find(ids[i]), find(ids[j]))
    }
  }
  const groups = new Map<string, string[]>()
  for (const id of ids) groups.set(find(id), [...(groups.get(find(id)) ?? []), id])
  return [...groups.values()].filter((g) => g.length >= 2).map((g) => g.slice(0, MAX_GROUP_SIZE)).slice(0, MAX_GROUPS)
}

/** Ricordi da far decadere: poco attivi, vecchi, non fissati. */
export function decayCandidates (memories: RecallHit[], now = Date.now()): RecallHit[] {
  const minAge = DECAY_MIN_AGE_DAYS * 24 * 3600 * 1000
  return memories
    .filter((m) => !m.pinned && (m.activation ?? 1) < DECAY_ACTIVATION && now - m.ts > minAge)
    .sort((a, b) => (a.activation ?? 0) - (b.activation ?? 0))
    .slice(0, MAX_DECAY)
}

export class Dreamer {
  private running = false

  constructor (private readonly deps: DreamDeps) {}

  get busy (): boolean { return this.running }

  /**
   * Sogna per un'epoca. Rivendica l'epoca e procede solo se la rivendicazione "vince".
   * @returns il resoconto, o null se un altro nodo ha già (o ha vinto) quest'epoca
   */
  async dream (epoch: string): Promise<DreamReport | null> {
    if (this.running) return null
    this.running = true
    try {
      const { deps } = this
      if (await deps.claimOf(epoch)) return null // già rivendicata da qualcuno
      await deps.append({ type: 'dream.claim', epoch })
      await deps.sync()
      if (await deps.claimOf(epoch) !== deps.me()) return null // un altro nodo è arrivato prima
      await new Promise((r) => setTimeout(r, deps.settleMs ?? 5000))
      await deps.sync()
      if (await deps.claimOf(epoch) !== deps.me()) return null // una rivendicazione concorrente ha vinto
      deps.log(`sogno dell'epoca ${epoch} iniziato`)
      return await this.run(epoch)
    } finally {
      this.running = false
    }
  }

  private async run (epoch: string): Promise<DreamReport> {
    const { deps } = this
    const memories = deps.memories()
    const byId = new Map(memories.map((m) => [m.id, m]))
    const r: DreamReport = { epoch, examined: memories.length, merged: 0, obsolete: 0, linked: 0, decayed: 0, calls: 0, summary: '' }
    const lines: string[] = []

    // 1-3) Gruppi di quasi duplicati → decisione del modello
    const { map, duplicate } = deps.vectors()
    for (const group of duplicateGroups(memories, map, duplicate)) {
      if (!deps.llm || r.calls >= MAX_CALLS_PER_DREAM || !deps.llm.hasBudget(1)) break
      const items = group.map((id) => byId.get(id)!).filter(Boolean)
      const input = items.map((m) => `[${m.id.slice(0, 12)}] ${new Date(m.ts).toISOString().slice(0, 10)} · ${m.title}\n${m.body}`).join('\n\n---\n\n')
      let c: Consolidation
      try {
        r.calls++
        c = await deps.llm.run({ name: 'consolidate', system: CONSOLIDATE_SYSTEM, input, schema: Consolidation, model: deps.model() })
      } catch (err) {
        deps.log(`consolidamento non riuscito: ${(err as Error).message}`)
        continue
      }
      const resolve = (ref: string) => items.find((m) => m.id.startsWith(ref.toLowerCase()))?.id
      if (c.action === 'merge' && c.merged) {
        await deps.append({ type: 'memory.supersede', old: items.map((m) => m.id), memory: { ...c.merged, source: { type: 'dream', ref: epoch } }, reason: c.reason })
        r.merged += items.length
        lines.push(`Fusi ${items.length} ricordi in «${c.merged.title}»: ${c.reason}`)
      } else if (c.action === 'obsolete' && c.obsolete?.length) {
        for (const id of c.obsolete.map(resolve).filter((x): x is string => !!x)) {
          await deps.append({ type: 'memory.archive', id, reason: `superato: ${c.reason}` })
          r.obsolete++
          lines.push(`Archiviato come superato «${byId.get(id)?.title}»: ${c.reason}`)
        }
      } else if (c.action === 'link') {
        for (let i = 1; i < items.length; i++) {
          await deps.append({ type: 'memory.link', from: items[0].id, to: items[i].id, rel: 'relates' })
          r.linked++
        }
        lines.push(`Collegati ${items.length} ricordi correlati attorno a «${items[0].title}»`)
      }
    }

    // 4) Decadimento: niente LLM, regola deterministica e prudente
    for (const m of decayCandidates(memories)) {
      await deps.append({ type: 'memory.archive', id: m.id, reason: `decaduto: attivazione ${Math.round((m.activation ?? 0) * 100)}%, nessun uso recente` })
      r.decayed++
    }
    if (r.decayed) lines.push(`Archiviati per decadimento ${r.decayed} ricordi non più usati`)

    // 5) Diario
    r.summary = lines.length ? lines.join('\n') : 'Nessuna modifica: il sapere del team è già in ordine.'
    await deps.append({ type: 'dream.complete', epoch, summary: r.summary, stats: { examined: r.examined, merged: r.merged, obsolete: r.obsolete, linked: r.linked, decayed: r.decayed, calls: r.calls } })
    await deps.sync()
    deps.log(`sogno dell'epoca ${epoch} completato: ${r.merged} fusi, ${r.obsolete} superati, ${r.linked} collegati, ${r.decayed} decaduti`)
    return r
  }
}
