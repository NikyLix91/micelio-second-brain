#!/usr/bin/env node
/**
 * @file CLI `micelio`: amministra il nodo locale.
 *
 * Quasi tutti i comandi sono client HTTP del daemon (vedi client.ts). Fanno eccezione:
 * - `daemon`: È il daemon (avvia NestJS in primo piano);
 * - `start`:  lancia `micelio daemon` in background e attende che risponda;
 * - `hook`:   chiamato da Claude Code a fine sessione; deve essere velocissimo e non fallire mai;
 * - `setup`:  modifica la configurazione dei client AI (MCP + hook).
 *
 * Ordine dei comandi nel file = ordine in cui compaiono in `micelio --help`.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Command } from 'commander'
import { MEMORY_KINDS } from '../core/events'
import type { MemberRecord, NodeStatus, RecallHit } from '../core/model'
import { nodePaths, type NodePaths } from '../core/paths'
import type { ExplicitOutcome } from '../ingest/pipeline'
import type { IngestStatus } from '../node/micelio-node'
import type { Decision, InboxItem } from '../store/private-store'
import { DaemonClient, DaemonError } from './client'

const program = new Command()
  .name('micelio')
  .description('Secondo cervello distribuito peer-to-peer per il team di sviluppo')
  .version('0.2.0')
  .option('--home <dir>', 'cartella dati del nodo (default ~/.micelio o $MICELIO_HOME)')

// ═══════════════════════════════ Utilità ═══════════════════════════════

/** Percorsi del nodo, tenendo conto di `--home`. Va chiamata dentro le action (dopo il parse). */
function paths (): NodePaths {
  const home = program.opts().home as string | undefined
  if (home) process.env.MICELIO_HOME = path.resolve(home)
  return nodePaths()
}
const client = () => new DaemonClient(paths())

/** Prime 12 cifre di una chiave: abbastanza per riconoscerla, abbastanza corte da leggere. */
const short = (k: string | null | undefined) => (k ? k.slice(0, 12) : '-')
/** Data leggibile "AAAA-MM-GG HH:MM" (UTC). */
const date = (ts: number) => new Date(ts).toISOString().replace('T', ' ').slice(0, 16)
/** Indenta un testo multi-riga. */
const indent = (s: string, pad = '  ') => s.split('\n').map((l) => pad + l).join('\n')

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
  console.log(indent(h.body))
}

/** Stampa l'esito di un salvataggio esplicito, mostrando sempre il testo salvato (D6). */
function printOutcome (r: ExplicitOutcome): void {
  switch (r.outcome) {
    case 'team':
      console.log(`${r.duplicate ? 'Già presente' : '✔ Pubblicato nel team'} (id:${r.id.slice(0, 12)})`)
      console.log(indent(`${r.memory.title}\n${r.memory.body}`))
      break
    case 'inbox':
      console.log(`⏸ In inbox per una verifica (id: ${r.inboxId})\n  Motivo: ${r.reason}`)
      console.log(`  Approva con: micelio inbox approve ${r.inboxId}`)
      break
    case 'private':
      console.log(`🔒 Non pubblicato, trattenuto come privato.\n  Motivo: ${r.reason}`)
  }
}

/** Legge tutto lo stdin (se non è un terminale interattivo). */
async function readStdin (): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

// ═══════════════════════════════ Daemon ═══════════════════════════════

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
    // Rilanciamo questo stesso script con il comando `daemon`, staccato dal terminale.
    const child = spawn(process.execPath, [__filename, 'daemon'], {
      detached: true,
      stdio: ['ignore', out, out],
      env: { ...process.env, MICELIO_HOME: p.home, NO_COLOR: '1' }, // log su file: niente colori ANSI
      windowsHide: true
    })
    child.unref()
    // Attende fino a 30 s che il daemon risponda (apertura dei feed, annuncio sulla DHT…).
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

