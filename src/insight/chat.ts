/**
 * @file Chat sulla memoria (B10): dalla domanda al materiale per l'LLM e alla MAPPA MENTALE.
 *
 * EN: Chat over the memory (B10): from the question to the material for the LLM and to the MIND MAP.
 *
 * Funzioni pure, senza rete né disco. Il nodo (src/node/micelio-node.ts) fa la ricerca e chiama
 * l'LLM; qui si decide:
 * - quali ricordi aggiungere a quelli trovati dalla ricerca (i vicini nella costellazione);
 * - come raggrupparli in TEMI per la mappa (stesso metodo delle galassie, src/graph/communities.ts);
 * - il testo che l'LLM riceve, con i ricordi numerati, e la forma della sua risposta.
 *
 * EN: Pure functions, no network or disk. The node (src/node/micelio-node.ts) runs the search and calls the
 * LLM; here we decide:
 * - which memories to add to those found by the search (the neighbors in the constellation);
 * - how to group them into THEMES for the map (same method as the galaxies, src/graph/communities.ts);
 * - the text the LLM receives, with the numbered memories, and the shape of its answer.
 *
 * La mappa si costruisce SENZA LLM, così compare subito; l'LLM, nella stessa chiamata della
 * risposta, dà ai temi un nome leggibile (altrimenti restano i tag caratteristici).
 *
 * EN: The map is built WITHOUT the LLM, so it shows up right away; the LLM, in the same call as the answer,
 * gives the themes a readable name (otherwise they keep their characteristic tags).
 */
import { z } from 'zod'
import { detectCommunities, OTHER_GALAXY } from '../graph/communities'
import type { GraphLink, GraphNode } from '../graph/constellation'

/** Ricordi al massimo nella mappa e nel materiale per l'LLM. / EN: Maximum memories in the map and in the material for the LLM. */
export const CHAT_MAX_MEMORIES = 30
/** Ricordi trovati dalla ricerca, prima di allargare ai vicini. / EN: Memories found by the search, before widening to the neighbors. */
export const CHAT_SEARCH_HITS = 12
/** Caratteri del corpo di ogni ricordo passati all'LLM (i ricordi sono brevi; i documenti no). / EN: Characters of each memory body passed to the LLM (memories are short; documents are not). */
const BODY_CHARS = 1200

/** Un ricordo come serve alla chat. / EN: A memory as the chat needs it. */
export interface ChatMemory {
  id: string
  title: string
  body: string
  kind: string
  tags: string[]
  /** Pertinenza alla domanda (0 = aggiunto come vicino). / EN: Relevance to the question (0 = added as a neighbor). */
  score: number
  activation: number
  root?: { category: string }
  authorName: string | null
}

/** Collegamento fra due ricordi della mappa, con il suo tipo leggibile. / EN: Link between two memories of the map, with its readable type. */
export interface MapLink {
  source: string
  target: string
  /** tags = argomenti in comune; semantic = significato simile; dream = deciso dal dreaming. / EN: tags = shared topics; semantic = similar meaning; dream = decided by dreaming. */
  kind: GraphLink['kind']
  /** Solo per i collegamenti del dreaming: relates | refines | contradicts | depends-on. / EN: Only for dreaming links: relates | refines | contradicts | depends-on. */
  rel?: string
  weight: number
}

/** La mappa mentale: domanda al centro, temi, ricordi, collegamenti fra ricordi. / EN: The mind map: question in the center, themes, memories, links between memories. */
export interface MindMap {
  question: string
  themes: { id: number, label: string, tags: string[], memories: string[] }[]
  memories: { id: string, title: string, line: string, kind: string, root: boolean, found: boolean }[]
  links: MapLink[]
}

