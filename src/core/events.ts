/**
 * @file Schema degli eventi replicati nel log del team (DESIGN §4.1).
 *
 * Tutto ciò che cambia il sapere condiviso è un EVENTO immutabile, appeso al feed (Hypercore)
 * del nodo che lo scrive e replicato a tutti gli altri. Lo stato del team (la "vista") non viene
 * mai sincronizzato direttamente: ogni nodo lo ricalcola applicando gli eventi con la funzione
 * deterministica `applyNodes` (src/net/apply.ts).
 *
 * Regole che valgono per ogni evento:
 * - l'AUTORE non sta nel payload: in `apply` si ricava dal feed da cui arriva il blocco
 *   (`node.from.key`), che è firmato. Così nessuno può scrivere "a nome di" un altro nodo;
 * - ogni evento ha `v` (versione dello schema) e `ts` (orologio del nodo autore). `ts` è solo
 *   informativo: l'ORDINE degli eventi lo decide Autobase in modo causale, non gli orologi;
 * - gli schemi qui sotto sono la "lingua comune" fra versioni diverse di Micelio. Cambiarli in
 *   modo incompatibile significa che i nodi vecchi IGNORERANNO gli eventi nuovi (vedi apply.ts).
 *   Per questo i campi "aperti" (es. `source.type`) sono stringhe libere e non enum.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'

/** Tipi di ricordo ammessi (DESIGN §4.2). Usati per l'export e, in futuro, per la priorità. */
export const MEMORY_KINDS = ['fact', 'howto', 'decision', 'gotcha', 'snippet', 'reference'] as const
export const MemoryKind = z.enum(MEMORY_KINDS)
export type MemoryKind = z.infer<typeof MemoryKind>

/** Chiave pubblica di 32 byte in esadecimale (chiavi dei writer, id degli inviti). */
const hexKey = z.string().regex(/^[0-9a-f]{64}$/, 'chiave esadecimale di 32 byte')

/**
 * Un ricordo come viene proposto (da CLI, API, MCP o dalla pipeline di ingestione).
 * I `default` vengono applicati dal parse: dopo `MemoryInput.parse()` tutti i campi esistono.
 */
export const MemoryInput = z.object({
  kind: MemoryKind.default('fact'),
  /** Una riga autoesplicativa: è ciò che si vede nei risultati di ricerca. */
  title: z.string().trim().min(3).max(200),
  /** Contenuto in Markdown. Il limite evita che qualcuno replichi interi documenti nel log. */
  body: z.string().trim().min(1).max(20_000),
  /** Tag normalizzati in minuscolo, così "Angular" e "angular" coincidono nella ricerca. */
  tags: z.array(z.string().trim().toLowerCase().min(1).max(50)).max(20).default([]),
  /**
   * Da dove arriva il ricordo. `type` è una stringa libera ("cli", "mcp", "claude-code", "inbox"…)
   * e non un enum, per compatibilità in avanti: un nodo vecchio deve accettare sorgenti nuove.
   * `ref` è un riferimento opaco (es. id di sessione), MAI un percorso del disco in chiaro.
   */
  source: z.object({
    type: z.string().min(1).max(40),
    ref: z.string().max(200).optional(),
    /**
     * Solo per i ricordi distillati da un DOCUMENTO (Fase 4): nome del file (senza percorso),
     * dimensione e tipo. Con l'hash in `ref` e l'autore del ricordo (il nodo proprietario)
     * permettono di chiedere l'originale (DESIGN §12-bis). Il percorso non viene mai replicato.
     */
    name: z.string().max(200).optional(),
    size: z.number().int().nonnegative().optional(),
    mime: z.string().max(120).optional()
  }).default({ type: 'api' })
})
/** Forma accettata in ingresso (campi con default opzionali). */
export type MemoryInput = z.input<typeof MemoryInput>
/** Forma dopo il parse (tutti i campi presenti). */
export type MemoryData = z.output<typeof MemoryInput>

/** Campi comuni a tutti gli eventi (envelope). */
const base = { v: z.literal(1), ts: z.number().int().nonnegative() }

/**
 * Tutti gli eventi del team. Il campo `type` discrimina la variante.
 * Il significato e i PERMESSI di ciascuno sono implementati in src/net/apply.ts.
 */
