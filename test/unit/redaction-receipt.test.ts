// B12: ricevuta di redazione. Evento redact.ack in apply (solo su ricordi redatti, la prima conferma
// vale, firma tenuta solo se valida) e ricevuta (testo e JSON con firme verificabili).
// EN: B12: redaction receipt. redact.ack event in apply (only on redacted memories, the first
//     confirmation counts, signature kept only if valid) and receipt (text and JSON with verifiable
//     signatures).
import crypto from 'hypercore-crypto'
import { describe, expect, it } from 'vitest'
import { envelope, type EventPayload } from '../../src/core/events'
import { type Identity, signRedactAck, verifyRedactAck } from '../../src/core/identity'
import { buildReceipt } from '../../src/insight/redaction-receipt'
import { applyNodes, KEYS } from '../../src/net/apply'
import type { RedactionView } from '../../src/node/micelio-node'

function fakeView () {
  const data = new Map<string, unknown>()
  return {
    data,
    async get (k: string) { return data.has(k) ? { key: k, value: structuredClone(data.get(k)) } : null },
    async put (k: string, v: unknown) { data.set(k, structuredClone(v)) },
    async del (k: string) { data.delete(k) }
  }
}
const host = { async addWriter () {}, async removeWriter () {}, removeable: () => true }
const A = 'a'.repeat(64)
const MEM = 'f'.repeat(64)
const TS = 1_800_000_000_000
const ev = (payload: EventPayload, ts = TS) => ({ from: { key: Buffer.from(A, 'hex') }, value: envelope(payload, ts) })
const person = (): Identity => {
  const kp = crypto.keyPair()
  return { name: 'ada', publicKey: kp.publicKey.toString('hex'), secretKey: kp.secretKey.toString('hex') }
}
const cleaned = { chat: 2, inbox: 0, personal: 1 }

describe('redact.ack in apply', () => {
  it('vale solo per un ricordo redatto; la prima conferma resta; la firma solo se valida', async () => {
    const view = fakeView()
    await applyNodes([ev({ type: 'team.init', name: 'T', founderName: 'a' })], view, host)
    view.data.set(KEYS.memory(MEM), { id: MEM, status: 'active' })
    await applyNodes([ev({ type: 'redact.ack', id: MEM, cleaned, backups: 0 })], view, host)
    expect(view.data.has(KEYS.redactAck(MEM, A))).toBe(false) // non redatto / EN: not redacted

    view.data.set(KEYS.memory(MEM), { id: MEM, status: 'redacted' })
    const id = person()
    const good = signRedactAck(id, MEM, A, TS)
    await applyNodes([ev({ type: 'redact.ack', id: MEM, cleaned, backups: 3, person: id.publicKey, sig: good })], view, host)
    expect(view.data.get(KEYS.redactAck(MEM, A))).toEqual({ ts: TS, cleaned, backups: 3, person: id.publicKey, sig: good })
    // Seconda conferma: ignorata / EN: Second confirmation: ignored
    await applyNodes([ev({ type: 'redact.ack', id: MEM, cleaned: { chat: 0, inbox: 0, personal: 0 }, backups: 0 }, TS + 1000)], view, host)
    expect(view.data.get(KEYS.redactAck(MEM, A))).toMatchObject({ ts: TS, backups: 3 })
  })

  it('una firma non valida (altro ricordo, altro istante) non viene tenuta', async () => {
    const view = fakeView()
    await applyNodes([ev({ type: 'team.init', name: 'T', founderName: 'a' })], view, host)
    view.data.set(KEYS.memory(MEM), { id: MEM, status: 'redacted' })
    const id = person()
    const wrongTime = signRedactAck(id, MEM, A, TS - 1)
    await applyNodes([ev({ type: 'redact.ack', id: MEM, cleaned, backups: 0, person: id.publicKey, sig: wrongTime })], view, host)
    const ack = view.data.get(KEYS.redactAck(MEM, A)) as any
    expect(ack.ts).toBe(TS)
    expect(ack.sig).toBeUndefined()
  })
})

describe('ricevuta', () => {
  const id = person()
  const B = 'b'.repeat(64)
  const C = 'c'.repeat(64)
  const redaction: RedactionView = {
    id: MEM,
    reason: 'dati di un cliente',
    at: TS,
    by: { key: A, name: 'ada' },
    confirmed: 2,
    total: 3,
    members: [
      { key: A, name: 'ada', status: 'confirmed', ack: { ts: TS + 5, cleaned: { chat: 0, inbox: 0, personal: 0 }, backups: 0 } },
      { key: B, name: 'bob', status: 'confirmed', ack: { ts: TS + 9, cleaned, backups: 2, person: id.publicKey, sig: signRedactAck(id, MEM, B, TS + 9) } },
      { key: C, name: 'carol', status: 'pending', ack: null }
    ]
  }

  it('testo leggibile in italiano e in inglese, con i limiti', () => {
    const it = buildReceipt({ redaction, team: 'Ordini', by: { name: 'ada', key: A }, now: TS + 100 })
    expect(it.name).toBe(`redazione-${MEM.slice(0, 12)}`)
    expect(it.text).toContain('PC che hanno confermato: 2 su 3')
    expect(it.text).toContain('ripuliti: 2 risposte della chat, 0 proposte in Inbox, 1 copie personali')
    expect(it.text).toContain('2 backup automatici precedenti')
    expect(it.text).toContain('in attesa')
    expect(it.text).toContain('copia a mano')
    const en = buildReceipt({ redaction, team: 'Ordini', by: { name: 'ada', key: A }, now: TS + 100, lang: 'en' })
    expect(en.text).toContain('PCs that confirmed: 2 of 3')
    expect(en.text).toContain('Limits:')
  })

  it('JSON: le firme si verificano con il solo testo firmato e la chiave pubblica', () => {
    const json = buildReceipt({ redaction, team: 'Ordini', by: { name: 'ada', key: A }, now: TS + 100 }).json as any
    expect(json).toMatchObject({ format: 'micelio-redaction-receipt', version: 1, memory: MEM, confirmed: 2, total: 3 })
    const bob = json.members.find((m: any) => m.name === 'bob')
    expect(bob.signature.algorithm).toBe('ed25519')
    // Verifica indipendente, come farebbe un cliente con qualunque libreria Ed25519
    // EN: Independent check, as a customer would do with any Ed25519 library
    expect(crypto.verify(Buffer.from(bob.signature.message), Buffer.from(bob.signature.sig, 'hex'), Buffer.from(bob.signature.person, 'hex'))).toBe(true)
    expect(verifyRedactAck(bob.signature.person, MEM, B, bob.confirmedAt, bob.signature.sig)).toBe(true)
    expect(json.members.find((m: any) => m.name === 'ada').signature).toBeUndefined()
    expect(json.members.find((m: any) => m.name === 'carol')).toEqual({ name: 'carol', node: C, status: 'pending' })
  })
})
