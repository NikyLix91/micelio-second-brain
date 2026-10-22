/**
 * @file Forma dei record nella vista materializzata (Hyperbee) e nelle risposte delle API.
 *
 * EN: Shape of the records in the materialized view (Hyperbee) and in the API responses.
 *
 * Questi tipi descrivono lo STATO derivato dagli eventi (src/core/events.ts). La vista vive in
 * un Hyperbee gestito da Autobase, con chiavi del tipo `memory/<id>`, `member/<chiave>`… (vedi
 * KEYS in src/net/apply.ts). Sono gli stessi oggetti che la CLI e l'API ricevono in JSON.
 *
 * EN: These types describe the STATE derived from the events (src/core/events.ts). The view lives
 * in a Hyperbee managed by Autobase, with keys like `memory/<id>`, `member/<chiave>`… (see
 * KEYS in src/net/apply.ts). They are the same objects the CLI and the API receive as JSON.
 */
import type { CodeRefs, MemoryKind, RootCategory } from './events'

/** Ruolo di un membro. Gli admin sono anche indexer di Autobase (decisione D3). / EN: Role of a member. Admins are also Autobase indexers (decision D3). */
export type Role = 'admin' | 'member'

/** Origine di un ricordo (vedi MemoryInput.source in events.ts). / EN: Source of a memory (see MemoryInput.source in events.ts). */
export interface MemorySource {
  type: string, ref?: string, name?: string, size?: number, mime?: string, code?: CodeRefs, rank?: number, batch?: number
  /** Ricordo ripristinato da un backup (B7): autore, chiave, data e team d'origine. / EN: Memory restored from a backup (B7): original author, key, date and team. */
  origin?: { author?: string, key?: string, ts?: number, team?: string }
}

/** Un ricordo del team come appare nella vista. / EN: A team memory as it appears in the view. */
export interface MemoryRecord {
  /** Id content-addressed (vedi memoryId). / EN: Content-addressed id (see memoryId). */
  id: string
  kind: MemoryKind
  title: string
  body: string
  tags: string[]
  /** Origine: per i documenti anche hash (`ref`), nome, dimensione e tipo del file originale. / EN: Source: for documents also hash (`ref`), name, size and type of the original file. */
  source: MemorySource
  /** Chiave pubblica (hex) del nodo autore, ricavata dal feed e non dal payload. / EN: Public key (hex) of the author node, taken from the feed and not from the payload. */
  author: string
  /** Timestamp del nodo autore al momento della scrittura (informativo). / EN: Author node timestamp at write time (informational). */
  ts: number
  /**
   * Stato (Fase 6): 'active' è nella ricerca; 'superseded' è stato fuso in un ricordo più nuovo
   * (`supersededBy`); 'archived' è decaduto o obsoleto. Gli ultimi due restano come storico e si
   * possono ripristinare.
   *
   * EN: Status (Phase 6): 'active' is searchable; 'superseded' was merged into a newer memory
   * (`supersededBy`); 'archived' decayed or is obsolete. The last two stay as history and can
   * be restored.
   */
  status: 'active' | 'superseded' | 'archived' | 'redacted'
  supersededBy?: string
  /** Motivo dell'archiviazione o della sostituzione. / EN: Reason for archiving or superseding. */
  statusReason?: string
  /** Redazione (B12): quando e da quale admin. Assenti nelle redazioni precedenti alla 0.6.0. / EN: Redaction (B12): when and by which admin. Missing in redactions before 0.6.0. */
  redactedAt?: number
  redactedBy?: string
}

/**
 * Conferma di un nodo di aver tolto un ricordo redatto dal proprio PC (B12, evento `redact.ack`).
 * `person` e `sig`: firma dell'identità personale (src/core/identity.ts), assenti se il nodo non ha
 * un'identità; `sig` è tenuta solo se valida.
 *
 * EN: A node's confirmation that it removed a redacted memory from its PC (B12, `redact.ack`
 * event). `person` and `sig`: signature of the personal identity (src/core/identity.ts), missing if
 * the node has no identity; `sig` is kept only if valid.
 */
export interface RedactAck {
  ts: number
  /** Cosa ha ripulito oltre a indice ed export: risposte della chat, proposte in Inbox, copie personali. / EN: What it cleaned besides index and export: chat answers, Inbox proposals, personal copies. */
  cleaned: { chat: number, inbox: number, personal: number }
  /** Backup automatici precedenti alla redazione rimasti nella cartella dei backup. / EN: Automatic backups older than the redaction left in the backup folder. */
  backups: number
  person?: string
  sig?: string
}

