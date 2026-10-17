#!/usr/bin/env node
// CLI `micelio`: amministra il nodo locale parlando con il daemon.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Command } from 'commander'
import { MEMORY_KINDS } from '../core/events'
import type { MemberRecord, NodeStatus, RecallHit } from '../core/model'
import { nodePaths, type NodePaths } from '../core/paths'
import { DaemonClient, DaemonError } from './client'

const program = new Command()
  .name('micelio')
  .description('Secondo cervello distribuito peer-to-peer per il team di sviluppo')
  .version('0.1.0')
  .option('--home <dir>', 'cartella dati del nodo (default ~/.micelio o $MICELIO_HOME)')

function paths (): NodePaths {
  const home = program.opts().home as string | undefined
  if (home) process.env.MICELIO_HOME = path.resolve(home)
  return nodePaths()
}
const client = () => new DaemonClient(paths())

const short = (k: string | null | undefined) => (k ? k.slice(0, 12) : '-')
const date = (ts: number) => new Date(ts).toISOString().replace('T', ' ').slice(0, 16)

function printStatus (s: NodeStatus): void {
  if (!s.configured) {
    console.log('Nodo non configurato. Crea un team con `micelio init <nome-team>` o entra con `micelio join <codice>`.')
    return
  }
  console.log(`Team:      ${s.team?.name ?? '(in sincronizzazione)'}`)
  console.log(`Nodo:      ${s.nodeName} (${short(s.nodeKey)})`)
  console.log(`Ruolo:     ${s.role ?? '-'}${s.indexer ? ' · indexer' : ''}${s.writable ? '' : ' · NON writer'}`)
  console.log(`Peer:      ${s.peers} connessi`)
  console.log(`Membri:    ${s.members}`)
  console.log(`Ricordi:   ${s.memories}`)
}

function printHit (h: RecallHit): void {
  console.log(`\n■ ${h.title}`)
  console.log(`  [${h.kind}] id:${h.id.slice(0, 12)} · ${h.authorName ?? short(h.author)} · ${date(h.ts)}${h.tags.length ? ' · #' + h.tags.join(' #') : ''}`)
  console.log(h.body.split('\n').map((l) => '  ' + l).join('\n'))
}

async function readStdin (): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

// ---------- Daemon ----------

program.command('daemon')
  .description('esegue il daemon in primo piano (usato da `start` e nei container)')
  .action(async () => {
    // Caricato solo qui: gli altri comandi non devono pagare l'avvio di NestJS e della rete.
    const { startDaemon } = require('../daemon/main') as typeof import('../daemon/main')
    await startDaemon(paths())
  })

