// Spike A — Nodo Micelio minimale: Autobase multi-writer + Hyperswarm + inviti "optimistic".
//
// Ruoli (env ROLE):
//   founder  crea il team, scrive i codici invito in /shared/invite-<nome>.txt
//   joiner   attende il proprio codice invito e entra nel team
//
// Il nodo espone una piccola API HTTP di controllo (porta env PORT, default 7300):
//   GET  /status              stato sintetico (membri, ricordi, digest, peer)
//   POST /remember {title,body}
//   POST /invite   {name}     crea un invito e lo scrive in /shared
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import Corestore from 'corestore'
import Autobase from 'autobase'
import Hyperswarm from 'hyperswarm'
import Hyperbee from 'hyperbee'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'

const NAME = process.env.NAME || 'node'
const ROLE = process.env.ROLE || 'joiner'
const PORT = Number(process.env.PORT || 7300)
const DATA = process.env.DATA || '/data'
const SHARED = process.env.SHARED || '/shared'
const BOOTSTRAP = process.env.DHT_BOOTSTRAP // es. "host:port" per testnet locale; vuoto = DHT pubblica

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), `[${NAME}]`, ...a)
const hex = (b) => b4a.toString(b, 'hex')
const sha256 = (s) => createHash('sha256').update(s).digest('hex')

// ---------- Vista deterministica ----------

function open (store) {
  return new Hyperbee(store.get('view'), { keyEncoding: 'utf-8', valueEncoding: 'json', extension: false })
}

async function apply (nodes, view, host) {
  for (const node of nodes) {
    const ev = node.value
    if (!ev) continue // ack
    const from = hex(node.from.key)

    if (ev.type === 'member.join') {
      // Blocco optimistic da un non-membro: lo accettiamo solo se l'invito è valido e non usato
      // e la firma dimostra il possesso del segreto dell'invito.
      const inv = await view.get('invite/' + ev.invite)
      if (!inv || inv.value.usedBy) continue
      if (ev.writer !== from) continue
      const ok = crypto.verify(b4a.from(ev.writer, 'hex'), b4a.from(ev.sig, 'hex'), b4a.from(ev.invite, 'hex'))
      if (!ok) continue
      await host.ackWriter(node.from.key)
      await host.addWriter(node.from.key, { indexer: false })
      await view.put('invite/' + ev.invite, { ...inv.value, usedBy: from })
      await view.put('member/' + from, { name: ev.name, role: 'member', invitedBy: inv.value.by })
      continue
    }

    // Da qui in poi solo membri
    if (!(await view.get('member/' + from))) continue

    if (ev.type === 'member.founder') {
      // ignorato: il founder viene registrato al primo blocco (vedi sotto)
    } else if (ev.type === 'invite.create') {
      await view.put('invite/' + ev.pubkey, { by: from, name: ev.name })
    } else if (ev.type === 'memory.add') {
      const id = sha256(ev.title + '\n' + ev.body)
      if (!(await view.get('memory/' + id))) {
        await view.put('memory/' + id, { title: ev.title, body: ev.body, author: from })
      }
    }
  }
}

// Il founder deve risultare membro fin dal primo apply: lo registriamo con un apply wrapper.
function makeApply (founderKeyHexPromise) {
  return async (nodes, view, host) => {
    const founder = await founderKeyHexPromise
    if (founder && !(await view.get('member/' + founder))) {
      await view.put('member/' + founder, { name: 'founder', role: 'admin', invitedBy: null })
    }
    return apply(nodes, view, host)
  }
}

// ---------- Avvio ----------

await fs.mkdir(DATA, { recursive: true })
const store = new Corestore(path.join(DATA, 'store'))
await store.ready()

let baseKey = null
let encryptionKey = null
let invite = null
const statePath = path.join(DATA, 'state.json')
const saved = await fs.readFile(statePath, 'utf8').then(JSON.parse).catch(() => null)

if (saved) {
  baseKey = saved.baseKey && b4a.from(saved.baseKey, 'hex')
  encryptionKey = b4a.from(saved.encryptionKey, 'hex')
  log('riavvio con stato salvato')
} else if (ROLE === 'founder') {
  encryptionKey = crypto.randomBytes(32)
} else {
  const file = path.join(SHARED, `invite-${NAME}.txt`)
  log('attendo invito in', file)
  while (!invite) {
    const code = await fs.readFile(file, 'utf8').catch(() => null)
    if (code) invite = JSON.parse(b4a.toString(b4a.from(code.trim(), 'base64')))
    else await new Promise((r) => setTimeout(r, 1000))
  }
  baseKey = b4a.from(invite.baseKey, 'hex')
  encryptionKey = b4a.from(invite.encryptionKey, 'hex')
}

let resolveFounder
const founderKey = new Promise((r) => { resolveFounder = r })
const base = new Autobase(store, baseKey, {
  open,
  apply: makeApply(founderKey),
  valueEncoding: 'json',
  optimistic: true,
  ackInterval: 1000,
  encryptionKey
})
await base.ready()

