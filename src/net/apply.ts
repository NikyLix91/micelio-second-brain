/**
 * @file Vista deterministica del team (DESIGN §4.3, §9).
 *
 * Autobase raccoglie i feed di tutti i membri, li ordina in modo causale (linearizzazione) e
 * passa i blocchi, in quell'ordine, alla nostra funzione `applyNodes`. Il compito di
 * `applyNodes` è trasformare gli eventi nello STATO del team, scritto in un Hyperbee (un
 * key-value store ordinato) che chiamiamo "vista".
 *
 * ┌─────────────────────────────── REGOLA D'ORO ───────────────────────────────┐
 * │ Questa funzione deve dipendere SOLO dagli eventi e dalla vista stessa.       │
 * │ Niente Date.now(), niente rete, niente file, niente variabili globali.        │
 * │ Perché: quando arrivano blocchi nuovi l'ordinamento può cambiare, e Autobase  │
 * │ ANNULLA e RIAPPLICA parte della storia. Ogni nodo, con gli stessi eventi,     │
 * │ deve arrivare esattamente alla stessa vista. Qualunque input esterno rompe    │
 * │ questa garanzia e fa divergere i nodi in modo silenzioso.                     │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * Questo è anche l'unico posto dove i PERMESSI sono definitivi: un nodo modificato può emettere
 * qualunque evento, ma se `apply` lo scarta, per il team quell'evento non esiste.
 */
import Hyperbee from 'hyperbee'
import b4a from 'b4a'
import { TeamEvent, memoryId } from '../core/events'
import type { InviteRecord, MemberRecord, MemoryRecord, TeamRecord } from '../core/model'

/**
 * Chiavi della vista. Il prefisso raggruppa i record dello stesso tipo, così si possono
 * scorrere con un range (vedi RANGES).
 */
export const KEYS = {
  team: 'team',
  member: (k: string) => `member/${k}`,
  memory: (id: string) => `memory/${id}`,
  invite: (id: string) => `invite/${id}`,
  config: (k: string) => `config/${k}`,
  /** Voto di un nodo su un ricordo (uno per nodo: l'ultimo nell'ordine linearizzato vince). */
  vote: (id: string, node: string) => `vote/${id}/${node}`,
  pin: (id: string) => `pin/${id}`,
  /** Uso di un ricordo da parte di un nodo: contatore cumulativo e ultimo uso. */
  usage: (id: string, node: string) => `usage/${id}/${node}`,
  /** Collegamento esplicito fra ricordi (dreaming). */
  link: (from: string, to: string) => `link/${from}/${to}`,
  /** Chi ha "vinto" il sogno di un'epoca. */
  dreamClaim: (epoch: string) => `dream/${epoch}`,
  /** Diario del sogno di un'epoca. */
  dreamLog: (epoch: string) => `dreamlog/${epoch}`
} as const

/**
 * Range per scorrere tutti i record di un tipo. `lt: 'member0'` funziona perché il carattere
 * '0' viene subito dopo '/' nell'ordine ASCII: il range include tutto ciò che inizia con 'member/'.
 */
export const RANGES = {
  members: { gt: 'member/', lt: 'member0' },
  memories: { gt: 'memory/', lt: 'memory0' },
  invites: { gt: 'invite/', lt: 'invite0' },
  votes: { gt: 'vote/', lt: 'vote0' },
  pins: { gt: 'pin/', lt: 'pin0' },
  usage: { gt: 'usage/', lt: 'usage0' },
  links: { gt: 'link/', lt: 'link0' },
  dreamLogs: { gt: 'dreamlog/', lt: 'dreamlog0' }
} as const

/**
 * Crea la vista. Viene chiamata da Autobase, che le passa uno store "speciale" i cui core sono
 * gestiti da lui (per poterli riavvolgere durante i riordini). Va derivata SOLO da quello store.
 * `extension: false` disattiva un'estensione di rete di Hyperbee che qui non serve.
 */
export function openView (store: any): any {
  return new Hyperbee(store.get('view'), { keyEncoding: 'utf-8', valueEncoding: 'json', extension: false })
}

const hex = (b: Uint8Array) => b4a.toString(b, 'hex') as string
const buf = (h: string) => b4a.from(h, 'hex')

/** Legge un record della vista; null se non esiste. */
async function get<T> (view: any, key: string): Promise<T | null> {
  const node = await view.get(key)
  return node ? node.value as T : null
}

