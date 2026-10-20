/**
 * @file Chat sulla memoria (B10): dalla domanda al materiale per l'LLM e alla MAPPA MENTALE.
 *
 * Funzioni pure, senza rete né disco. Il nodo (src/node/micelio-node.ts) fa la ricerca e chiama
 * l'LLM; qui si decide:
 * - quali ricordi aggiungere a quelli trovati dalla ricerca (i vicini nella costellazione);
 * - come raggrupparli in TEMI per la mappa (stesso metodo delle galassie, src/graph/communities.ts);
 * - il testo che l'LLM riceve, con i ricordi numerati, e la forma della sua risposta.
 *
 * La mappa si costruisce SENZA LLM, così compare subito; l'LLM, nella stessa chiamata della
 * risposta, dà ai temi un nome leggibile (altrimenti restano i tag caratteristici).
 */
import { z } from 'zod'
import { detectCommunities, OTHER_GALAXY } from '../graph/communities'
import type { GraphLink, GraphNode } from '../graph/constellation'

/** Ricordi al massimo nella mappa e nel materiale per l'LLM. */
export const CHAT_MAX_MEMORIES = 30
/** Ricordi trovati dalla ricerca, prima di allargare ai vicini. */
export const CHAT_SEARCH_HITS = 12
/** Caratteri del corpo di ogni ricordo passati all'LLM (i ricordi sono brevi; i documenti no). */
const BODY_CHARS = 1200

/** Un ricordo come serve alla chat. */
export interface ChatMemory {
  id: string
  title: string
  body: string
  kind: string
  tags: string[]
  /** Pertinenza alla domanda (0 = aggiunto come vicino). */
  score: number
  activation: number
  root?: { category: string }
  authorName: string | null
}

/** Collegamento fra due ricordi della mappa, con il suo tipo leggibile. */
export interface MapLink {
  source: string
  target: string
  /** tags = argomenti in comune; semantic = significato simile; dream = deciso dal dreaming. */
  kind: GraphLink['kind']
  /** Solo per i collegamenti del dreaming: relates | refines | contradicts | depends-on. */
  rel?: string
  weight: number
}

/** La mappa mentale: domanda al centro, temi, ricordi, collegamenti fra ricordi. */
export interface MindMap {
  question: string
  themes: { id: number, label: string, tags: string[], memories: string[] }[]
  memories: { id: string, title: string, line: string, kind: string, root: boolean, found: boolean }[]
  links: MapLink[]
}

/**
 * Allarga i ricordi trovati ai loro vicini nella costellazione (un passo), i più legati per primi,
 * fino a `max` ricordi in tutto.
 * @param found id trovati dalla ricerca, dal più pertinente
 */
export function expandWithNeighbors (found: string[], links: MapLink[], max = CHAT_MAX_MEMORIES): string[] {
  const out = [...new Set(found)].slice(0, max)
  const inSet = new Set(out)
  const candidates = new Map<string, number>()
  for (const l of links) {
    for (const [a, b] of [[l.source, l.target], [l.target, l.source]]) {
      if (inSet.has(a) && !inSet.has(b)) candidates.set(b, (candidates.get(b) ?? 0) + l.weight + (l.kind === 'dream' ? 0.5 : 0))
    }
  }
  for (const [id] of [...candidates].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))) {
    if (out.length >= max) break
    out.push(id)
  }
  return out
}

