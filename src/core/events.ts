/**
 * @file Schema degli eventi replicati nel log del team (DESIGN §4.1).
 *
 * EN: Schema of the events replicated in the team log (DESIGN §4.1).
 *
 * Tutto ciò che cambia il sapere condiviso è un EVENTO immutabile, appeso al feed (Hypercore)
 * del nodo che lo scrive e replicato a tutti gli altri. Lo stato del team (la "vista") non viene
 * mai sincronizzato direttamente: ogni nodo lo ricalcola applicando gli eventi con la funzione
 * deterministica `applyNodes` (src/net/apply.ts).
 *
 * EN: Everything that changes the shared knowledge is an immutable EVENT, appended to the feed
 * (Hypercore) of the node that writes it and replicated to all the others. The team state (the
 * "view") is never synchronized directly: each node recomputes it by applying the events with
 * the deterministic function `applyNodes` (src/net/apply.ts).
 *
 * Regole che valgono per ogni evento:
 * - l'AUTORE non sta nel payload: in `apply` si ricava dal feed da cui arriva il blocco
 *   (`node.from.key`), che è firmato. Così nessuno può scrivere "a nome di" un altro nodo;
 * - ogni evento ha `v` (versione dello schema) e `ts` (orologio del nodo autore). `ts` è solo
 *   informativo: l'ORDINE degli eventi lo decide Autobase in modo causale, non gli orologi;
 * - gli schemi qui sotto sono la "lingua comune" fra versioni diverse di Micelio. Cambiarli in
 *   modo incompatibile significa che i nodi vecchi IGNORERANNO gli eventi nuovi (vedi apply.ts).
 *   Per questo i campi "aperti" (es. `source.type`) sono stringhe libere e non enum.
 *
 * EN: Rules that apply to every event:
 * - the AUTHOR is not in the payload: `apply` derives it from the feed the block comes from
 *   (`node.from.key`), which is signed. So nobody can write "on behalf of" another node;
 * - every event has `v` (schema version) and `ts` (author node's clock). `ts` is informational
 *   only: the ORDER of events is decided causally by Autobase, not by clocks;
 * - the schemas below are the "common language" between different Micelio versions. Changing
 *   them incompatibly means old nodes will IGNORE the new events (see apply.ts).
 *   That's why "open" fields (e.g. `source.type`) are free strings and not enums.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { SEALED_RE } from './team-crypto'

/** Tipi di ricordo ammessi (DESIGN §4.2). Usati per l'export e, in futuro, per la priorità. / EN: Allowed memory kinds (DESIGN §4.2). Used for export and, in the future, for priority. */
export const MEMORY_KINDS = ['fact', 'howto', 'decision', 'gotcha', 'snippet', 'reference'] as const
export const MemoryKind = z.enum(MEMORY_KINDS)
export type MemoryKind = z.infer<typeof MemoryKind>

/** Chiave pubblica di 32 byte in esadecimale (chiavi dei writer, id degli inviti). / EN: 32-byte public key in hex (writer keys, invite ids). */
const hexKey = z.string().regex(/^[0-9a-f]{64}$/, 'chiave esadecimale di 32 byte')

/**
 * Categorie delle RADICI (Fase 8): il sapere fondante del team, che non deve mai essere
 * dimenticato anche se si consulta di rado. Vedi RootRecord in model.ts.
 * - architecture: paradigmi e scelte architetturali
 * - network:      mappe di rete e infrastruttura
 * - interface:    interfacce applicative, contratti, API
 * - domain:       modello di dominio
 * - practice:     best practice e regole di sviluppo (es. regole di coding con l'AI)
 * - policy:       policy di sicurezza e conformità
 * - other:        tutto il resto
 *
 * EN: ROOT categories (Phase 8): the team's foundational knowledge, which must never be
 * forgotten even if rarely consulted. See RootRecord in model.ts.
 * - architecture: paradigms and architectural choices
 * - network:      network maps and infrastructure
 * - interface:    application interfaces, contracts, APIs
 * - domain:       domain model
 * - practice:     best practices and development rules (e.g. rules for coding with AI)
 * - policy:       security and compliance policies
 * - other:        everything else
 */