// ═══════════════════════════════ Team ═══════════════════════════════

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
    // Vedi TeamNode.createInvite: senza replica, solo questo nodo può accogliere il nuovo membro.
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
  // Raggruppa per "chi ha invitato" e stampa ricorsivamente partendo dal fondatore (invitedBy = null).
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

const team = program.command('team').description('impostazioni condivise del team')
team.command('config')
  .description('imposta una configurazione di team (solo admin), es. memory.language en')
  .argument('<key>', 'memory.language | filter.blockKeywords')
  .argument('<value>', 'valore; JSON accettato (es. \'["parola1","parola2"]\')')
  .action(async (key: string, value: string) => {
    // Se il valore è JSON valido lo usiamo come tale (array, numeri…), altrimenti come stringa.
    let parsed: unknown = value
    try { parsed = JSON.parse(value) } catch {}
    await client().call('POST', '/api/team/config', { key, value: parsed })
    console.log(`${key} = ${JSON.stringify(parsed)} (replicato a tutto il team)`)
  })

// ═══════════════════════════════ Ricordi ═══════════════════════════════

program.command('remember')
  .description('propone un ricordo per il team (passa dal filtro privacy); corpo da --body o da stdin')
  .argument('<title>', 'titolo autoesplicativo')
  .option('-b, --body <text>', 'contenuto (Markdown)')
  .option('-k, --kind <kind>', `tipo: ${MEMORY_KINDS.join(' | ')}`, 'fact')
  .option('-t, --tags <tags>', 'tag separati da virgola')
  .action(async (title: string, o: { body?: string, kind: string, tags?: string }) => {
    const body = o.body ?? (await readStdin()).trim()
    if (!body) throw new DaemonError('Serve un contenuto: usa --body "..." oppure passalo da stdin')
    const tags = o.tags ? o.tags.split(',').map((t) => t.trim()).filter(Boolean) : []
    printOutcome(await client().call<ExplicitOutcome>('POST', '/api/memories', { title, body, kind: o.kind, tags }))
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

// ═══════════════════════════════ Inbox e privato ═══════════════════════════════

const inbox = program.command('inbox').description('ricordi in attesa di una tua decisione (solo i casi dubbi)')
inbox.action(async () => {
  const items = await client().call<InboxItem[]>('GET', '/api/inbox')
  if (!items.length) return console.log('Inbox vuota')
  for (const i of items) {
    console.log(`\n[${i.id}] ${i.memory.title}`)
    console.log(`  motivo: ${i.reason} · fonte: ${i.source.type} · scade ${date(i.expires)}`)
    console.log(indent(i.memory.body, '    '))
  }
  console.log('\nmicelio inbox approve <id> [--title …] [--body …]   |   micelio inbox reject <id>')
})
inbox.command('approve').description('pubblica nel team (eventualmente correggendo titolo/corpo)').argument('<id>')
  .option('--title <title>', 'titolo corretto')
  .option('--body <body>', 'corpo corretto')
  .action(async (id: string, o: { title?: string, body?: string }) => {
    const r = await client().call<{ id: string, memory: { title: string, body: string } }>('POST', `/api/inbox/${encodeURIComponent(id)}/approve`, { title: o.title, body: o.body })
    console.log(`✔ Pubblicato nel team (id:${r.id.slice(0, 12)})\n${indent(`${r.memory.title}\n${r.memory.body}`)}`)
  })
inbox.command('reject').description('scarta: non verrà condiviso').argument('<id>')
  .action(async (id: string) => {
    await client().call('POST', `/api/inbox/${encodeURIComponent(id)}/reject`)
    console.log('Scartato')
  })

program.command('private')
  .description('registro locale di ciò che NON è andato al team e perché')
  .option('-l, --limit <n>', 'numero di righe', '30')
  .action(async (o: { limit: string }) => {
    const list = await client().call<Decision[]>('GET', `/api/decisions?limit=${o.limit}`)
    if (!list.length) return console.log('Registro vuoto')
    for (const d of list) console.log(`${date(d.created)}  ${d.outcome.padEnd(9)} ${d.source.type.padEnd(11)} ${d.preview}\n${' '.repeat(18)}↳ ${d.reason}`)
  })

// ═══════════════════════════════ Ingestione automatica ═══════════════════════════════

const watch = program.command('watch').description('cartelle in cui le sessioni di Claude Code vengono raccolte (opt-in)')
watch.action(async () => {
  const list = await client().call<string[]>('GET', '/api/watch')
  console.log(list.length ? list.join('\n') : 'Nessuna cartella abilitata: usa `micelio watch add <cartella>`')
})
watch.command('add').description('abilita la raccolta per una cartella (e sottocartelle)').argument('[dir]', 'cartella', '.')
  .action(async (dir: string) => {
    const list = await client().call<string[]>('POST', '/api/watch', { path: path.resolve(dir) })
    console.log('Cartelle abilitate:\n' + list.join('\n'))
  })
watch.command('remove').description('disabilita la raccolta per una cartella').argument('[dir]', 'cartella', '.')
  .action(async (dir: string) => {
    const list = await client().call<string[]>('DELETE', '/api/watch', { path: path.resolve(dir) })
    console.log(list.length ? 'Cartelle abilitate:\n' + list.join('\n') : 'Nessuna cartella abilitata')
  })

const ingest = program.command('ingest').description('stato e controllo della raccolta automatica')
ingest.command('status').description('LLM, budget, coda, inbox')
  .action(async () => {
    const s = await client().call<IngestStatus>('GET', '/api/ingest/status')
    console.log(`LLM:       ${s.llm ? `${s.llm.adapter} (${s.llm.available ? 'disponibile' : 'NON disponibile'}) · oggi ${s.llm.budget.used}/${s.llm.budget.limit} chiamate` : 'nessuno (i casi dubbi vanno in inbox)'}`)
    console.log(`Coda:      ${Object.entries(s.jobs).map(([k, v]) => `${k} ${v}`).join(', ') || 'vuota'}`)
    console.log(`Inbox:     ${s.inbox}`)
    console.log(`Cartelle:  ${s.watched.length ? s.watched.join(', ') : 'nessuna'}`)
  })
ingest.command('run').description('elabora subito il prossimo lavoro in coda')
  .action(async () => {
    const r = await client().call<{ processed: boolean }>('POST', '/api/ingest/run', undefined, 600_000)
    console.log(r.processed ? 'Elaborato un lavoro' : 'Coda vuota')
  })

// ═══════════════════════════════ Hook ═══════════════════════════════

/**
 * Chiamato da Claude Code alla fine di ogni sessione (hook SessionEnd), con un JSON su stdin:
 * { session_id, transcript_path, cwd, hook_event_name, reason }.
 *
 * Regole: deve terminare in fretta, non stampare nulla e NON fallire mai (exit 0 sempre):
 * un errore qui disturberebbe l'utente di Claude Code per un problema di Micelio.
 */
program.command('hook')
  .description('(interno) hook per Claude Code')
  .argument('<event>', 'session-end')
  .action(async (event: string) => {
    try {
      // Anti-loop: le sessioni lanciate da Micelio stesso per classificare/distillare non si raccolgono.
      if (process.env.MICELIO_INTERNAL || event !== 'session-end') return
      const raw = await Promise.race([readStdin(), new Promise<string>((r) => setTimeout(() => r(''), 2000))])
      const input = JSON.parse(raw || '{}')
      if (!input.session_id || !input.transcript_path) return
      await client().call('POST', '/api/ingest/session', {
        session_id: input.session_id, transcript_path: input.transcript_path, cwd: input.cwd ?? process.cwd()
      }, 3000)
    } catch {
      // Silenzio voluto: daemon spento o errore → semplicemente la sessione non viene raccolta.
    }
  })

// ═══════════════════════════════ Integrazioni ═══════════════════════════════

/** Cartella di configurazione di Claude Code (rispetta CLAUDE_CONFIG_DIR se impostata). */
function claudeSettingsFile (): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json')
}

/** Riconosce un hook installato da Micelio (per non duplicarlo e per poterlo rimuovere). */
const isMicelioHook = (h: any) => typeof h?.command === 'string' && h.command.includes('hook session-end') && h.command.includes('micelio')

/**
 * Installa (o reinstalla) l'hook SessionEnd di Micelio in settings.json di Claude Code.
 * Preserva tutto il resto del file e ne salva una copia di backup prima di modificarlo.
 * @returns il percorso del file modificato
 */
function installSessionEndHook (home: string): string {
  const file = claudeSettingsFile()
  let settings: any = {}
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8')
    try { settings = JSON.parse(raw) } catch { throw new DaemonError(`${file} non è JSON valido: correggilo prima di installare l'hook`) }
    fs.writeFileSync(file + '.micelio-backup', raw)
  }
  // Comando con percorsi assoluti: l'hook funziona anche se `micelio` non è nel PATH.
  // Barre "/" e virgolette: interpretabile sia da cmd che da bash.
  const slash = (p: string) => p.replace(/\\/g, '/')
  const command = `"${slash(process.execPath)}" "${slash(__filename)}" --home "${slash(home)}" hook session-end`
  settings.hooks ??= {}
  // Rimuove eventuali installazioni precedenti, poi aggiunge quella attuale.
  const groups: any[] = (settings.hooks.SessionEnd ?? [])
    .map((g: any) => ({ ...g, hooks: (g.hooks ?? []).filter((h: any) => !isMicelioHook(h)) }))
    .filter((g: any) => g.hooks.length > 0)
  groups.push({ hooks: [{ type: 'command', command, timeout: 10 }] })
  settings.hooks.SessionEnd = groups
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(settings, null, 2))
  return file
}