/** Un membro del team. I membri espulsi restano nella vista con `removed: true` (storico). / EN: A team member. Removed members stay in the view with `removed: true` (history). */
export interface MemberRecord {
  /** Chiave pubblica del writer (hex). / EN: Public key of the writer (hex). */
  key: string
  /** Nome scelto dal nodo all'ingresso (es. "pc-mario"). / EN: Name chosen by the node when joining (e.g. "pc-mario"). */
  name: string
  role: Role
  /** Chiave di chi ha CREATO l'invito usato per entrare; null per il fondatore. / EN: Key of whoever CREATED the invite used to join; null for the founder. */
  invitedBy: string | null
  removed: boolean
  joinedAt: number
  /**
   * Chiave pubblica della PERSONA (B3), uguale in tutti i team in cui è entrata dallo stesso PC.
   * Assente finché il membro non ha pubblicato `member.identity` (es. versioni precedenti).
   *
   * EN: Public key of the PERSON (B3), the same in every team they joined from the same PC.
   * Missing until the member has published `member.identity` (e.g. older versions).
   */
  person?: string
}

/** Un invito non ancora usato. Il segreto NON è qui: lo conosce solo chi ha il codice. / EN: An invite not used yet. The secret is NOT here: only whoever has the code knows it. */
export interface InviteRecord {
  /** Id dell'invito blind-pairing (hex). / EN: Blind-pairing invite id (hex). */
  id: string
  /** Chiave pubblica dell'invito: serve al membro che accoglie per aprire la richiesta. / EN: Invite public key: the welcoming member needs it to open the request. */
  publicKey: string
  /** Scadenza (epoch ms), verificata al momento del pairing. / EN: Expiry (epoch ms), checked at pairing time. */
  expires: number
  /** Chiave di chi l'ha creato. / EN: Key of its creator. */
  by: string
}

/** Metadati del team, scritti una sola volta da `team.init`. / EN: Team metadata, written only once by `team.init`. */
export interface TeamRecord {
  name: string
  /** Chiave del nodo fondatore. / EN: Key of the founder node. */
  founder: string
  createdAt: number
}

/** Un risultato di ricerca (dall'indice locale, non dalla vista). / EN: A search result (from the local index, not from the view). */
export interface RecallHit {
  id: string
  kind: MemoryKind
  title: string
  body: string
  tags: string[]
  author: string
  /** Nome dell'autore se è (stato) membro; null se sconosciuto. / EN: Author name if they are (or were) a member; null if unknown. */
  authorName: string | null
  ts: number
  /** Rilevanza: più alto = più pertinente. Confrontabile solo dentro la stessa ricerca. / EN: Relevance: higher = more relevant. Comparable only within the same search. */
  score: number
  /** Origine del ricordo (assente nei risultati che non la includono). / EN: Memory source (missing in results that do not include it). */
  source?: MemorySource
  /** Attivazione 0..1 (Fase 5): quanto il ricordo è "vivo" per il team. / EN: Activation 0..1 (Phase 5): how "alive" the memory is for the team. */
  activation?: number
  /** Somma dei voti di utilità del team. / EN: Sum of the team's usefulness votes. */
  votes?: number
  /** Usi totali nel team. / EN: Total uses in the team. */
  uses?: number
  /** Volte in cui è stato utile a un agente, nel team (B11). / EN: Times it was useful to an agent, in the team (B11). */
  useful?: number
  /** Fissato: non decade e non viene archiviato. / EN: Pinned: it does not decay and is not archived. */
  pinned?: boolean
  /** Ricordo PERSONALE (B4): sta solo su questo PC, il team non lo vede. / EN: PERSONAL memory (B4): it stays only on this PC, the team does not see it. */
  personal?: boolean
  /**
   * Il codice citato è cambiato dopo la scrittura del ricordo (B4, repository di questo PC):
   * commit successivi sui file citati e file non più presenti.
   *
   * EN: The cited code changed after the memory was written (B4, repositories on this PC):
   * later commits on the cited files and files that no longer exist.
   */
  stale?: { commits: number, missing: number }
  /** Presente se il ricordo è una Radice: categoria e stato di revisione. / EN: Present if the memory is a Root: category and review status. */
  root?: { category: RootCategory, status: 'ok' | 'review' }
  /**
   * Abituazione (B12, src/rank/habituation.ts): presente se il ricordo è stato fornito agli agenti
   * più volte di fila senza servire. `streak` = esiti senza uso dall'ultimo utile (su questo PC),
   * `factor` = quanto pesa ora nelle classifiche (1 = pieno).
   *
   * EN: Habituation (B12, src/rank/habituation.ts): present if the memory was delivered to agents
   * several times in a row without helping. `streak` = outcomes with no use since the last useful one
   * (on this PC), `factor` = how much it weighs in rankings now (1 = full).
   */
  habituation?: { streak: number, factor: number }
  /**
   * Arrivato nei risultati grazie a una sinapsi d'uso (B12): id del ricordo trovato dalla ricerca
   * che lo ha "portato con sé", perché di solito servono insieme.
   *
   * EN: Reached the results through a use synapse (B12): id of the memory found by the search that
   * "brought it along", because they're usually needed together.
   */
  broughtBy?: string
}