export const ROOT_CATEGORIES = ['architecture', 'network', 'interface', 'domain', 'practice', 'policy', 'other'] as const
export const RootCategory = z.enum(ROOT_CATEGORIES)
export type RootCategory = z.infer<typeof RootCategory>

/** Id di un ricordo: sha256 esadecimale. / EN: Memory id: hex sha256. */
const memoryIdHex = z.string().regex(/^[0-9a-f]{64}$/)

/**
 * Riferimenti al codice di un ricordo distillato da una sessione di sviluppo: servono a chi legge
 * il ricordo (persona o agente) per decidere se e dove approfondire ("apri questi file, guarda
 * questo commit"). Tutti facoltativi: un ricordo può citare solo un file, o solo il progetto.
 *
 * EN: Code references of a memory distilled from a development session: they help whoever reads
 * the memory (person or agent) decide whether and where to dig deeper ("open these files, look
 * at this commit"). All optional: a memory may cite just one file, or just the project.
 *
 * Mai percorsi assoluti del disco (sono diversi su ogni macchina e rivelano nomi utente): i file
 * sono relativi alla radice del repository; il progetto è il nome della cartella del repository.
 *
 * EN: Never absolute disk paths (they differ on every machine and reveal user names): files are
 * relative to the repository root; the project is the name of the repository folder.
 */
export const CodeRefs = z.object({
  /** Nome del progetto (cartella radice del repository, o della cartella di lavoro). / EN: Project name (repository root folder, or the working folder). */
  project: z.string().max(200).optional(),
  /** URL del remote "origin", senza credenziali (es. https://dev.azure.com/org/prj/_git/ordini). / EN: URL of the "origin" remote, without credentials (e.g. https://dev.azure.com/org/prj/_git/ordini). */
  repo: z.string().max(300).optional(),
  /** Branch su cui si lavorava. / EN: Branch being worked on. */
  branch: z.string().max(200).optional(),
  /** File coinvolti, relativi alla radice del repository. / EN: Files involved, relative to the repository root. */
  files: z.array(z.string().max(300)).max(30).default([]),
  /** Simboli coinvolti: classi, funzioni, endpoint (es. "class OrderService", "POST /orders/confirm"). / EN: Symbols involved: classes, functions, endpoints (e.g. "class OrderService", "POST /orders/confirm"). */
  symbols: z.array(z.string().max(200)).max(30).default([]),
  /** Hash (completi) dei commit in cui la modifica è stata fatta. / EN: (Full) hashes of the commits where the change was made. */
  commits: z.array(z.string().regex(/^[0-9a-f]{7,40}$/)).max(20).default([])
})
export type CodeRefs = z.output<typeof CodeRefs>

/**
 * Un ricordo come viene proposto (da CLI, API, MCP o dalla pipeline di ingestione).
 * I `default` vengono applicati dal parse: dopo `MemoryInput.parse()` tutti i campi esistono.
 *
 * EN: A memory as it is proposed (from CLI, API, MCP or the ingestion pipeline).
 * The `default`s are applied by parse: after `MemoryInput.parse()` all fields exist.
 */