// Il founder è il primo writer: la sua chiave locale coincide con il bootstrap.
const founderHex = saved?.founderKey || (ROLE === 'founder' ? hex(base.local.key) : invite.founderKey)
resolveFounder(founderHex)

await fs.writeFile(statePath, JSON.stringify({
  baseKey: hex(base.key), encryptionKey: hex(encryptionKey), founderKey: founderHex
}))
log('base', hex(base.key).slice(0, 12), 'local', hex(base.local.key).slice(0, 12), 'writable', base.writable)

// ---------- Rete ----------

const swarm = new Hyperswarm(BOOTSTRAP ? { bootstrap: BOOTSTRAP.split(',').map((s) => { const [host, port] = s.split(':'); return { host, port: Number(port) } }) } : {})
swarm.on('connection', (conn, info) => {
  log('peer connesso', hex(info.publicKey).slice(0, 12))
  conn.on('error', () => {})
  // NB: base.replicate (non store.replicate, come mostra il README) aggancia anche il protocollo
  // "wakeup", che segnala agli altri peer i core dei writer attivi — inclusi i nuovi membri
  // che hanno appena scritto un blocco optimistic. Senza, i nuovi writer non vengono mai scoperti.
  base.replicate(conn)
})
const discovery = swarm.join(base.discoveryKey, { server: true, client: true })
await discovery.flushed()
log('annunciato sul topic', hex(base.discoveryKey).slice(0, 12), BOOTSTRAP ? '(DHT locale)' : '(DHT pubblica)')

// Hyperswarm rifà il lookup sul topic raramente: se un peer "ponte" cade, gli altri restano
// isolati a lungo. Rinfreschiamo la discovery spesso quando siamo isolati, di rado altrimenti.
let lastRefresh = Date.now()
setInterval(() => {
  const isolated = swarm.connections.size === 0
  if (isolated || Date.now() - lastRefresh > 60_000) {
    lastRefresh = Date.now()
    discovery.refresh({ client: true, server: true }).catch(() => {})
  }
}, 5_000).unref()

// ---------- Join via invito ----------

if (invite && !base.writable) {
  const sig = crypto.sign(base.local.key, b4a.from(invite.secret, 'hex'))
  log('invio richiesta di ingresso (optimistic)')
  await base.append({ type: 'member.join', writer: hex(base.local.key), invite: invite.pubkey, sig: hex(sig), name: NAME }, { optimistic: true })
  const t0 = Date.now()
  while (!base.writable) {
    await base.update()
    await new Promise((r) => setTimeout(r, 500))
  }
  log(`diventato writer in ${Date.now() - t0} ms`)
}

// ---------- Operazioni ----------

async function createInvite (name) {
  const kp = crypto.keyPair()
  await base.append({ type: 'invite.create', pubkey: hex(kp.publicKey), name })
  const code = b4a.toString(b4a.from(JSON.stringify({
    baseKey: hex(base.key), encryptionKey: hex(encryptionKey), founderKey: founderHex,
    pubkey: hex(kp.publicKey), secret: hex(kp.secretKey)
  })), 'base64')
  await fs.mkdir(SHARED, { recursive: true })
  await fs.writeFile(path.join(SHARED, `invite-${name}.txt`), code)
  log('invito creato per', name)
  return { name, codeLength: code.length }
}

async function status () {
  await base.update()
  const members = []
  const ids = []
  for await (const { key, value } of base.view.createReadStream({ gt: 'member/', lt: 'member0' })) members.push({ key: key.slice(7, 19), ...value })
  for await (const { key } of base.view.createReadStream({ gt: 'memory/', lt: 'memory0' })) ids.push(key.slice(7))
  return {
    name: NAME,
    writable: base.writable,
    peers: swarm.connections.size,
    members,
    memories: ids.length,
    digest: sha256(ids.join(',')).slice(0, 16)
  }
}

if (ROLE === 'founder' && !saved) {
  for (const n of (process.env.INVITE || '').split(',').filter(Boolean)) await createInvite(n)
}

// ---------- API di controllo ----------

const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => { d += c }); req.on('end', () => r(d ? JSON.parse(d) : {})) })

http.createServer(async (req, res) => {
  try {
    let out
    if (req.method === 'GET' && req.url === '/status') out = await status()
    else if (req.method === 'POST' && req.url === '/remember') {
      const { title, body } = await readBody(req)
      await base.append({ type: 'memory.add', title, body })
      out = { ok: true }
    } else if (req.method === 'POST' && req.url === '/invite') out = await createInvite((await readBody(req)).name)
    else { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out))
  } catch (err) {
    res.writeHead(500).end(String(err?.stack || err))
  }
}).listen(PORT, () => log('API di controllo su', PORT))

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => {
    log('chiusura')
    await swarm.destroy()
    await base.close()
    process.exit(0)
  })
}
