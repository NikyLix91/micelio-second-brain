// apply è deterministica e applica i permessi anche se un client "malevolo" emette eventi vietati.
// EN: apply is deterministic and enforces permissions even if a "malicious" client emits forbidden events.
import { describe, expect, it } from 'vitest'
import { applyNodes, KEYS } from '../../src/net/apply'
import { envelope, type EventPayload } from '../../src/core/events'
import { ensureIdentity, signMembership, verifyMembership } from '../../src/core/identity'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Vista finta in memoria con la stessa interfaccia minima di Hyperbee usata da apply.
// EN: Fake in-memory view with the same minimal Hyperbee interface that apply uses.
function fakeView () {
  const data = new Map<string, unknown>()
  return {
    data,
    async get (k: string) { return data.has(k) ? { key: k, value: structuredClone(data.get(k)) } : null },
    async put (k: string, v: unknown) { data.set(k, structuredClone(v)) },
    async del (k: string) { data.delete(k) }
  }
}

function fakeHost () {
  const calls: string[] = []
  return {
    calls,
    async addWriter (k: Uint8Array, o: { indexer: boolean }) { calls.push(`add:${Buffer.from(k).toString('hex').slice(0, 4)}:${o.indexer}`) },
    async removeWriter (k: Uint8Array) { calls.push(`remove:${Buffer.from(k).toString('hex').slice(0, 4)}`) },
    removeable () { return true }
  }
}

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const node = (from: string, payload: EventPayload, ts = 1000) => ({ from: { key: Buffer.from(from, 'hex') }, value: envelope(payload, ts) })