export const MemoryInput = z.object({
  kind: MemoryKind.default('fact'),
  /** Una riga autoesplicativa: è ciò che si vede nei risultati di ricerca. / EN: A self-explanatory line: it's what shows up in search results. */
  title: z.string().trim().min(3).max(200),
  /** Contenuto in Markdown. Il limite evita che qualcuno replichi interi documenti nel log. / EN: Markdown content. The limit stops anyone from replicating whole documents in the log. */
  body: z.string().trim().min(1).max(20_000),
  /** Tag normalizzati in minuscolo, così "Angular" e "angular" coincidono nella ricerca. / EN: Tags normalized to lowercase, so "Angular" and "angular" match in search. */
  tags: z.array(z.string().trim().toLowerCase().min(1).max(50)).max(20).default([]),
  /**
   * Da dove arriva il ricordo. `type` è una stringa libera ("cli", "mcp", "claude-code", "inbox"…)
   * e non un enum, per compatibilità in avanti: un nodo vecchio deve accettare sorgenti nuove.
   * `ref` è un riferimento opaco (es. id di sessione), MAI un percorso del disco in chiaro.
   *
   * EN: Where the memory comes from. `type` is a free string ("cli", "mcp", "claude-code", "inbox"…)
   * and not an enum, for forward compatibility: an old node must accept new sources.
   * `ref` is an opaque reference (e.g. session id), NEVER a plain disk path.
   */
  source: z.object({
    type: z.string().min(1).max(40),
    ref: z.string().max(200).optional(),
    /**
     * Solo per i ricordi distillati da un DOCUMENTO (Fase 4): nome del file (senza percorso),
     * dimensione e tipo. Con l'hash in `ref` e l'autore del ricordo (il nodo proprietario)
     * permettono di chiedere l'originale (DESIGN §12-bis). Il percorso non viene mai replicato.
     *
     * EN: Only for memories distilled from a DOCUMENT (Phase 4): file name (without path),
     * size and type. Together with the hash in `ref` and the memory author (the owner node)
     * they make it possible to request the original (DESIGN §12-bis). The path is never replicated.
     */
    name: z.string().max(200).optional(),
    size: z.number().int().nonnegative().optional(),
    mime: z.string().max(120).optional(),
    /**
     * Solo per i ricordi distillati da una sessione di CODICE: dove guardare per approfondire
     * (progetto, repository, branch, file, simboli, commit). Vedi CodeRefs.
     *
     * EN: Only for memories distilled from a CODE session: where to look to dig deeper
     * (project, repository, branch, files, symbols, commits). See CodeRefs.
     */
    code: CodeRefs.optional(),
    /**
     * Solo per i ricordi DISTILLATI (Fase 10): posizione nel distillato (1 = il primo) e quanti
     * ricordi aveva proposto il modello. Servono alle metriche di qualità (src/ingest/quality.ts).
     *
     * EN: Only for DISTILLED memories (Phase 10): position in the distillate (1 = the first) and how
     * many memories the model had proposed. Used by the quality metrics (src/ingest/quality.ts).
     */
    rank: z.number().int().min(1).max(100).optional(),
    batch: z.number().int().min(0).max(100).optional(),
    /**
     * Solo per i ricordi distillati da una SESSIONE (B12): fatica del capitolo da cui nascono
     * (src/ingest/effort.ts). Dà un vantaggio iniziale nell'attivazione. I nodi di versioni
     * precedenti ignorano il campo; non entra nell'id del ricordo.
     *
     * EN: Only for memories distilled from a SESSION (B12): effort of the chapter they come from
     * (src/ingest/effort.ts). It gives a head start in activation. Nodes on older versions ignore
     * the field; it isn't part of the memory id.
     */
    effort: z.object({ score: z.number().min(0).max(1), errors: z.number().int().nonnegative(), minutes: z.number().int().nonnegative() }).optional(),
    /**
     * Solo per i ricordi RIPRISTINATI da un backup (B7, src/backup): autore e data nel team
     * d'origine. L'autore per il team resta il nodo che ha ripristinato (il feed firmato non si
     * falsifica); questi dati servono a mostrare chi l'aveva scritto e a non far sembrare "nuovo"
     * un ricordo vecchio (l'attivazione usa la data d'origine). I nodi di versioni precedenti
     * ignorano il campo.
     *
     * EN: Only for memories RESTORED from a backup (B7, src/backup): author and date in the
     * original team. For the team the author stays the node that restored it (the signed feed
     * can't be forged); this data is used to show who originally wrote it and to keep an old
     * memory from looking "new" (activation uses the original date). Nodes on older versions
     * ignore the field.
     */
    origin: z.object({
      author: z.string().max(100).optional(),
      key: hexKey.optional(),
      ts: z.number().int().nonnegative().optional(),
      team: z.string().max(100).optional()
    }).optional()
  }).default({ type: 'api' })
})
/** Forma accettata in ingresso (campi con default opzionali). / EN: Accepted input shape (fields with defaults are optional). */
export type MemoryInput = z.input<typeof MemoryInput>
/** Forma dopo il parse (tutti i campi presenti). / EN: Shape after parse (all fields present). */
export type MemoryData = z.output<typeof MemoryInput>