program.command('start')
  .description('avvia il daemon in background')
  .action(async () => {
    const p = paths()
    const c = new DaemonClient(p)
    if (await c.health()) return console.log(`Daemon già attivo su ${c.baseUrl}`)
    fs.mkdirSync(p.logs, { recursive: true })
    const logFile = path.join(p.logs, 'daemon.log')
    const out = fs.openSync(logFile, 'a')
    const child = spawn(process.execPath, [__filename, 'daemon'], {
      detached: true,
      stdio: ['ignore', out, out],
      env: { ...process.env, MICELIO_HOME: p.home, NO_COLOR: '1' }, // log su file: niente colori ANSI
      windowsHide: true
    })
    child.unref()
    for (let i = 0; i < 60; i++) {
      if (await c.health()) return console.log(`Daemon avviato su ${c.baseUrl} (log: ${logFile})`)
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new DaemonError(`Il daemon non è partito entro 30 s: controlla ${logFile}`)
  })

program.command('stop')
  .description('ferma il daemon')
  .action(async () => {
    const c = client()
    if (!(await c.health())) return console.log('Il daemon non è in esecuzione')
    await c.call('POST', '/api/shutdown')
    console.log('Daemon in chiusura')
  })

program.command('status')
  .description('stato del nodo e del team')
  .option('--json', 'output JSON (per script)')
  .action(async (o: { json?: boolean }) => {
    const s = await client().call<NodeStatus>('GET', '/api/status')
    if (o.json) console.log(JSON.stringify(s))
    else printStatus(s)
  })

// ---------- Team ----------

program.command('init')
  .description('crea un nuovo team: questo nodo ne diventa fondatore e admin')
  .argument('<team>', 'nome del team')
  .option('-n, --name <name>', 'nome di questo nodo', os.hostname())
  .action(async (team: string, o: { name: string }) => {
    printStatus(await client().call('POST', '/api/team/init', { team, name: o.name }))
  })

program.command('join')
  .description('entra in un team con un codice d\'invito')
  .argument('<code>', 'codice d\'invito')
  .option('-n, --name <name>', 'nome di questo nodo', os.hostname())
  .action(async (code: string, o: { name: string }) => {
    console.log('In attesa che un membro del team accolga la richiesta...')
    printStatus(await client().call('POST', '/api/team/join', { code, name: o.name }))
  })

program.command('invite')
  .description('crea un codice d\'invito monouso (valido 24 ore)')
  .option('--json', 'output JSON (per script)')
  .action(async (o: { json?: boolean }) => {
    const r = await client().call<{ code: string, expires: number, replicated: boolean }>('POST', '/api/invites')
    if (o.json) return console.log(JSON.stringify(r))
    console.log('Codice d\'invito (monouso, scade il ' + date(r.expires) + '):\n')
    console.log(r.code + '\n')
    console.log('Il nuovo membro esegue:  micelio join <codice> --name <nome-nodo>')
    if (!r.replicated) console.log('\n⚠ Nessun altro membro online ha ancora ricevuto l\'invito: resta online finché il nuovo membro non è entrato.')
    console.log('Il codice è un segreto: condividilo solo con il destinatario.')
  })

program.command('invites')
  .description('inviti in attesa')
  .action(async () => {
    const list = await client().call<{ id: string, by: string, expires: number }[]>('GET', '/api/invites')
    if (!list.length) return console.log('Nessun invito in attesa')
    for (const i of list) console.log(`${i.id.slice(0, 12)}  da ${short(i.by)}  scade ${date(i.expires)}`)
  })

const members = program.command('members').description('membri del team (albero degli inviti)')
members.action(async () => {
  const list = await client().call<MemberRecord[]>('GET', '/api/members')
  const byInviter = new Map<string | null, MemberRecord[]>()
  for (const m of list) byInviter.set(m.invitedBy, [...(byInviter.get(m.invitedBy) ?? []), m])
  const print = (parent: string | null, depth: number) => {
    for (const m of (byInviter.get(parent) ?? []).sort((a, b) => a.joinedAt - b.joinedAt)) {
      const flags = [m.role === 'admin' ? 'admin' : '', m.removed ? 'ESPULSO' : ''].filter(Boolean).join(', ')
      console.log(`${'  '.repeat(depth)}${depth ? '└ ' : ''}${m.name} (${short(m.key)})${flags ? ' [' + flags + ']' : ''} · dal ${date(m.joinedAt)}`)
      print(m.key, depth + 1)
    }
  }
  print(null, 0)
})
members.command('remove').description('espelle un membro (solo admin)').argument('<membro>', 'nome o chiave (anche abbreviata)')
  .action(async (ref: string) => {
    const m = await client().call<MemberRecord>('POST', `/api/members/${encodeURIComponent(ref)}/remove`)
    console.log(`${m.name} espulso. Nota: ciò che aveva già ricevuto resta in suo possesso.`)
  })
members.command('promote').description('promuove un membro ad admin e indexer (solo admin)').argument('<membro>', 'nome o chiave (anche abbreviata)')
  .action(async (ref: string) => {
    const m = await client().call<MemberRecord>('POST', `/api/members/${encodeURIComponent(ref)}/promote`)
    console.log(`${m.name} è ora admin`)
  })

// ---------- Ricordi ----------

program.command('remember')
  .description('salva un ricordo nella memoria del team (corpo da --body o da stdin)')
  .argument('<title>', 'titolo autoesplicativo')
  .option('-b, --body <text>', 'contenuto (Markdown)')
  .option('-k, --kind <kind>', `tipo: ${MEMORY_KINDS.join(' | ')}`, 'fact')
  .option('-t, --tags <tags>', 'tag separati da virgola')
  .action(async (title: string, o: { body?: string, kind: string, tags?: string }) => {
    const body = o.body ?? (await readStdin()).trim()
    if (!body) throw new DaemonError('Serve un contenuto: usa --body "..." oppure passalo da stdin')
    const tags = o.tags ? o.tags.split(',').map((t) => t.trim()).filter(Boolean) : []
    const r = await client().call<{ id: string, duplicate: boolean }>('POST', '/api/memories', { title, body, kind: o.kind, tags })
    console.log(r.duplicate ? `Già presente (id:${r.id.slice(0, 12)})` : `Salvato (id:${r.id.slice(0, 12)})`)
  })

program.command('recall')
  .description('cerca nella memoria del team')
  .argument('<query...>', 'parole chiave')
  .option('-l, --limit <n>', 'numero massimo di risultati', '5')
  .action(async (query: string[], o: { limit: string }) => {
    const q = encodeURIComponent(query.join(' '))
    const hits = await client().call<RecallHit[]>('GET', `/api/memories/search?q=${q}&limit=${o.limit}`)
    if (!hits.length) return console.log('Nessun ricordo trovato')
    hits.forEach(printHit)
  })

program.command('get')
  .description('mostra un ricordo dato l\'id (anche abbreviato)')
  .argument('<id>')
  .action(async (id: string) => {
    const h = await client().call<RecallHit & { error?: string }>('GET', `/api/memories/${encodeURIComponent(id)}`)
    if (h.error) throw new DaemonError(`Nessun ricordo con id ${id}`)
    printHit(h)
  })

program.command('export')
  .description('percorso dell\'export Markdown in sola lettura')
  .action(() => console.log(paths().export))

// ---------- Integrazioni ----------

program.command('setup')
  .description('configura un client AI per usare Micelio via MCP')
  .argument('<client>', 'client da configurare: claude-code')
  .option('--print', 'mostra il comando senza eseguirlo')
  .action((target: string, o: { print?: boolean }) => {
    if (target !== 'claude-code') throw new DaemonError(`Client non supportato: ${target}. Disponibile: claude-code`)
    const c = client()
    const args = ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'micelio', c.mcpUrl, '--header', `Authorization: Bearer ${c.config.token}`]
    if (o.print) {
      console.log(`claude ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`)
      return
    }
    const r = spawnSync('claude', args, { stdio: 'inherit' })
    if (r.error || r.status !== 0) throw new DaemonError('Configurazione non riuscita: prova `micelio setup claude-code --print` ed esegui il comando a mano')
    console.log('\nClaude Code configurato. Il daemon deve essere attivo (`micelio start`).')
    console.log('Suggerimento: aggiungi al CLAUDE.md dei progetti una riga come\n  "Prima di task non banali cerca nella memoria del team con il tool micelio recall."')
  })

program.parseAsync().catch((err: Error) => {
  console.error(err instanceof DaemonError ? `✘ ${err.message}` : err)
  process.exit(1)
})