describe('apply', () => {
  it('team.init registra il fondatore come admin, una sola volta', async () => {
    const view = fakeView(); const host = fakeHost()
    await applyNodes([node(A, { type: 'team.init', name: 'T', founderName: 'alice' }), node(B, { type: 'team.init', name: 'X', founderName: 'bob' })], view, host)
    expect((view.data.get(KEYS.team) as any).name).toBe('T')
    expect((view.data.get(KEYS.member(A)) as any).role).toBe('admin')
    expect(view.data.has(KEYS.member(B))).toBe(false)
  })

  it('ignora eventi di non-membri ed eventi malformati', async () => {
    const view = fakeView(); const host = fakeHost()
    await applyNodes([
      node(A, { type: 'team.init', name: 'T', founderName: 'alice' }),
      node(B, { type: 'memory.add', memory: { title: 'intruso', body: 'non membro' } } as any),
      { from: { key: Buffer.from(A, 'hex') }, value: { type: 'memory.add', v: 1, ts: 1 } },
      { from: { key: Buffer.from(A, 'hex') }, value: null }
    ], view, host)
    expect([...view.data.keys()].filter((k) => k.startsWith('memory/'))).toHaveLength(0)
  })

  it('member.add richiede un invito esistente e lo consuma', async () => {
    const view = fakeView(); const host = fakeHost()
    const inv = 'd'.repeat(64)
    await applyNodes([
      node(A, { type: 'team.init', name: 'T', founderName: 'alice' }),
      node(A, { type: 'member.add', key: B, name: 'bob', inviteId: inv }), // invito inesistente / EN: nonexistent invite
      node(A, { type: 'invite.add', id: inv, publicKey: 'e'.repeat(64), expires: 0 }),
      node(A, { type: 'member.add', key: B, name: 'bob', inviteId: inv }),
      node(A, { type: 'member.add', key: C, name: 'carol', inviteId: inv }) // già usato / EN: already used
    ], view, host)
    expect(view.data.has(KEYS.member(B))).toBe(true)
    expect(view.data.has(KEYS.member(C))).toBe(false)
    expect(view.data.has(KEYS.invite(inv))).toBe(false)
    expect(host.calls).toEqual(['add:bbbb:false'])
  })

  it('solo gli admin espellono e promuovono; la promozione rende indexer', async () => {
    const view = fakeView(); const host = fakeHost()
    const inv1 = '1'.repeat(64); const inv2 = '2'.repeat(64)
    await applyNodes([
      node(A, { type: 'team.init', name: 'T', founderName: 'alice' }),
      node(A, { type: 'invite.add', id: inv1, publicKey: 'e'.repeat(64), expires: 0 }),
      node(A, { type: 'member.add', key: B, name: 'bob', inviteId: inv1 }),
      node(B, { type: 'invite.add', id: inv2, publicKey: 'e'.repeat(64), expires: 0 }), // i membri possono invitare / EN: members can invite
      node(A, { type: 'member.add', key: C, name: 'carol', inviteId: inv2 }), // accolta da A, invitata da B / EN: accepted by A, invited by B
      node(C, { type: 'member.remove', key: A }), // vietato: carol non è admin / EN: forbidden: carol is not an admin
      node(B, { type: 'member.promote', key: C }), // vietato / EN: forbidden
      node(A, { type: 'member.promote', key: B }),
      node(B, { type: 'member.remove', key: C })
    ], view, host)
    expect((view.data.get(KEYS.member(A)) as any).removed).toBe(false)
    expect((view.data.get(KEYS.member(B)) as any).role).toBe('admin')
    expect((view.data.get(KEYS.member(C)) as any).invitedBy).toBe(B)
    expect((view.data.get(KEYS.member(C)) as any).removed).toBe(true)
    expect(host.calls).toEqual(['add:bbbb:false', 'add:cccc:false', 'add:bbbb:true', 'remove:cccc'])
  })

  it('memory.add è idempotente sul contenuto', async () => {
    const view = fakeView(); const host = fakeHost()
    const m = { kind: 'gotcha' as const, title: 'Titolo', body: 'Corpo' }
    await applyNodes([
      node(A, { type: 'team.init', name: 'T', founderName: 'alice' }),
      node(A, { type: 'memory.add', memory: m } as any, 1),
      node(A, { type: 'memory.add', memory: { ...m, title: '  titolo ' } } as any, 2)
    ], view, host)
    const mems = [...view.data.entries()].filter(([k]) => k.startsWith('memory/'))
    expect(mems).toHaveLength(1)
    expect((mems[0][1] as any).ts).toBe(1)
  })

  it('stessi eventi → stessa vista (determinismo)', async () => {
    const events = [
      node(A, { type: 'team.init', name: 'T', founderName: 'alice' }),
      node(A, { type: 'memory.add', memory: { title: 'uno', body: 'x' } } as any),
      node(A, { type: 'memory.add', memory: { title: 'due', body: 'y', tags: ['a'] } } as any)
    ]
    const v1 = fakeView(); const v2 = fakeView()
    await applyNodes(events, v1, fakeHost())
    await applyNodes(events, v2, fakeHost())
    expect([...v1.data.entries()]).toEqual([...v2.data.entries()])
  })

  it('member.identity: ognuno lega solo il PROPRIO feed, con una firma valida della persona', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micelio-identity-'))
    const ada = ensureIdentity(path.join(dir, 'ada.json'), 'Ada')
    const bo = ensureIdentity(path.join(dir, 'bo.json'), 'Bo')
    // la seconda chiamata non crea una nuova identità e non cambia il nome
    // EN: the second call does not create a new identity and does not change the name
    expect(ensureIdentity(path.join(dir, 'ada.json'), 'Altro nome')).toEqual(ada)
    const view = fakeView(); const host = fakeHost()
    const inv = 'd'.repeat(64)
    await applyNodes([
      node(A, { type: 'team.init', name: 'T', founderName: 'ada' }),
      node(A, { type: 'invite.add', id: inv, publicKey: 'e'.repeat(64), expires: 0 }),
      node(A, { type: 'member.add', key: B, name: 'bo', inviteId: inv }),
      // B prova ad attribuirsi l'identità di Ada: la firma di Ada copre il feed A, non B
      // EN: B tries to claim Ada's identity: Ada's signature covers feed A, not B
      node(B, { type: 'member.identity', person: ada.publicKey, sig: signMembership(ada, A) }),
      // firma di Bo, ma dichiarata come persona di Ada: non verifica
      // EN: Bo's signature, but declared as Ada's person: it does not verify
      node(B, { type: 'member.identity', person: ada.publicKey, sig: signMembership(bo, B) }),
      node(A, { type: 'member.identity', person: ada.publicKey, sig: signMembership(ada, A) }),
      node(B, { type: 'member.identity', person: bo.publicKey, sig: signMembership(bo, B) })
    ], view, host)
    expect((view.data.get(KEYS.member(A)) as any).person).toBe(ada.publicKey)
    expect((view.data.get(KEYS.member(B)) as any).person).toBe(bo.publicKey)
    // una firma fatta per un altro feed (es. lo stesso evento copiato da un altro team) non vale
    // EN: a signature made for another feed (e.g. the same event copied from another team) is not valid
    expect(verifyMembership(ada.publicKey, C, signMembership(ada, A))).toBe(false)
    expect(verifyMembership(ada.publicKey, A, 'zz')).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