/** Prima riga leggibile di un ricordo (senza Markdown), per la mappa. */
export function lineOf (body: string, max = 140): string {
  const t = body.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`]/g, '').replace(/\s+/g, ' ').trim()
  const first = t.split(/(?<=[.!?])\s/)[0] ?? t
  return first.length > max ? first.slice(0, max - 1).trimEnd() + '…' : first
}

/**
 * Mappa mentale dei ricordi: temi come comunità dei loro collegamenti; i ricordi isolati vanno nel
 * tema dei loro tag più frequenti o, se non ne hanno in comune con nessuno, in "Altro".
 * @param found id trovati dalla ricerca (gli altri sono vicini aggiunti)
 */
export function buildMindMap (question: string, memories: ChatMemory[], links: MapLink[], found: Set<string>): MindMap {
  const ids = new Set(memories.map((m) => m.id))
  const inner = links.filter((l) => ids.has(l.source) && ids.has(l.target))
  const nodes: GraphNode[] = memories.map((m) => ({ id: m.id, title: m.title, kind: m.kind, tags: m.tags, author: '', authorName: m.authorName, ts: 0, activation: m.activation, ...(m.root ? { root: { category: m.root.category, status: 'ok' as const } } : {}) }))
  // Temi piccoli: in una mappa di ~30 ricordi un tema dovrebbe raccoglierne al massimo un terzo
  // (con le misure delle galassie, pensate per migliaia di ricordi, finivano tutti in un tema solo)
  const c = detectCommunities(nodes, inner, 2, { maxSize: Math.max(4, Math.ceil(memories.length / 3)), minCount: Math.min(5, Math.floor(memories.length / 4)) })
  const themes = c.galaxies
    .filter((g) => g.id !== OTHER_GALAXY)
    .map((g) => ({ id: g.id, label: g.label || g.tags[0] || 'Tema', tags: g.tags, memories: memories.filter((m) => c.of.get(m.id) === g.id).map((m) => m.id) }))
  const other = memories.filter((m) => c.of.get(m.id) === OTHER_GALAXY).map((m) => m.id)
  if (other.length) themes.push({ id: OTHER_GALAXY, label: '', tags: [], memories: other })
  // Temi in ordine di pertinenza: prima quello con i ricordi trovati più in alto nella ricerca
  const rank = new Map(memories.map((m, i) => [m.id, i]))
  themes.sort((a, b) => Math.min(...a.memories.map((id) => rank.get(id) ?? 999)) - Math.min(...b.memories.map((id) => rank.get(id) ?? 999)))
  return {
    question,
    themes,
    memories: memories.map((m) => ({ id: m.id, title: m.title, line: lineOf(m.body), kind: m.kind, root: !!m.root, found: found.has(m.id) })),
    links: inner
  }
}

/** Risposta dell'LLM: testo con riferimenti [n], ricordi citati, nomi dei temi, "non lo so". */
export const ChatAnswer = z.object({
  answer: z.string(),
  /** Numeri dei ricordi citati nella risposta. */
  cited: z.array(z.number().int()),
  /** Nome leggibile per ogni tema della mappa (id del tema → titolo breve). */
  themes: z.array(z.object({ id: z.number().int(), title: z.string() })),
  /** true se i ricordi non bastano a rispondere. */
  unknown: z.boolean()
})
export type ChatAnswer = z.infer<typeof ChatAnswer>

/**
 * Istruzioni per l'LLM. La regola principale è la FEDELTÀ: la risposta usa solo i ricordi forniti,
 * come la distillazione (prompts.ts). Una chat che inventa sarebbe peggio di nessuna chat.
 * @param language lingua delle risposte: quella della domanda, in mancanza quella del team
 */
export function chatSystem (language: string): string {
  const lang = language === 'en' ? 'inglese' : language === 'it' ? 'italiano' : language
  return `Sei la chat di "Micelio", la memoria condivisa di un team di sviluppo software. Rispondi alla DOMANDA
usando SOLO i ricordi del team elencati sotto, numerati [1], [2]… Regole:
- Niente che non sia nei ricordi: niente conoscenza generale, niente supposizioni. Se i ricordi non bastano,
  dillo chiaramente in una frase, metti unknown = true e indica cosa manca.
- Cita ogni affermazione con il numero del ricordo da cui viene, tra parentesi quadre, es. [2] o [1][4].
  In cited metti i numeri dei ricordi citati.
- Se due ricordi si contraddicono, dillo e indica entrambi.
- Le RADICI sono il sapere fondante del team: se una è pertinente, mettila in evidenza.
- Stile: chiaro e diretto, come un collega esperto che spiega. Frasi brevi, elenchi solo se aiutano.
  Massimo ~200 parole. Markdown semplice (grassetto, elenchi, codice inline).
- Rispondi nella lingua della domanda (in mancanza: ${lang}); identificatori, comandi e codice invariati.
- themes: per ogni TEMA elencato in fondo dai un titolo breve e leggibile (2-5 parole) che dica di cosa parla.`
}

/**
 * Il materiale per l'LLM: conversazione precedente, ricordi numerati, temi, domanda.
 * @returns il testo e la corrispondenza numero → id del ricordo
 */
export function chatInput (question: string, memories: ChatMemory[], map: MindMap, history: { question: string, answer: string }[] = []): { input: string, numbers: Map<number, string> } {
  const numbers = new Map<number, string>()
  const parts: string[] = []
  if (history.length) {
    parts.push('=== CONVERSAZIONE PRECEDENTE ===')
    for (const h of history.slice(-3)) parts.push(`DOMANDA: ${h.question}\nRISPOSTA: ${h.answer.slice(0, 1500)}`)
  }
  parts.push('=== RICORDI DEL TEAM ===')
  memories.forEach((m, i) => {
    numbers.set(i + 1, m.id)
    const root = m.root ? ` · RADICE (${m.root.category})` : ''
    parts.push(`[${i + 1}] ${m.title}  (${m.kind}${root}${m.tags.length ? ' · #' + m.tags.join(' #') : ''})\n${m.body.slice(0, BODY_CHARS)}`)
  })
  parts.push('=== TEMI DELLA MAPPA ===')
  for (const t of map.themes) parts.push(`tema ${t.id}: ricordi ${t.memories.map((id) => memories.findIndex((m) => m.id === id) + 1).join(', ')}`)
  parts.push(`=== DOMANDA ===\n${question}`)
  return { input: parts.join('\n\n'), numbers }
}