/**
 * Handler `apply` di Autobase: riceve un lotto di blocchi già ordinati e aggiorna la vista.
 *
 * @param nodes blocchi linearizzati; ognuno ha `value` (il nostro evento) e `from.key` (il feed autore)
 * @param view  la vista Hyperbee creata da `openView`
 * @param host  chiamate di sistema di Autobase (addWriter, removeWriter…), anch'esse deterministiche
 */
export async function applyNodes (nodes: any[], view: any, host: any): Promise<void> {
  for (const node of nodes) {
    // I blocchi `null` sono "ack": Autobase li usa per far convergere l'ordinamento. Nessun effetto.
    if (node.value === null) continue
    // Un evento malformato, o di una versione futura che non conosciamo, viene IGNORATO.
    // Non possiamo lanciare un errore: bloccheremmo l'intero team su quel blocco.
    const parsed = TeamEvent.safeParse(node.value)
    if (!parsed.success) continue
    await applyEvent(parsed.data, hex(node.from.key), view, host)
  }
}

/**
 * Applica un singolo evento valido.
 * @param ev     evento già validato
 * @param author chiave (hex) del feed da cui arriva: l'unica identità affidabile
 */
async function applyEvent (ev: TeamEvent, author: string, view: any, host: any): Promise<void> {
  // ── team.init ──────────────────────────────────────────────────────────────────────
  // Primo evento in assoluto. Quando il fondatore crea il team è l'unico writer, quindi il suo
  // team.init è necessariamente il primo blocco linearizzato. Qualunque team.init successivo
  // (anche dello stesso fondatore) viene ignorato.
  if (ev.type === 'team.init') {
    if (await get(view, KEYS.team)) return
    const team: TeamRecord = { name: ev.name, founder: author, createdAt: ev.ts }
    const founder: MemberRecord = { key: author, name: ev.founderName, role: 'admin', invitedBy: null, removed: false, joinedAt: ev.ts }
    await view.put(KEYS.team, team)
    await view.put(KEYS.member(author), founder)
    return
  }

  // Da qui in poi l'autore deve essere un membro attivo. Questo controllo è ciò che rende
  // inutili i blocchi scritti da un nodo espulso (Autobase smette comunque di includerli,
  // ma potrebbero esserci blocchi "in volo" scritti prima che vedesse l'espulsione).
  const me = await get<MemberRecord>(view, KEYS.member(author))
  if (!me || me.removed) return
  const isAdmin = me.role === 'admin'

  switch (ev.type) {
    // ── memory.add ───────────────────────────────────────────────────────────────────
    case 'memory.add': {
      const m = ev.memory
      // I default sono già applicati da zod nel parse, ma restiamo difensivi: un nodo con uno
      // schema diverso potrebbe aver scritto un evento senza qualche campo opzionale.
      const kind = m.kind ?? 'fact'
      const id = memoryId({ kind, title: m.title, body: m.body })
      // Idempotenza: se il ricordo esiste già (stesso contenuto, anche da un altro autore)
      // si tiene il PRIMO nell'ordine linearizzato, che è lo stesso su tutti i nodi.
      if (await get(view, KEYS.memory(id))) return
      const rec: MemoryRecord = {
        id, kind, title: m.title, body: m.body, tags: m.tags ?? [], source: m.source ?? { type: 'api' },
        author, ts: ev.ts, status: 'active'
      }
      await view.put(KEYS.memory(id), rec)
      return
    }

    // ── invite.add ───────────────────────────────────────────────────────────────────
    // Qualunque membro può invitare (decisione di design). L'invito nella vista serve ai
    // membri che accoglieranno la richiesta di pairing per verificarla.
    case 'invite.add': {
      if (await get(view, KEYS.invite(ev.id))) return
      const inv: InviteRecord = { id: ev.id, publicKey: ev.publicKey, expires: ev.expires, by: author }
      await view.put(KEYS.invite(ev.id), inv)
      return
    }

    // ── invite.del ───────────────────────────────────────────────────────────────────
    // Un invito può annullarlo chi l'ha creato o un admin.
    case 'invite.del': {
      const inv = await get<InviteRecord>(view, KEYS.invite(ev.id))
      if (inv && (inv.by === author || isAdmin)) await view.del(KEYS.invite(ev.id))
      return
    }

    // ── member.add ───────────────────────────────────────────────────────────────────
    // Scritto dal membro che ha accolto la richiesta di pairing (src/net/team-node.ts,
    // onCandidate). Con un `inviteId` l'invito deve esistere: così nessun membro può aggiungere
    // writer "fuori protocollo" senza lasciare traccia, e ogni invito vale una sola volta.
    case 'member.add': {
      // invitedBy = chi ha CREATO l'invito, non chi ha accolto la richiesta: è l'informazione
      // utile per la tracciabilità ("chi ha portato dentro chi").
      let invitedBy = author
      if (ev.inviteId) {
        const inv = await get<InviteRecord>(view, KEYS.invite(ev.inviteId))
        if (!inv) return // invito inesistente o già consumato
        invitedBy = inv.by
        await view.del(KEYS.invite(ev.inviteId)) // monouso
      }
      // Un nodo già membro non si riaggiunge; un nodo ESPULSO non rientra con un nuovo invito
      // usando la stessa chiave (dovrebbe creare una nuova identità, visibile a tutti).
      if (await get<MemberRecord>(view, KEYS.member(ev.key))) return
      // Il nuovo membro è writer ma non indexer: gli indexer sono solo gli admin (D3).
      await host.addWriter(buf(ev.key), { indexer: false })
      const rec: MemberRecord = { key: ev.key, name: ev.name, role: 'member', invitedBy, removed: false, joinedAt: ev.ts }
      await view.put(KEYS.member(ev.key), rec)
      return
    }

    // ── member.remove ────────────────────────────────────────────────────────────────
    // Solo gli admin espellono. Nota: la stessa verifica è fatta anche dal nodo PRIMA di
    // emettere l'evento (MicelioNode.requireAdmin) per via degli eventi concorrenti, vedi
    // DESIGN §9 "Permessi ed eventi concorrenti".
    case 'member.remove': {
      if (!isAdmin) return
      const target = await get<MemberRecord>(view, KEYS.member(ev.key))
      if (!target || target.removed) return
      // Autobase non permette di rimuovere l'ultimo indexer (il team resterebbe senza nessuno
      // in grado di consolidare l'ordine): in quel caso l'espulsione viene ignorata.
      if (!host.removeable(buf(ev.key))) return
      await host.removeWriter(buf(ev.key))
      // Il record resta, marcato `removed`: serve allo storico e all'albero degli inviti.
      await view.put(KEYS.member(ev.key), { ...target, removed: true })
      return
    }

    // ── member.promote ───────────────────────────────────────────────────────────────
    // Admin = indexer (decisione D3): gli indexer fissano i punti di ordinamento definitivi.
    // Riaggiungere il writer con `indexer: true` è il modo in cui Autobase lo promuove.
    case 'member.promote': {
      if (!isAdmin) return
      const target = await get<MemberRecord>(view, KEYS.member(ev.key))
      if (!target || target.removed || target.role === 'admin') return
      await host.addWriter(buf(ev.key), { indexer: true })
      await view.put(KEYS.member(ev.key), { ...target, role: 'admin' })
      return
    }

    // ── memory.vote ──────────────────────────────────────────────────────────────────
    // Qualunque membro vota; un voto per nodo e per ricordo (0 = voto ritirato).
    case 'memory.vote': {
      if (!(await get(view, KEYS.memory(ev.id)))) return
      if (ev.delta === 0) await view.del(KEYS.vote(ev.id, author))
      else await view.put(KEYS.vote(ev.id, author), { delta: ev.delta, ts: ev.ts })
      return
    }

    // ── memory.pin / memory.unpin ────────────────────────────────────────────────────
    // Qualunque membro può fissare un ricordo importante; lo sblocca chi l'ha fissato o un admin.
    case 'memory.pin': {
      if (!(await get(view, KEYS.memory(ev.id)))) return
      if (!(await get(view, KEYS.pin(ev.id)))) await view.put(KEYS.pin(ev.id), { by: author, ts: ev.ts })
      return
    }
    case 'memory.unpin': {
      const pin = await get<{ by: string }>(view, KEYS.pin(ev.id))
      if (pin && (pin.by === author || isAdmin)) await view.del(KEYS.pin(ev.id))
      return
    }

    // ── usage.report ─────────────────────────────────────────────────────────────────
    // G-Counter: per ogni (ricordo, nodo autore del report) si tiene il MASSIMO dei contatori
    // cumulativi ricevuti. Report ripetuti o fuori ordine non alterano il totale.
    case 'usage.report': {
      for (const [id, u] of Object.entries(ev.counts)) {
        const key = KEYS.usage(id, author)
        const prev = await get<{ count: number, last: number }>(view, key)
        if (!prev || u.count > prev.count || u.last > prev.last) {
          await view.put(key, { count: Math.max(u.count, prev?.count ?? 0), last: Math.max(u.last, prev?.last ?? 0) })
        }
      }
      return
    }

    // ── memory.supersede (dreaming) ──────────────────────────────────────────────────
    // Fusione: il nuovo ricordo prende il posto dei vecchi. Valida solo se TUTTI i vecchi sono
    // ancora attivi e nessuno è fissato: se due nodi sognano in parallelo, vince la prima fusione
    // nell'ordine linearizzato e la seconda (che tocca ricordi già sostituiti) viene ignorata.
    case 'memory.supersede': {
      const olds: MemoryRecord[] = []
      for (const id of ev.old) {
        const o = await get<MemoryRecord>(view, KEYS.memory(id))
        if (!o || o.status !== 'active' || await get(view, KEYS.pin(id))) return
        olds.push(o)
      }
      const m = ev.memory
      const kind = m.kind ?? 'fact'
      const id = memoryId({ kind, title: m.title, body: m.body })
      if (!(await get(view, KEYS.memory(id)))) {
        await view.put(KEYS.memory(id), { id, kind, title: m.title, body: m.body, tags: m.tags ?? [], source: m.source ?? { type: 'dream' }, author, ts: ev.ts, status: 'active' } satisfies MemoryRecord)
      }
      for (const o of olds) if (o.id !== id) await view.put(KEYS.memory(o.id), { ...o, status: 'superseded', supersededBy: id, statusReason: ev.reason })
      return
    }

    // ── memory.link ──────────────────────────────────────────────────────────────────
    case 'memory.link': {
      if (ev.from === ev.to) return
      if (!(await get(view, KEYS.memory(ev.from))) || !(await get(view, KEYS.memory(ev.to)))) return
      await view.put(KEYS.link(ev.from, ev.to), { rel: ev.rel, by: author, ts: ev.ts })
      return
    }

    // ── memory.archive / memory.restore ──────────────────────────────────────────────
    // Archiviare: qualunque membro (in pratica il dreaming); mai un ricordo fissato.
    // Ripristinare: qualunque membro, da archiviato o sostituito.
    case 'memory.archive': {
      const m = await get<MemoryRecord>(view, KEYS.memory(ev.id))
      if (!m || m.status !== 'active' || await get(view, KEYS.pin(ev.id))) return
      await view.put(KEYS.memory(ev.id), { ...m, status: 'archived', statusReason: ev.reason })
      return
    }
    case 'memory.restore': {
      const m = await get<MemoryRecord>(view, KEYS.memory(ev.id))
      if (!m || m.status === 'active' || m.status === 'redacted') return
      const { supersededBy, statusReason, ...rest } = m
      void supersededBy; void statusReason
      await view.put(KEYS.memory(ev.id), { ...rest, status: 'active' })
      return
    }

    // ── memory.redact ────────────────────────────────────────────────────────────────
    // Solo admin. Titolo e corpo vengono sostituiti: nessun nodo li mostrerà più, e lo stato
    // "redacted" non si può ripristinare (restore ignora i ricordi redatti).
    case 'memory.redact': {
      if (!isAdmin) return
      const m = await get<MemoryRecord>(view, KEYS.memory(ev.id))
      if (!m || m.status === 'redacted') return
      await view.put(KEYS.memory(ev.id), { ...m, title: '[contenuto rimosso]', body: '', tags: [], status: 'redacted', statusReason: ev.reason })
      await view.del(KEYS.pin(ev.id))
      return
    }

    // ── dream.claim / dream.complete ─────────────────────────────────────────────────
    // Coordinamento (DESIGN §10.1): per ogni epoca vale solo la PRIMA rivendicazione
    // nell'ordine linearizzato, identico su tutti i nodi. Il diario è accettato solo dal vincitore.
    case 'dream.claim': {
      if (!(await get(view, KEYS.dreamClaim(ev.epoch)))) await view.put(KEYS.dreamClaim(ev.epoch), { by: author, ts: ev.ts })
      return
    }
    case 'dream.complete': {
      const claim = await get<{ by: string }>(view, KEYS.dreamClaim(ev.epoch))
      if (claim?.by !== author) return
      await view.put(KEYS.dreamLog(ev.epoch), { epoch: ev.epoch, by: author, ts: ev.ts, summary: ev.summary, stats: ev.stats })
      return
    }

    // ── team.config ──────────────────────────────────────────────────────────────────
    // Configurazione condivisa (es. memory.language, filter.blockKeywords). Solo admin.
    // Il valore è libero: chi lo legge deve validarlo.
    case 'team.config': {
      if (!isAdmin) return
      await view.put(KEYS.config(ev.key), { value: ev.value, by: author, ts: ev.ts })
    }
  }
}