/** Campi comuni a tutti gli eventi (envelope). / EN: Fields common to all events (envelope). */
const base = { v: z.literal(1), ts: z.number().int().nonnegative() }

/**
 * Testo sigillato con la chiave di una generazione (0.7.0, src/core/team-crypto.ts). Il limite
 * copre il ricordo più lungo cifrato e in base64.
 *
 * EN: Text sealed with a generation's key (0.7.0, src/core/team-crypto.ts). The limit covers the
 * longest memory, encrypted and in base64.
 */
const SealedText = z.string().regex(SEALED_RE).max(60_000)

/**
 * Ricordo cifrato (protezione completa, 0.7.0): resta in chiaro solo il tipo; titolo, testo, tag e
 * sorgente stanno nella busta, che è il JSON del MemoryInput sigillato. L'id lo calcola l'autore
 * sul contenuto in chiaro e va nell'evento (`id`), perché chi applica non legge il contenuto.
 *
 * EN: Encrypted memory (full protection, 0.7.0): only the kind stays in clear; title, body, tags
 * and source are in the envelope, which is the sealed JSON of the MemoryInput. The author computes
 * the id on the clear content and puts it in the event (`id`), because whoever applies doesn't read
 * the content.
 */
export const SealedMemory = z.object({ kind: MemoryKind, sealed: SealedText })
export type SealedMemory = z.output<typeof SealedMemory>

/** Consegne di una chiave: feed del membro → chiave cifrata per lui. / EN: Key grants: member's feed → key encrypted for them. */
const Grants = z.record(z.string().regex(/^[0-9a-f]{64}$/), z.string().regex(/^[A-Za-z0-9+/=]{1,200}$/)).refine((g) => Object.keys(g).length <= 1000, 'al massimo 1000 consegne')

/**
 * Tutti gli eventi del team. Il campo `type` discrimina la variante.
 * Il significato e i PERMESSI di ciascuno sono implementati in src/net/apply.ts.
 *
 * EN: All team events. The `type` field discriminates the variant.
 * The meaning and PERMISSIONS of each one are implemented in src/net/apply.ts.
 */