/**
 * Allarga i ricordi trovati ai loro vicini nella costellazione (un passo), i più legati per primi,
 * fino a `max` ricordi in tutto.
 *
 * EN: Widens the found memories to their neighbors in the constellation (one step), most connected first, up
 * to `max` memories in total.
 * @param found id trovati dalla ricerca, dal più pertinente
 *              EN: ids found by the search, most relevant first
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

/** Prima riga leggibile di un ricordo (senza Markdown), per la mappa. / EN: First readable line of a memory (no Markdown), for the map. */
export function lineOf (body: string, max = 140): string {
  const t = body.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`]/g, '').replace(/\s+/g, ' ').trim()
  const first = t.split(/(?<=[.!?])\s/)[0] ?? t
  return first.length > max ? first.slice(0, max - 1).trimEnd() + '…' : first
}

/**
 * Mappa mentale dei ricordi: temi come comunità dei loro collegamenti; i ricordi isolati vanno nel
 * tema dei loro tag più frequenti o, se non ne hanno in comune con nessuno, in "Altro".
 *
 * EN: Mind map of the memories: themes are communities of their links; isolated memories go to the theme of
 * their most frequent tags or, if they share none with anyone, to "Other".
 * @param found id trovati dalla ricerca (gli altri sono vicini aggiunti)
 *              EN: ids found by the search (the others are added neighbors)
 */
export function buildMindMap (question: string, memories: ChatMemory[], links: MapLink[], found: Set<string>): MindMap {
  const ids = new Set(memories.map((m) => m.id))
  const inner = links.filter((l) => ids.has(l.source) && ids.has(l.target))
  const nodes: GraphNode[] = memories.map((m) => ({ id: m.id, title: m.title, kind: m.kind, tags: m.tags, author: '', authorName: m.authorName, ts: 0, activation: m.activation, ...(m.root ? { root: { category: m.root.category, status: 'ok' as const } } : {}) }))
  // Temi piccoli: in una mappa di ~30 ricordi un tema dovrebbe raccoglierne al massimo un terzo
  // (con le misure delle galassie, pensate per migliaia di ricordi, finivano tutti in un tema solo)
  // EN: Small themes: in a map of ~30 memories a theme should hold at most a third of them (with the galaxy
  //     sizes, designed for thousands of memories, they all ended up in a single theme)
  const c = detectCommunities(nodes, inner, 2, { maxSize: Math.max(4, Math.ceil(memories.length / 3)), minCount: Math.min(5, Math.floor(memories.length / 4)) })
  const themes = c.galaxies
    .filter((g) => g.id !== OTHER_GALAXY)
    .map((g) => ({ id: g.id, label: g.label || g.tags[0] || 'Tema', tags: g.tags, memories: memories.filter((m) => c.of.get(m.id) === g.id).map((m) => m.id) }))
  const other = memories.filter((m) => c.of.get(m.id) === OTHER_GALAXY).map((m) => m.id)
  if (other.length) themes.push({ id: OTHER_GALAXY, label: '', tags: [], memories: other })
  // Temi in ordine di pertinenza: prima quello con i ricordi trovati più in alto nella ricerca
  // EN: Themes in order of relevance: first the one with the memories found highest in the search
  const rank = new Map(memories.map((m, i) => [m.id, i]))
  themes.sort((a, b) => Math.min(...a.memories.map((id) => rank.get(id) ?? 999)) - Math.min(...b.memories.map((id) => rank.get(id) ?? 999)))
  return {
    question,
    themes,
    memories: memories.map((m) => ({ id: m.id, title: m.title, line: lineOf(m.body), kind: m.kind, root: !!m.root, found: found.has(m.id) })),
    links: inner
  }
}

/** Risposta dell'LLM: testo con riferimenti [n], ricordi citati, nomi dei temi, "non lo so". / EN: LLM answer: text with [n] references, cited memories, theme names, "I don't know". */
export const ChatAnswer = z.object({
  answer: z.string(),
  /** Numeri dei ricordi citati nella risposta. / EN: Numbers of the memories cited in the answer. */
  cited: z.array(z.number().int()),
  /** Nome leggibile per ogni tema della mappa (id del tema → titolo breve). / EN: Readable name for each theme of the map (theme id → short title). */
  themes: z.array(z.object({ id: z.number().int(), title: z.string() })),
  /** true se i ricordi non bastano a rispondere. / EN: true if the memories are not enough to answer. */
  unknown: z.boolean()
})
export type ChatAnswer = z.infer<typeof ChatAnswer>

/**
 * Istruzioni per l'LLM. La regola principale è la FEDELTÀ: la risposta usa solo i ricordi forniti,
 * come la distillazione (prompts.ts). Una chat che inventa sarebbe peggio di nessuna chat.
 *
 * EN: Instructions for the LLM. The main rule is FAITHFULNESS: the answer only uses the provided memories,
 * like distillation (prompts.ts). A chat that makes things up would be worse than no chat at all.
 * @param language lingua delle risposte: quella della domanda, in mancanza quella del team
 *                 EN: language of the answers: the question's language, or else the team's
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
 *
 * EN: The material for the LLM: previous conversation, numbered memories, themes, question.
 * @returns il testo e la corrispondenza numero → id del ricordo
 *          EN: the text and the mapping from number → memory id
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
