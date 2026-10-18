/**
 * @file Forma dei record nella vista materializzata (Hyperbee) e nelle risposte delle API.
 *
 * Questi tipi descrivono lo STATO derivato dagli eventi (src/core/events.ts). La vista vive in
 * un Hyperbee gestito da Autobase, con chiavi del tipo `memory/<id>`, `member/<chiave>`… (vedi
 * KEYS in src/net/apply.ts). Sono gli stessi oggetti che la CLI e l'API ricevono in JSON.
 */
import type { CodeRefs, MemoryKind, RootCategory } from './events'

/** Ruolo di un membro. Gli admin sono anche indexer di Autobase (decisione D3). */
export type Role = 'admin' | 'member'

/** Origine di un ricordo (vedi MemoryInput.source in events.ts). */
export interface MemorySource { type: string, ref?: string, name?: string, size?: number, mime?: string, code?: CodeRefs }

/** Un ricordo del team come appare nella vista. */
export interface MemoryRecord {
  /** Id content-addressed (vedi memoryId). */
  id: string
  kind: MemoryKind
  title: string
  body: string
  tags: string[]
  /** Origine: per i documenti anche hash (`ref`), nome, dimensione e tipo del file originale. */
  source: MemorySource
  /** Chiave pubblica (hex) del nodo autore, ricavata dal feed e non dal payload. */
  author: string
  /** Timestamp del nodo autore al momento della scrittura (informativo). */
  ts: number
  /**
   * Stato (Fase 6): 'active' è nella ricerca; 'superseded' è stato fuso in un ricordo più nuovo
   * (`supersededBy`); 'archived' è decaduto o obsoleto. Gli ultimi due restano come storico e si
   * possono ripristinare.
   */
  status: 'active' | 'superseded' | 'archived' | 'redacted'
  supersededBy?: string
  /** Motivo dell'archiviazione o della sostituzione. */
  statusReason?: string
}

/** Un membro del team. I membri espulsi restano nella vista con `removed: true` (storico). */
export interface MemberRecord {
  /** Chiave pubblica del writer (hex). */
  key: string
  /** Nome scelto dal nodo all'ingresso (es. "pc-mario"). */
  name: string
  role: Role
  /** Chiave di chi ha CREATO l'invito usato per entrare; null per il fondatore. */
  invitedBy: string | null
  removed: boolean
  joinedAt: number
}

/** Un invito non ancora usato. Il segreto NON è qui: lo conosce solo chi ha il codice. */
export interface InviteRecord {
  /** Id dell'invito blind-pairing (hex). */
  id: string
  /** Chiave pubblica dell'invito: serve al membro che accoglie per aprire la richiesta. */
  publicKey: string
  /** Scadenza (epoch ms), verificata al momento del pairing. */
  expires: number
  /** Chiave di chi l'ha creato. */
  by: string
}

/** Metadati del team, scritti una sola volta da `team.init`. */
export interface TeamRecord {
  name: string
  /** Chiave del nodo fondatore. */
  founder: string
  createdAt: number
}

/** Un risultato di ricerca (dall'indice locale, non dalla vista). */
export interface RecallHit {
  id: string
  kind: MemoryKind
  title: string
  body: string
  tags: string[]
  author: string
  /** Nome dell'autore se è (stato) membro; null se sconosciuto. */
  authorName: string | null
  ts: number
  /** Rilevanza: più alto = più pertinente. Confrontabile solo dentro la stessa ricerca. */
  score: number
  /** Origine del ricordo (assente nei risultati che non la includono). */
  source?: MemorySource
  /** Attivazione 0..1 (Fase 5): quanto il ricordo è "vivo" per il team. */
  activation?: number
  /** Somma dei voti di utilità del team. */
  votes?: number
  /** Usi totali nel team. */
  uses?: number
  /** Fissato: non decade e non viene archiviato. */
  pinned?: boolean
  /** Presente se il ricordo è una Radice: categoria e stato di revisione. */
  root?: { category: RootCategory, status: 'ok' | 'review' }
}

/** Segnalazione su una Radice: perché andrebbe rivista. */
export interface RootFlag {
  reason: string
  /** Riferimenti utili alla revisione: hash di commit, id di ricordi, nomi di documenti. */
  refs: string[]
  /** Nodo che l'ha segnalata e quando. */
  by: string
  ts: number
}

/**
 * Una RADICE: ricordo fondante del team (architettura, rete, interfacce, best practice,
 * policy…). Non decade, non viene archiviata né fusa dal dreaming, emerge sempre nelle ricerche
 * pertinenti. Invece di dimenticarla la si RIVEDE: la revisione (lanciata a mano) la segnala se il
 * codice o il documento d'origine sono cambiati, o se ricordi più recenti la contraddicono.
 */
export interface RootRecord {
  id: string
  category: RootCategory
  /** Chi l'ha promossa e quando. */
  by: string
  ts: number
  /** Ultima conferma (o promozione): le verifiche cercano cambiamenti successivi a questa data. */
  reviewedAt: number
  reviewedBy: string
  /** "ok" = confermata; "review" = ci sono segnalazioni da guardare. */
  status: 'ok' | 'review'
  flags: RootFlag[]
}

/** Stato sintetico del nodo, mostrato da `micelio status` e dalla futura UI. */
export interface NodeStatus {
  /** false finché il nodo non ha fatto `init` o `join`. */
  configured: boolean
  nodeName: string | null
  /** Chiave del writer locale (hex). */
  nodeKey: string | null
  team: TeamRecord | null
  /** true se questo nodo può scrivere (è un membro accettato e non espulso). */
  writable: boolean
  /** true se questo nodo partecipa al consolidamento dell'ordine (admin). */
  indexer: boolean
  role: Role | null
  /** Connessioni P2P attive in questo momento. */
  peers: number
  /** Membri attivi (esclusi gli espulsi). */
  members: number
  /** Ricordi presenti nell'indice locale. */
  memories: number
}