program.command('setup')
  .description('configura un client AI per usare Micelio (MCP + raccolta di fine sessione)')
  .argument('<client>', 'client da configurare: claude-code')
  .option('--print', 'mostra cosa verrebbe fatto senza modificare nulla')
  .option('--no-hook', 'non installare l\'hook di fine sessione (solo MCP)')
  .action((target: string, o: { print?: boolean, hook: boolean }) => {
    if (target !== 'claude-code') throw new DaemonError(`Client non supportato: ${target}. Disponibile: claude-code`)
    const p = paths()
    const c = new DaemonClient(p)
    const args = ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'micelio', c.mcpUrl, '--header', `Authorization: Bearer ${c.config.token}`]
    if (o.print) {
      console.log(`claude ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`)
      if (o.hook) console.log(`+ hook SessionEnd in ${claudeSettingsFile()}`)
      return
    }
    // 1) Server MCP (rimuoviamo prima un'eventuale registrazione vecchia, es. token cambiato).
    spawnSync('claude', ['mcp', 'remove', '--scope', 'user', 'micelio'], { stdio: 'ignore' })
    const r = spawnSync('claude', args, { stdio: 'inherit' })
    if (r.error || r.status !== 0) throw new DaemonError('Registrazione MCP non riuscita: prova `micelio setup claude-code --print` ed esegui il comando a mano')
    // 2) Hook di fine sessione: raccoglie solo nelle cartelle abilitate con `micelio watch add`.
    if (o.hook) console.log(`Hook di fine sessione installato in ${installSessionEndHook(p.home)}`)
    console.log('\nClaude Code configurato. Il daemon deve essere attivo (`micelio start`).')
    console.log('Abilita la raccolta automatica nei progetti con:  micelio watch add <cartella>')
  })

program.parseAsync().catch((err: Error) => {
  // Gli errori "attesi" (DaemonError) si mostrano come messaggio; gli altri con lo stack.
  console.error(err instanceof DaemonError ? `✘ ${err.message}` : err)
  process.exit(1)
})