export const TeamEvent = z.discriminatedUnion('type', [
  /** Primo evento in assoluto, scritto dal fondatore: crea il team e lo rende admin. / EN: The very first event, written by the founder: creates the team and makes the founder admin. */
  z.object({ ...base, type: z.literal('team.init'), name: z.string().min(1).max(100), founderName: z.string().min(1).max(100) }),
  /** Nuovo ricordo condiviso. Idempotente: lo stesso contenuto produce lo stesso id. / EN: New shared memory. Idempotent: the same content produces the same id. */
  z.object({ ...base, type: z.literal('memory.add'), memory: z.union([SealedMemory, MemoryInput]), id: memoryIdHex.optional() }),
  /** Invito creato da un membro: contiene solo id e chiave pubblica, mai il segreto. / EN: Invite created by a member: holds only the id and public key, never the secret. */
  z.object({ ...base, type: z.literal('invite.add'), id: hexKey, publicKey: hexKey, expires: z.number().int() }),
  /** Annullamento di un invito non ancora usato. / EN: Revocation of an invite not yet used. */
  z.object({ ...base, type: z.literal('invite.del'), id: hexKey }),
  /** Ingresso di un nuovo writer, scritto dal membro che ha accolto la richiesta di pairing. / EN: A new writer joins, written by the member who accepted the pairing request. */
  z.object({ ...base, type: z.literal('member.add'), key: hexKey, name: z.string().min(1).max(100), inviteId: hexKey.optional() }),
  /** Espulsione (solo admin). / EN: Removal (admin only). */
  z.object({ ...base, type: z.literal('member.remove'), key: hexKey }),
  /** Promozione ad admin e indexer (solo admin). / EN: Promotion to admin and indexer (admin only). */
  z.object({ ...base, type: z.literal('member.promote'), key: hexKey }),
  /**
   * Identità personale (B3): il membro che scrive lega il PROPRIO feed alla sua persona (chiave
   * pubblica Ed25519), con una firma verificata in apply. Vedi src/core/identity.ts.
   *
   * EN: Personal identity (B3): the writing member binds THEIR OWN feed to their person (Ed25519
   * public key), with a signature verified in apply. See src/core/identity.ts.
   */
  z.object({ ...base, type: z.literal('member.identity'), person: hexKey, sig: z.string().regex(/^[0-9a-f]{128}$/) }),
  /** Voto di utilità su un ricordo (Fase 5): +1 utile, -1 non utile, 0 ritira il voto. Uno per nodo. / EN: Usefulness vote on a memory (Phase 5): +1 useful, -1 not useful, 0 withdraws the vote. One per node. */
  z.object({ ...base, type: z.literal('memory.vote'), id: z.string().regex(/^[0-9a-f]{64}$/), delta: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }),
  /** Ricordo fissato: non decade e non viene archiviato dal dreaming (Fase 5–6). / EN: Pinned memory: it doesn't decay and isn't archived by dreaming (Phases 5–6). */
  z.object({ ...base, type: z.literal('memory.pin'), id: z.string().regex(/^[0-9a-f]{64}$/) }),
  z.object({ ...base, type: z.literal('memory.unpin'), id: z.string().regex(/^[0-9a-f]{64}$/) }),
  /**
   * Uso dei ricordi da parte di un nodo (DESIGN §8.3). Contatori CUMULATIVI per ricordo: in apply
   * si tiene il massimo per (ricordo, nodo), quindi rinvii e duplicati non gonfiano i conteggi
   * (è un G-Counter: ogni nodo ha il suo contatore, il totale è la somma).
   *
   * EN: Memory usage by a node (DESIGN §8.3). CUMULATIVE counters per memory: apply keeps the
   * maximum per (memory, node), so resends and duplicates don't inflate the counts
   * (it's a G-Counter: each node has its own counter, the total is the sum).
   */
  z.object({ ...base, type: z.literal('usage.report'), counts: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.object({ count: z.number().int().nonnegative(), last: z.number().int().nonnegative() })) }),
  /**
   * Efficacia (B11): quante volte un ricordo è stato UTILE a un agente su questo nodo (confermato
   * dall'LLM alla distillazione). Stessa forma e stessa logica di usage.report (massimo per
   * ricordo e nodo). I nodi di versioni precedenti non conoscono l'evento e lo ignorano.
   *
   * EN: Effectiveness (B11): how many times a memory was USEFUL to an agent on this node (confirmed
   * by the LLM at distillation). Same shape and logic as usage.report (maximum per memory and
   * node). Nodes on older versions don't know the event and ignore it.
   */
  z.object({ ...base, type: z.literal('useful.report'), counts: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.object({ count: z.number().int().nonnegative(), last: z.number().int().nonnegative() })) }),
  /**
   * Sinapsi d'uso (B12): su questo nodo, in quante sessioni DUE ricordi sono serviti insieme.
   * Chiave "idA:idB" con idA < idB. Stessa logica di usage.report (massimo per coppia e nodo,
   * G-Counter). I nodi di versioni precedenti non conoscono l'evento e lo ignorano.
   *
   * EN: Use synapses (B12): on this node, in how many sessions TWO memories helped together.
   * Key "idA:idB" with idA < idB. Same logic as usage.report (maximum per pair and node,
   * G-Counter). Nodes on older versions don't know the event and ignore it.
   */
  z.object({ ...base, type: z.literal('couse.report'), counts: z.record(z.string().regex(/^[0-9a-f]{64}:[0-9a-f]{64}$/), z.object({ count: z.number().int().nonnegative(), last: z.number().int().nonnegative() })) }),
  // ── Dreaming (Fase 6, DESIGN §10) ─────────────────────────────────────────────────
  // EN: ── Dreaming (Phase 6, DESIGN §10) ──
  /** Più ricordi sostituiti da uno nuovo (fusione di duplicati). I vecchi restano come storico. / EN: Several memories replaced by a new one (merging duplicates). The old ones stay as history. */
  z.object({ ...base, type: z.literal('memory.supersede'), old: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1).max(20), memory: z.union([SealedMemory, MemoryInput]), id: memoryIdHex.optional(), reason: z.string().max(500) }),
  /** Collegamento esplicito fra due ricordi (es. "si contraddicono", "approfondisce"). / EN: Explicit link between two memories (e.g. "they contradict each other", "goes deeper"). */
  z.object({ ...base, type: z.literal('memory.link'), from: z.string().regex(/^[0-9a-f]{64}$/), to: z.string().regex(/^[0-9a-f]{64}$/), rel: z.enum(['relates', 'refines', 'contradicts', 'depends-on']) }),
  /** Archiviazione (decadimento o obsolescenza): esce dalla ricerca, resta recuperabile. / EN: Archiving (decay or obsolescence): it leaves search but stays recoverable. */
  z.object({ ...base, type: z.literal('memory.archive'), id: z.string().regex(/^[0-9a-f]{64}$/), reason: z.string().max(500) }),
  /** Ripristino di un ricordo archiviato o sostituito. / EN: Restore of an archived or superseded memory. */
  z.object({ ...base, type: z.literal('memory.restore'), id: z.string().regex(/^[0-9a-f]{64}$/) }),
  /** Un nodo dichiara di "sognare" per un'epoca: vince il primo nell'ordine linearizzato. / EN: A node claims it will "dream" for an epoch: the first in the linearized order wins. */
  z.object({ ...base, type: z.literal('dream.claim'), epoch: z.string().min(1).max(40) }),
  /** Diario del sogno: cosa è stato consolidato, archiviato, collegato. / EN: Dream journal: what was consolidated, archived, linked. */
  z.object({ ...base, type: z.literal('dream.complete'), epoch: z.string().min(1).max(40), summary: z.union([SealedText, z.string().max(4000)]), stats: z.record(z.string(), z.number()) }),
  /**
   * Redazione (solo admin, DESIGN §10.3): il contenuto di un ricordo finito per errore nel team
   * viene tolto dalla vista di tutti i nodi. Best-effort: i blocchi cifrati del log restano.
   *
   * EN: Redaction (admin only, DESIGN §10.3): the content of a memory that ended up in the team by
   * mistake is removed from the view of all nodes. Best-effort: the encrypted log blocks remain.
   */
  z.object({ ...base, type: z.literal('memory.redact'), id: z.string().regex(/^[0-9a-f]{64}$/), reason: z.string().max(500) }),
  /**
   * Ricevuta di redazione (B12): un nodo conferma di aver tolto dal proprio PC un ricordo redatto
   * (indice, export, chat, Inbox, copie personali) e dichiara i backup precedenti rimasti. Firmata
   * dall'identità personale se c'è. Ognuno conferma solo per sé (l'autore è chi firma il feed).
   * I nodi di versioni precedenti non conoscono l'evento e lo ignorano.
   *
   * EN: Redaction receipt (B12): a node confirms it removed a redacted memory from its PC (index,
   * export, chat, Inbox, personal copies) and declares the earlier backups left. Signed by the
   * personal identity if there is one. Everyone confirms only for themselves (the author is whoever
   * signs the feed). Nodes on older versions don't know the event and ignore it.
   */
  z.object({
    ...base,
    type: z.literal('redact.ack'),
    id: z.string().regex(/^[0-9a-f]{64}$/),
    cleaned: z.object({ chat: z.number().int().nonnegative(), inbox: z.number().int().nonnegative(), personal: z.number().int().nonnegative() }),
    backups: z.number().int().nonnegative(),
    person: hexKey.optional(),
    sig: z.string().regex(/^[0-9a-f]{128}$/).optional()
  }),
  /** Configurazione condivisa del team, es. `memory.language` (solo admin). / EN: Shared team configuration, e.g. `memory.language` (admin only). */
  z.object({ ...base, type: z.literal('team.config'), key: z.string().min(1).max(100), value: z.unknown() }),
  // ── Radici (Fase 8) ───────────────────────────────────────────────────────────────
  // Qualunque membro può promuovere, togliere, segnalare e confermare (decisione dell'utente:
  // sono best practice che ogni sviluppatore deve conoscere, non segreti). I nodi di versioni
  // precedenti non conoscono questi eventi e li ignorano: per loro le Radici non esistono.
  // EN: ── Roots (Phase 8) ──
  //     Any member can promote, remove, flag and confirm (the user's decision: they are best
  //     practices every developer must know, not secrets). Nodes on older versions don't know
  //     these events and ignore them: for them Roots don't exist.
  /** Promuove un ricordo a Radice, o ne cambia la categoria. / EN: Promotes a memory to Root, or changes its category. */
  z.object({ ...base, type: z.literal('root.set'), id: memoryIdHex, category: RootCategory }),
  /** Il ricordo torna normale (decade e si archivia come gli altri). / EN: The memory goes back to normal (it decays and gets archived like the others). */
  z.object({ ...base, type: z.literal('root.unset'), id: memoryIdHex }),
  /**
   * Segnala una Radice come "da rivedere" (revisione lanciata a mano): codice o documento
   * d'origine cambiati, ricordi più recenti che la contraddicono. `refs`: commit, id di ricordi…
   *
   * EN: Flags a Root as "to review" (review started by hand): source code or document changed,
   * newer memories that contradict it. `refs`: commits, memory ids…
   */
  z.object({ ...base, type: z.literal('root.flag'), id: memoryIdHex, reason: z.union([SealedText, z.string().min(1).max(500)]), refs: z.array(z.string().max(100)).max(20).default([]) }),
  /** Radice rivista e confermata: le segnalazioni si azzerano e la data di revisione riparte. / EN: Root reviewed and confirmed: flags are cleared and the review date restarts. */
  z.object({ ...base, type: z.literal('root.confirm'), id: memoryIdHex }),
  // ── Lacune di conoscenza (B4) ─────────────────────────────────────────────────────
  // EN: ── Knowledge gaps (B4) ──
  /**
   * Una domanda a cui la memoria del team non sa rispondere, segnalata da un membro. La stessa
   * domanda segnalata da altri (stesso id, vedi src/insight/gaps.ts) aggiunge chi la condivide.
   *
   * EN: A question the team memory can't answer, reported by a member. The same question
   * reported by others (same id, see src/insight/gaps.ts) adds who shares it.
   */
  z.object({ ...base, type: z.literal('gap.report'), id: hexKey, question: z.union([SealedText, z.string().trim().min(3).max(300)]) }),
  /** Lacuna colmata (facoltativamente dal ricordo indicato) o non più utile. Qualunque membro. / EN: Knowledge gap filled (optionally by the given memory) or no longer relevant. Any member. */
  z.object({ ...base, type: z.literal('gap.close'), id: hexKey, memory: memoryIdHex.optional() }),

  // ── Protezione completa: chiavi per generazione (0.7.0, src/core/team-crypto.ts) ──────
  // EN: Full protection: per-generation keys (0.7.0, src/core/team-crypto.ts)
  /**
   * Chiave pubblica X25519 del membro che scrive, per ricevere le chiavi di generazione, con la
   * versione dell'app: un membro senza questo evento ha una versione precedente alla 0.7.0.
   *
   * EN: X25519 public key of the writing member, to receive generation keys, with the app version:
   * a member without this event runs a version older than 0.7.0.
   */
  z.object({ ...base, type: z.literal('member.boxkey'), pk: hexKey, version: z.string().max(40).optional() }),
  /**
   * Nuova generazione (solo admin): la chiave consegnata a ogni membro attivo e, dalla seconda in
   * poi, la precedente cifrata con la nuova (`prev`). Vale solo la generazione successiva a quella
   * corrente: fra due rotazioni concorrenti vince la prima nel registro.
   *
   * EN: New generation (admins only): the key handed to every active member and, from the second
   * on, the previous one encrypted with the new one (`prev`). Only the generation right after the
   * current one counts: between two concurrent rotations the first in the log wins.
   */
  z.object({ ...base, type: z.literal('keys.rotate'), gen: z.number().int().min(1).max(1e9), grants: Grants, prev: SealedText.optional() }),
  /** Consegna della chiave corrente a membri che non l'hanno (chi è appena entrato). / EN: Handing the current key to members who lack it (newcomers). */
  z.object({ ...base, type: z.literal('keys.grant'), gen: z.number().int().min(1).max(1e9), grants: Grants })
])
export type TeamEvent = z.infer<typeof TeamEvent>