/** Segnalazione su una Radice: perché andrebbe rivista. / EN: Report on a Root: why it should be reviewed. */
export interface RootFlag {
  reason: string
  /** Riferimenti utili alla revisione: hash di commit, id di ricordi, nomi di documenti. / EN: References useful for the review: commit hashes, memory ids, document names. */
  refs: string[]
  /** Nodo che l'ha segnalata e quando. / EN: Node that reported it, and when. */
  by: string
  ts: number
}

/** Una lacuna di conoscenza segnalata al team (B4, src/insight/gaps.ts). / EN: A knowledge gap reported to the team (B4, src/insight/gaps.ts). */
export interface GapRecord {
  id: string
  question: string
  /** Chi l'ha segnalata per primo. / EN: Who reported it first. */
  by: string
  ts: number
  /** Tutti i membri che l'hanno segnalata (chiavi dei feed): quanti hanno lo stesso bisogno. / EN: All members who reported it (feed keys): how many share the same need. */
  askers: string[]
  status: 'open' | 'closed'
  closedBy?: string
  closedAt?: number
  /** Ricordo che la colma, se indicato. / EN: Memory that fills it, if given. */
  memory?: string
}

/**
 * Una RADICE: ricordo fondante del team (architettura, rete, interfacce, best practice,
 * policy…). Non decade, non viene archiviata né fusa dal dreaming, emerge sempre nelle ricerche
 * pertinenti. Invece di dimenticarla la si RIVEDE: la revisione (lanciata a mano) la segnala se il
 * codice o il documento d'origine sono cambiati, o se ricordi più recenti la contraddicono.
 *
 * EN: A ROOT: a foundational team memory (architecture, network, interfaces, best practices,
 * policies…). It does not decay, dreaming never archives or merges it, and it always surfaces in
 * relevant searches. Instead of being forgotten it is REVIEWED: the review (started by hand) flags
 * it if the source code or document changed, or if newer memories contradict it.
 */
export interface RootRecord {
  id: string
  category: RootCategory
  /** Chi l'ha promossa e quando. / EN: Who promoted it, and when. */
  by: string
  ts: number
  /** Ultima conferma (o promozione): le verifiche cercano cambiamenti successivi a questa data. / EN: Last confirmation (or promotion): checks look for changes after this date. */
  reviewedAt: number
  reviewedBy: string
  /** "ok" = confermata; "review" = ci sono segnalazioni da guardare. / EN: "ok" = confirmed; "review" = there are reports to look at. */
  status: 'ok' | 'review'
  flags: RootFlag[]
}

/** Stato sintetico del nodo, mostrato da `micelio status` e dalla futura UI. / EN: Short node status, shown by `micelio status` and by the future UI. */
export interface NodeStatus {
  /** Team in modalità solo locale (B4): nessuna rete, quindi nessun peer è normale. / EN: Team in local-only mode (B4): no network, so having no peers is normal. */
  localOnly?: boolean
  /** false finché il nodo non ha fatto `init` o `join`. / EN: false until the node has run `init` or `join`. */
  configured: boolean
  nodeName: string | null
  /** Chiave del writer locale (hex). / EN: Key of the local writer (hex). */
  nodeKey: string | null
  team: TeamRecord | null
  /** true se questo nodo può scrivere (è un membro accettato e non espulso). / EN: true if this node can write (it is an accepted, not removed member). */
  writable: boolean
  /** true se questo nodo partecipa al consolidamento dell'ordine (admin). / EN: true if this node takes part in consolidating the order (admin). */
  indexer: boolean
  role: Role | null
  /** Connessioni P2P attive in questo momento. / EN: P2P connections active right now. */
  peers: number
  /**
   * Relay del server del team (B8, solo con la DHT privata): se risponde (null = non ancora
   * provato) e quante connessioni sono passate da lì perché l'hole punching non riusciva.
   *
   * EN: Team server relay (B8, only with the private DHT): whether it answers (null = not probed
   * yet) and how many connections went through it because hole punching failed.
   */
  relay?: { reachable: boolean | null, attempts: number, successes: number }
  /** Membri attivi (esclusi gli espulsi). / EN: Active members (removed ones excluded). */
  members: number
  /** Ricordi presenti nell'indice locale. / EN: Memories in the local index. */
  memories: number
}
