// Revisione di sicurezza prima della pubblicazione (2026-10-26, 0.6.2): ogni test riproduce un
// attacco trovato e verifica che ora non riesca.
// EN: Security review before going public (2026-10-26, 0.6.2): each test reproduces an attack that
//     was found and checks that it no longer works.
import fs from 'node:fs'
import path from 'node:path'
import b4a from 'b4a'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { protectHome } from '../../src/core/paths'
import { FileShare } from '../../src/net/file-share'
import { parseJoinRequest } from '../../src/net/team-node'
import { isDocumentRef, type MicelioNode } from '../../src/node/micelio-node'
import { localDht, makeNode, published, tmpHome } from '../helpers'

describe('revisione di sicurezza 0.6.2', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  let node: MicelioNode

  beforeAll(async () => {
    dht = await localDht()
    node = makeNode('secrev', dht.bootstrap).node
    await node.start()
    await node.init('Team Revisione', 'admin')
  })

  afterAll(async () => {
    await node?.stop().catch(() => {})
    await dht?.destroy()
  })

  it('un ricordo «da documento» con un riferimento a un percorso non fa leggere file del PC', async () => {
    // L'attacco: ref `../../segreti` + nome `id_rsa` puntava fuori dalla cache dei documenti
    // EN: The attack: ref `../../segreti` + name `id_rsa` pointed outside the documents cache
    const home = (node as any).paths.home as string
    const target = path.join(home, 'sources', '../../segreti', 'id_rsa')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, '-----BEGIN OPENSSH PRIVATE KEY----- finta')
    const id = published(await node.remember({ kind: 'fact', title: 'Manuale del gestionale', body: 'Vedi il documento originale.', source: { type: 'document', ref: '../../segreti', name: 'id_rsa' } } as any)).id
    await expect(node.fetchSource(id)).rejects.toThrow(/Riferimento al documento non valido/)

    expect(isDocumentRef('a'.repeat(64))).toBe(true)
    for (const bad of ['../../.ssh', 'A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(64)}/..`, '']) expect(isDocumentRef(bad)).toBe(false)
  })

  it('richiesta d\'ingresso: dati malformati rifiutati senza eccezioni', () => {
    const key = 'b'.repeat(64)
    const req = (v: unknown) => b4a.from(typeof v === 'string' ? v : JSON.stringify(v))
    expect(parseJoinRequest(req({ key, name: 'ada' }))).toEqual({ key, name: 'ada' })
    // JSON rotto: prima faceva cadere il daemon / EN: broken JSON: it used to crash the daemon
    for (const bad of ['{ rotto', 'null', '"testo"', { key: 'zz', name: 'ada' }, { key, name: '' }, { key, name: 'x'.repeat(101) }, { key: 123, name: 'ada' }, { name: 'ada' }]) {
      expect(parseJoinRequest(req(bad))).toBeNull()
    }
    expect(parseJoinRequest(null)).toBeNull()
  })

  it('documento originale: vale solo il «sì» firmato dall\'autore, un peer qualunque non lo dirotta', async () => {
    const crypto = (await import('hypercore-crypto')).default
    const owner = crypto.keyPair()
    const ownerFeed = 'c'.repeat(64)
    const me = crypto.keyPair()
    const data = Buffer.from('contenuto del documento originale')
    const hash = (await import('node:crypto')).createHash('sha256').update(data).digest('hex')
    const files = new FileShare({
      isMember: async (writer, signer) => writer === ownerFeed && signer === b4a.toString(owner.publicKey, 'hex'),
      resolve: async () => ({ denied: 'non qui' }),
      localWriter: () => ({ memberKey: b4a.alloc(32, 1), publicKey: me.publicKey, secretKey: me.secretKey }),
      log: () => {}
    })
    // Due connessioni finte: un estraneo connesso al topic e il proprietario
    // EN: Two fake connections: an outsider connected to the topic and the owner
    const channel = () => ({ ch: { opened: true }, conn: { handshakeHash: b4a.alloc(32, Math.random() * 255) }, request: { send: () => {} }, response: { send: () => {} }, chunk: { send: () => {} } })
    const outsider = channel()
    const legit = channel()
    ;(files as any).channels.add(outsider)
    ;(files as any).channels.add(legit)
    const got = files.fetch(hash, ownerFeed)
    const id = [...(files as any).pending.keys()][0]
    // L'estraneo risponde per primo con un «sì» non firmato e un contenuto falso
    // EN: The outsider answers first with an unsigned "yes" and fake content
    ;(files as any).onResponse(outsider, { id, ok: true, name: 'falso.pdf' })
    ;(files as any).onChunk(outsider, { id, seq: 0, data: Buffer.from('falso').toString('base64'), done: true })
    // Poi il proprietario, con la firma su QUESTA connessione
    // EN: Then the owner, with the signature on THIS connection
    const payload = b4a.concat([b4a.from('micelio-file-answer'), legit.conn.handshakeHash, b4a.from(hash, 'hex')])
    const sig = crypto.sign(payload, owner.secretKey)
    ;(files as any).onResponse(legit, { id, ok: true, name: 'manuale.pdf', writer: ownerFeed, signer: b4a.toString(owner.publicKey, 'hex'), sig: b4a.toString(sig, 'hex') })
    ;(files as any).onChunk(legit, { id, seq: 0, data: data.toString('base64'), done: true })
    const r = await got
    expect(r.name).toBe('manuale.pdf')
    expect(r.data.equals(data)).toBe(true)
  })

  it('documento originale: una firma di un altro feed non basta', async () => {
    const crypto = (await import('hypercore-crypto')).default
    const intruder = crypto.keyPair()
    const me = crypto.keyPair()
    const files = new FileShare({
      isMember: async () => true, // anche se fosse un membro / EN: even if it were a member
      resolve: async () => ({ denied: 'non qui' }),
      localWriter: () => ({ memberKey: b4a.alloc(32, 1), publicKey: me.publicKey, secretKey: me.secretKey }),
      log: () => {}
    })
    const conn = { ch: { opened: true }, conn: { handshakeHash: b4a.alloc(32, 7) }, request: { send: () => {} }, response: { send: () => {} }, chunk: { send: () => {} } }
    ;(files as any).channels.add(conn)
    const hash = 'd'.repeat(64)
    const got = files.fetch(hash, 'e'.repeat(64))
    const id = [...(files as any).pending.keys()][0]
    const sig = crypto.sign(b4a.concat([b4a.from('micelio-file-answer'), conn.conn.handshakeHash, b4a.from(hash, 'hex')]), intruder.secretKey)
    ;(files as any).onResponse(conn, { id, ok: true, name: 'x', writer: 'f'.repeat(64), signer: b4a.toString(intruder.publicKey, 'hex'), sig: b4a.toString(sig, 'hex') })
    await expect(got).rejects.toThrow(/non firmata dall'autore/)
  })

  it.skipIf(process.platform === 'win32')('la cartella di Micelio è accessibile solo all\'utente (anche se esisteva già)', () => {
    const home = tmpHome('perm')
    fs.chmodSync(home, 0o755)
    protectHome(home)
    expect(fs.statSync(home).mode & 0o777).toBe(0o700)
  })

  it('su Windows la cartella resta com\'è (valgono le ACL del profilo)', () => {
    const home = path.join(tmpHome('perm-win'), 'non-creata')
    protectHome(home, 'win32')
    expect(fs.existsSync(home)).toBe(false)
  })
})