/**
 * Payload di un evento senza i campi di envelope (`v`, `ts`), che aggiunge `envelope()`.
 * La forma con i condizionali serve a "distribuire" l'Omit su ogni variante dell'unione:
 * un semplice Omit<TeamEvent, …> perderebbe la discriminazione per `type`.
 *
 * EN: Event payload without the envelope fields (`v`, `ts`), which `envelope()` adds.
 * The conditional form "distributes" the Omit over each variant of the union:
 * a plain Omit<TeamEvent, …> would lose the discrimination by `type`.
 */
export type EventPayload = TeamEvent extends infer E ? (E extends TeamEvent ? Omit<E, 'v' | 'ts'> : never) : never

/**
 * Completa un payload con l'envelope e lo valida. Va usato per OGNI evento che si appende:
 * così un bug locale non può scrivere nel log un evento che gli altri nodi scarterebbero.
 *
 * EN: Completes a payload with the envelope and validates it. Use it for EVERY appended event:
 * this way a local bug can't write to the log an event that the other nodes would discard.
 *
 * @param payload contenuto dell'evento (con `type`)
 *                EN: event content (with `type`)
 * @param now     timestamp da usare come `ts` (iniettabile nei test)
 *                EN: timestamp to use as `ts` (injectable in tests)
 * @throws ZodError se il payload non rispetta lo schema
 *         EN: if the payload doesn't match the schema
 */
export function envelope (payload: EventPayload, now = Date.now()): TeamEvent {
  return TeamEvent.parse({ ...payload, v: 1, ts: now })
}

/**
 * Id content-addressed di un ricordo (DESIGN §4.2): hash di tipo + titolo + corpo normalizzati.
 *
 * EN: Content-addressed memory id (DESIGN §4.2): hash of normalized kind + title + body.
 *
 * Conseguenza voluta: se due nodi salvano lo stesso ricordo (anche con spazi o maiuscole
 * diverse) producono lo stesso id e `apply` tiene solo il primo. I tag NON entrano nell'hash:
 * lo stesso contenuto con tag diversi resta un duplicato.
 *
 * EN: Intended consequence: if two nodes save the same memory (even with different spacing or
 * casing) they produce the same id and `apply` keeps only the first. Tags are NOT part of the
 * hash: the same content with different tags is still a duplicate.
 */
export function memoryId (m: Pick<MemoryData, 'kind' | 'title' | 'body'>): string {
  const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  return createHash('sha256').update(`${m.kind}\n${normalize(m.title)}\n${normalize(m.body)}`).digest('hex')
}