export const TeamEvent = z.discriminatedUnion('type', [
  /** Primo evento in assoluto, scritto dal fondatore: crea il team e lo rende admin. */
  z.object({ ...base, type: z.literal('team.init'), name: z.string().min(1).max(100), founderName: z.string().min(1).max(100) }),
  /** Nuovo ricordo condiviso. Idempotente: lo stesso contenuto produce lo stesso id. */
  z.object({ ...base, type: z.literal('memory.add'), memory: MemoryInput }),
  /** Invito creato da un membro: contiene solo id e chiave pubblica, mai il segreto. */
  z.object({ ...base, type: z.literal('invite.add'), id: hexKey, publicKey: hexKey, expires: z.number().int() }),
  /** Annullamento di un invito non ancora usato. */
  z.object({ ...base, type: z.literal('invite.del'), id: hexKey }),
  /** Ingresso di un nuovo writer, scritto dal membro che ha accolto la richiesta di pairing. */
  z.object({ ...base, type: z.literal('member.add'), key: hexKey, name: z.string().min(1).max(100), inviteId: hexKey.optional() }),
  /** Espulsione (solo admin). */
  z.object({ ...base, type: z.literal('member.remove'), key: hexKey }),
  /** Promozione ad admin e indexer (solo admin). */
  z.object({ ...base, type: z.literal('member.promote'), key: hexKey }),
  /** Voto di utilità su un ricordo (Fase 5): +1 utile, -1 non utile, 0 ritira il voto. Uno per nodo. */
  z.object({ ...base, type: z.literal('memory.vote'), id: z.string().regex(/^[0-9a-f]{64}$/), delta: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }),
  /** Ricordo fissato: non decade e non viene archiviato dal dreaming (Fase 5–6). */
  z.object({ ...base, type: z.literal('memory.pin'), id: z.string().regex(/^[0-9a-f]{64}$/) }),
  z.object({ ...base, type: z.literal('memory.unpin'), id: z.string().regex(/^[0-9a-f]{64}$/) }),
  /**
   * Uso dei ricordi da parte di un nodo (DESIGN §8.3). Contatori CUMULATIVI per ricordo: in apply
   * si tiene il massimo per (ricordo, nodo), quindi rinvii e duplicati non gonfiano i conteggi
   * (è un G-Counter: ogni nodo ha il suo contatore, il totale è la somma).
   */
  z.object({ ...base, type: z.literal('usage.report'), counts: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.object({ count: z.number().int().nonnegative(), last: z.number().int().nonnegative() })) }),
  // ── Dreaming (Fase 6, DESIGN §10) ─────────────────────────────────────────────────
  /** Più ricordi sostituiti da uno nuovo (fusione di duplicati). I vecchi restano come storico. */
  z.object({ ...base, type: z.literal('memory.supersede'), old: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1).max(20), memory: MemoryInput, reason: z.string().max(500) }),
  /** Collegamento esplicito fra due ricordi (es. "si contraddicono", "approfondisce"). */
  z.object({ ...base, type: z.literal('memory.link'), from: z.string().regex(/^[0-9a-f]{64}$/), to: z.string().regex(/^[0-9a-f]{64}$/), rel: z.enum(['relates', 'refines', 'contradicts', 'depends-on']) }),
  /** Archiviazione (decadimento o obsolescenza): esce dalla ricerca, resta recuperabile. */
  z.object({ ...base, type: z.literal('memory.archive'), id: z.string().regex(/^[0-9a-f]{64}$/), reason: z.string().max(500) }),
  /** Ripristino di un ricordo archiviato o sostituito. */
  z.object({ ...base, type: z.literal('memory.restore'), id: z.string().regex(/^[0-9a-f]{64}$/) }),
  /** Un nodo dichiara di "sognare" per un'epoca: vince il primo nell'ordine linearizzato. */
  z.object({ ...base, type: z.literal('dream.claim'), epoch: z.string().min(1).max(40) }),
  /** Diario del sogno: cosa è stato consolidato, archiviato, collegato. */
  z.object({ ...base, type: z.literal('dream.complete'), epoch: z.string().min(1).max(40), summary: z.string().max(4000), stats: z.record(z.string(), z.number()) }),
  /**
   * Redazione (solo admin, DESIGN §10.3): il contenuto di un ricordo finito per errore nel team
   * viene tolto dalla vista di tutti i nodi. Best-effort: i blocchi cifrati del log restano.
   */
  z.object({ ...base, type: z.literal('memory.redact'), id: z.string().regex(/^[0-9a-f]{64}$/), reason: z.string().max(500) }),
  /** Configurazione condivisa del team, es. `memory.language` (solo admin). */
  z.object({ ...base, type: z.literal('team.config'), key: z.string().min(1).max(100), value: z.unknown() })
])
export type TeamEvent = z.infer<typeof TeamEvent>

/**
 * Payload di un evento senza i campi di envelope (`v`, `ts`), che aggiunge `envelope()`.
 * La forma con i condizionali serve a "distribuire" l'Omit su ogni variante dell'unione:
 * un semplice Omit<TeamEvent, …> perderebbe la discriminazione per `type`.
 */
export type EventPayload = TeamEvent extends infer E ? (E extends TeamEvent ? Omit<E, 'v' | 'ts'> : never) : never

/**
 * Completa un payload con l'envelope e lo valida. Va usato per OGNI evento che si appende:
 * così un bug locale non può scrivere nel log un evento che gli altri nodi scarterebbero.
 *
 * @param payload contenuto dell'evento (con `type`)
 * @param now     timestamp da usare come `ts` (iniettabile nei test)
 * @throws ZodError se il payload non rispetta lo schema
 */
export function envelope (payload: EventPayload, now = Date.now()): TeamEvent {
  return TeamEvent.parse({ ...payload, v: 1, ts: now })
}

/**
 * Id content-addressed di un ricordo (DESIGN §4.2): hash di tipo + titolo + corpo normalizzati.
 *
 * Conseguenza voluta: se due nodi salvano lo stesso ricordo (anche con spazi o maiuscole
 * diverse) producono lo stesso id e `apply` tiene solo il primo. I tag NON entrano nell'hash:
 * lo stesso contenuto con tag diversi resta un duplicato.
 */
export function memoryId (m: Pick<MemoryData, 'kind' | 'title' | 'body'>): string {
  const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  return createHash('sha256').update(`${m.kind}\n${normalize(m.title)}\n${normalize(m.body)}`).digest('hex')
}
