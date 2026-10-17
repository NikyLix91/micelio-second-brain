// Vista deterministica del team (DESIGN §4.3, §9).
//
// REGOLA D'ORO: questa funzione deve dipendere SOLO dagli eventi e dalla vista. Niente orologio,
// niente rete, niente stato esterno: Autobase può annullare e riapplicare blocchi quando cambia
// l'ordinamento, e tutti i nodi devono arrivare alla stessa vista.
import Hyperbee from 'hyperbee'
import b4a from 'b4a'
import { TeamEvent, memoryId } from '../core/events'
import type { InviteRecord, MemberRecord, MemoryRecord, TeamRecord } from '../core/model'

export const KEYS = {
  team: 'team',
  member: (k: string) => `member/${k}`,
  memory: (id: string) => `memory/${id}`,
  invite: (id: string) => `invite/${id}`,
  config: (k: string) => `config/${k}`
} as const

export const RANGES = {
  members: { gt: 'member/', lt: 'member0' },
  memories: { gt: 'memory/', lt: 'memory0' },
  invites: { gt: 'invite/', lt: 'invite0' }
} as const

export function openView (store: any): any {
  return new Hyperbee(store.get('view'), { keyEncoding: 'utf-8', valueEncoding: 'json', extension: false })
}

const hex = (b: Uint8Array) => b4a.toString(b, 'hex') as string
const buf = (h: string) => b4a.from(h, 'hex')

async function get<T> (view: any, key: string): Promise<T | null> {
  const node = await view.get(key)
  return node ? node.value as T : null
}

export async function applyNodes (nodes: any[], view: any, host: any): Promise<void> {
  for (const node of nodes) {
    if (node.value === null) continue // ack di Autobase
    const parsed = TeamEvent.safeParse(node.value)
    if (!parsed.success) continue // evento malformato o di una versione futura: ignorato
    await applyEvent(parsed.data, hex(node.from.key), view, host)
  }
}

async function applyEvent (ev: TeamEvent, author: string, view: any, host: any): Promise<void> {
  // team.init: il primo evento in assoluto, scritto dal fondatore (unico writer a quel punto).
  if (ev.type === 'team.init') {
    if (await get(view, KEYS.team)) return
    const team: TeamRecord = { name: ev.name, founder: author, createdAt: ev.ts }
    const founder: MemberRecord = { key: author, name: ev.founderName, role: 'admin', invitedBy: null, removed: false, joinedAt: ev.ts }
    await view.put(KEYS.team, team)
    await view.put(KEYS.member(author), founder)
    return
  }

  // Tutto il resto richiede un autore membro attivo.
  const me = await get<MemberRecord>(view, KEYS.member(author))
  if (!me || me.removed) return
  const isAdmin = me.role === 'admin'

  switch (ev.type) {
    case 'memory.add': {
      const m = ev.memory
      const kind = m.kind ?? 'fact'
      const id = memoryId({ kind, title: m.title, body: m.body })
      if (await get(view, KEYS.memory(id))) return // idempotente: duplicati esatti ignorati
      const rec: MemoryRecord = {
        id, kind, title: m.title, body: m.body, tags: m.tags ?? [], source: m.source ?? { type: 'api' },
        author, ts: ev.ts, status: 'active'
      }
      await view.put(KEYS.memory(id), rec)
      return
    }

    case 'invite.add': {
      // Qualunque membro può invitare (decisione di design).
      if (await get(view, KEYS.invite(ev.id))) return
      const inv: InviteRecord = { id: ev.id, publicKey: ev.publicKey, expires: ev.expires, by: author }
      await view.put(KEYS.invite(ev.id), inv)
      return
    }

    case 'invite.del': {
      const inv = await get<InviteRecord>(view, KEYS.invite(ev.id))
      if (inv && (inv.by === author || isAdmin)) await view.del(KEYS.invite(ev.id))
      return
    }

    case 'member.add': {
      // Scritto dal membro che ha gestito il pairing. Se arriva tramite un invito, l'invito
      // deve esistere: così un membro non può aggiungere writer "fuori protocollo" senza traccia.
      // invitedBy è chi ha CREATO l'invito (tracciabilità), non chi ha accolto la richiesta.
      let invitedBy = author
      if (ev.inviteId) {
        const inv = await get<InviteRecord>(view, KEYS.invite(ev.inviteId))
        if (!inv) return
        invitedBy = inv.by
        await view.del(KEYS.invite(ev.inviteId)) // monouso
      }
      const existing = await get<MemberRecord>(view, KEYS.member(ev.key))
      if (existing) return // già membro (o rimosso: non si rientra con un vecchio invito)
      await host.addWriter(buf(ev.key), { indexer: false })
      const rec: MemberRecord = { key: ev.key, name: ev.name, role: 'member', invitedBy, removed: false, joinedAt: ev.ts }
      await view.put(KEYS.member(ev.key), rec)
      return
    }

    case 'member.remove': {
      if (!isAdmin) return // solo gli admin espellono
      const target = await get<MemberRecord>(view, KEYS.member(ev.key))
      if (!target || target.removed) return
      if (!host.removeable(buf(ev.key))) return // l'ultimo indexer non si può rimuovere
      await host.removeWriter(buf(ev.key))
      await view.put(KEYS.member(ev.key), { ...target, removed: true })
      return
    }

    case 'member.promote': {
      // Admin = indexer (decisione D3): fissano i punti di ordinamento definitivi.
      if (!isAdmin) return
      const target = await get<MemberRecord>(view, KEYS.member(ev.key))
      if (!target || target.removed || target.role === 'admin') return
      await host.addWriter(buf(ev.key), { indexer: true })
      await view.put(KEYS.member(ev.key), { ...target, role: 'admin' })
      return
    }

    case 'team.config': {
      if (!isAdmin) return
      await view.put(KEYS.config(ev.key), { value: ev.value, by: author, ts: ev.ts })
    }
  }
}
