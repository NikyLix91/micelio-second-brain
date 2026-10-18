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
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Command } from 'commander'
import { formatCodeRefs } from '../core/code-refs'
import { MEMORY_KINDS, ROOT_CATEGORIES } from '../core/events'
import type { MemberRecord, NodeStatus, RecallHit } from '../core/model'
import { loadIdentity } from '../core/identity'
import { hostFiles, nodePaths, type NodePaths, teamPaths } from '../core/paths'
import type { ExplicitOutcome } from '../ingest/pipeline'
import type { DistillQuality } from '../ingest/quality'
import { checkNetwork } from '../net/diagnose'
import { autostartOff, autostartOn, autostartStatus } from '../node/autostart'
import { BOOTSTRAP_RE, dhtBootstrap, loadConfig, networkMode, type NetworkMode, updateConfig } from '../node/config'
import { claudeSettingsFile, hookCommand, IntegrationError, mcpAddArgs, setupClaudeCode } from '../node/integrations'
import type { TeamSummary } from '../node/micelio-host'
import type { IngestStatus, NetworkSettings, RootReviewResult, RootView, SecurityFinding, SecurityRules, SecurityTestResult } from '../node/micelio-node'
import type { SecurityLogEntry } from '../store/private-store'
import type { Decision, InboxItem } from '../store/private-store'
import { DaemonClient, DaemonError } from './client'

const program = new Command()
  .name('micelio')
  .description('Secondo cervello distribuito peer-to-peer per il team di sviluppo')
  .version('0.2.0')
  .option('--home <dir>', 'cartella dati del nodo (default ~/.micelio o $MICELIO_HOME)')
  .option('--team <team>', 'team su cui lavorare, per id o nome (default: il team predefinito, vedi `micelio teams`)')

// ═══════════════════════════════ Utilità ═══════════════════════════════

/** Percorsi del nodo, tenendo conto di `--home`. Va chiamata dentro le action (dopo il parse). */
function paths (): NodePaths {
  const home = program.opts().home as string | undefined
  if (home) process.env.MICELIO_HOME = path.resolve(home)
  return nodePaths()
}
const client = () => new DaemonClient(paths(), program.opts().team as string | undefined)

/**
 * Percorsi del team da usare quando il daemon è spento (es. `micelio network set`): con più
 * team (B3) le impostazioni di rete stanno in `teams/<id>/settings.json`. A daemon spento i nomi
 * dei team non si possono leggere (stanno nel log cifrato): `--team` accetta solo l'id.
 */
function offlinePaths (): NodePaths {
  const root = paths()
  const dir = hostFiles(root).teams
  const ids = fs.existsSync(dir) ? fs.readdirSync(dir).filter((id) => fs.existsSync(path.join(dir, id, 'state.json'))) : []
  // Struttura a un team non ancora migrata (o nessun team): tutto in config.json
  if (!ids.length) return root
  const want = (program.opts().team as string | undefined) ?? loadConfig(root).defaultTeam ?? ids[0]
  const id = ids.find((i) => i.startsWith(want))
  if (!id) throw new DaemonError(`Team "${want}" non trovato. A daemon spento indica l'id del team (lo mostra \`micelio teams\` con il daemon attivo).`)
  return teamPaths(root, id)
}

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

function printHit (h: RecallHit, full = false): void {
  console.log(`\n■ ${h.title}`)
  const prio = h.activation !== undefined ? ` · attivazione ${Math.round(h.activation * 100)}%${h.votes ? ` · voti ${h.votes > 0 ? '+' : ''}${h.votes}` : ''}${h.pinned ? ' · 📌' : ''}` : ''
  // B4: ricordo personale (solo su questo PC) e codice citato cambiato dopo il ricordo
  const marks = `${h.personal ? ' · 🔒 personale' : ''}${h.stale && (h.stale.commits || h.stale.missing) ? ` · ⚠ codice cambiato (${h.stale.commits} commit${h.stale.missing ? `, ${h.stale.missing} file spariti` : ''})` : ''}`
  console.log(`  [${h.kind}] id:${h.id.slice(0, 12)} · ${h.authorName ?? short(h.author)} · ${date(h.ts)}${h.tags.length ? ' · #' + h.tags.join(' #') : ''}${prio}${marks}`)
  // Riferimenti al codice (progetto, file, simboli, commit): dove approfondire
  for (const l of formatCodeRefs(h.source?.code, full)) console.log(`  ↳ ${l.replace(/`/g, '')}`)
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

/**
 * Avvia il daemon in background (staccato dal terminale) e attende che risponda.
 * Usata da `micelio start` e dall'hook di fine sessione quando trova il daemon spento.
 * @returns true se il daemon risponde entro `waitMs`
 */
async function startInBackground (p: NodePaths, waitMs = 30_000): Promise<boolean> {
  const c = new DaemonClient(p)
  if (await c.health()) return true
  fs.mkdirSync(p.logs, { recursive: true })
  const out = fs.openSync(path.join(p.logs, 'daemon.log'), 'a')
  // Rilanciamo questo stesso script con il comando `daemon`, staccato dal processo corrente.
  const child = spawn(process.execPath, [__filename, 'daemon'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, MICELIO_HOME: p.home, NO_COLOR: '1' }, // log su file: niente colori ANSI
    windowsHide: true
  })
  child.unref()
  // Attende che il daemon risponda (apertura dei feed, annuncio sulla DHT…).
  for (let t = 0; t < waitMs; t += 500) {
    if (await c.health()) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

program.command('start')
  .description('avvia il daemon in background')
  .action(async () => {
    const p = paths()
    const c = new DaemonClient(p)
    if (await c.health()) return console.log(`Daemon già attivo su ${c.baseUrl}`)
    const logFile = path.join(p.logs, 'daemon.log')
    if (await startInBackground(p)) return console.log(`Daemon avviato su ${c.baseUrl} (log: ${logFile})`)
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

/** Avvio automatico all'accesso al PC (src/node/autostart.ts): nessun privilegio di amministratore. */
program.command('autostart')
  .description('avvio automatico del daemon all\'accesso al PC: on | off | status')
  .argument('[azione]', 'on | off | status', 'status')
  .action((azione: string) => {
    const home = paths().home
    if (azione === 'on') {
      const file = autostartOn(__filename, home)
      console.log(`Avvio automatico attivo: il daemon partirà a ogni accesso al PC.\n(${file})`)
    } else if (azione === 'off') {
      console.log(autostartOff(__filename, home) ? 'Avvio automatico disattivato' : 'L\'avvio automatico non era attivo')
    } else {
      const file = autostartStatus(__filename, home)
      console.log(file ? `Avvio automatico attivo (${file})` : 'Avvio automatico non attivo: `micelio autostart on` per attivarlo')
    }
  })

program.command('status')
  .description('stato del nodo e del team')
  .option('--json', 'output JSON (per script)')
  .action(async (o: { json?: boolean }) => {
    const s = await client().call<NodeStatus>('GET', '/api/status')
    if (o.json) console.log(JSON.stringify(s))
    else printStatus(s)
  })

// ═══════════════════════════════ Rete ═══════════════════════════════

/**
 * Dove i nodi del team si incontrano: DHT pubblica di Holepunch (default) o DHT privata del team
 * (server/ nella repo). Se il daemon è acceso la scelta passa da lui e vale SUBITO (il nodo si
 * ricollega); se è spento si modifica config.json e vale al prossimo avvio.
 */
const network = program.command('network').description('rete P2P: DHT pubblica o server del team (show | set | public | private | check)')

/**
 * Applica una scelta di rete: via daemon se risponde, altrimenti direttamente su config.json.
 * @param bootstrap nodi della DHT privata (undefined = lascia quelli salvati)
 */
async function applyNetwork (mode: NetworkMode, bootstrap?: string[]): Promise<void> {
  const c = client()
  if (await c.health()) {
    const n = await c.call<NetworkSettings>('PUT', '/api/network', { mode, bootstrap })
    console.log(networkLabel(n.mode, n.bootstrap))
    console.log('Applicata subito: il nodo si è ricollegato. Verifica con: micelio network check')
    return
  }
  if (process.env.MICELIO_DHT_BOOTSTRAP) throw new DaemonError('La rete è fissata dalla variabile MICELIO_DHT_BOOTSTRAP: toglila per sceglierla')
  const bad = bootstrap?.find((b) => !BOOTSTRAP_RE.test(b))
  if (bad) throw new DaemonError(`Nodo di avvio non valido: ${bad} (formato host:porta)`)
  const cfg = updateConfig(offlinePaths(), (c) => {
    c.network.mode = mode
    if (bootstrap) c.network.bootstrap = bootstrap
  })
  if (mode === 'private' && cfg.network.bootstrap.length === 0) throw new DaemonError('Per la DHT privata serve almeno un nodo di avvio: micelio network set <host:porta>')
  console.log(networkLabel(mode, cfg.network.bootstrap))
  console.log('Il daemon è spento: varrà al prossimo `micelio start`.')
}

/** Descrizione leggibile della rete scelta. */
function networkLabel (mode: NetworkMode, bootstrap: string[]): string {
  if (mode === 'local') return 'Solo locale: nessuna rete (per invitare qualcuno scegli `micelio network public` o `set`)'
  return mode === 'private' ? `DHT privata del team: ${bootstrap.join(', ')}` : 'DHT pubblica di Holepunch'
}

network.command('local')
  .description('solo locale: nessuna rete, per chi usa Micelio da solo (gli inviti richiedono una rete)')
  .action(() => applyNetwork('local'))

network.command('show', { isDefault: true })
  .description('DHT in uso e nodi di avvio salvati')
  .action(() => {
    const cfg = loadConfig(offlinePaths())
    const env = process.env.MICELIO_DHT_BOOTSTRAP
    const saved = cfg.network.bootstrap.length ? cfg.network.bootstrap.join(', ') : 'nessuno'
    if (networkMode(cfg.network) === 'local') console.log(networkLabel('local', []))
    else if (env) console.log(`DHT da MICELIO_DHT_BOOTSTRAP: ${env} (prevale su config.json)`)
    else if (networkMode(cfg.network) === 'private') console.log(`DHT privata del team: ${saved}`)
    else console.log(`DHT pubblica di Holepunch (server del team salvati: ${saved})`)
  })

network.command('set')
  .description('usa il server del team come nodo di avvio (tutti i membri devono usare lo stesso)')
  .argument('<nodi...>', 'uno o più host:porta, es. 203.0.113.10:49737')
  .action((nodi: string[]) => applyNetwork('private', nodi))

network.command('private')
  .description('torna alla DHT privata con i nodi di avvio già salvati')
  .action(() => applyNetwork('private'))

network.command('public')
  .description('passa alla DHT pubblica di Holepunch (i nodi privati restano salvati)')
  .action(() => applyNetwork('public'))

network.command('check')
  .description('diagnosi: il PC entra nella DHT? con quale IP pubblico? che tipo di NAT?')
  .action(async () => {
    const r = await checkNetwork(dhtBootstrap(loadConfig(offlinePaths())))
    console.log(`DHT:            ${r.dht}`)
    console.log(`Raggiungibile:  ${r.reachable ? `sì (${r.nodes} nodi, ${r.ms} ms)` : 'NO'}`)
    console.log(`IP pubblico:    ${r.publicHost ?? 'non determinato'}`)
    console.log(`NAT simmetrico: ${r.randomizedPort === null ? 'non determinabile (servono almeno 2 nodi DHT)' : r.randomizedPort ? 'SÌ' : 'no'}`)
    if (!r.reachable) {
      console.log('\nNessun nodo ha risposto. Possibili cause: server spento, porta UDP chiusa sul server, oppure questa rete blocca l\'UDP in uscita.')
      process.exitCode = 1
    } else if (r.randomizedPort) {
      console.log('\nIl router cambia porta per ogni destinazione: la connessione diretta può fallire con colleghi nella stessa situazione.')
      console.log('Il sapere arriva comunque passando da un nodo sempre acceso raggiungibile da tutti (vedi server/README.md).')
    } else {
      console.log('\nOK: questo PC può collegarsi agli altri nodi del team.')
    }
  })

// ═══════════════════════════════ Team ═══════════════════════════════

/**
 * Nome con cui presentarsi a un team: quello indicato, altrimenti quello dell'identità personale
 * (B3: la stessa persona in tutti i team), altrimenti, la prima volta, il nome del PC.
 */
function memberName (name?: string): string | undefined {
  if (name) return name
  return loadIdentity(hostFiles(paths()).identity) ? undefined : os.hostname()
}

program.command('init')
  .description('crea un nuovo team (si aggiunge a quelli già presenti su questo PC): ne diventi fondatore e admin')
  .argument('<team>', 'nome del team')
  .option('-n, --name <name>', 'il tuo nome nel team (default: quello della tua identità, la prima volta il nome del PC)')
  .option('--solo', 'solo per te: nessuna rete finché non scegli di invitare qualcuno (micelio network public)')
  .action(async (team: string, o: { name?: string, solo?: boolean }) => {
    const s = await client().call<NodeStatus & { teamId: string }>('POST', '/api/team/init', { team, name: memberName(o.name), ...(o.solo ? { network: 'local' } : {}) })
    printStatus(s)
    console.log(`Id del team: ${s.teamId}  (micelio --team ${s.teamId} …)`)
  })

program.command('join')
  .description('entra in un team con un codice d\'invito (si aggiunge a quelli già presenti su questo PC)')
  .argument('<code>', 'codice d\'invito')
  .option('-n, --name <name>', 'il tuo nome nel team (default: quello della tua identità, la prima volta il nome del PC)')
  .action(async (code: string, o: { name?: string }) => {
    console.log('In attesa che un membro del team accolga la richiesta...')
    const s = await client().call<NodeStatus & { teamId: string }>('POST', '/api/team/join', { code, name: memberName(o.name) })
    printStatus(s)
    console.log(`Id del team: ${s.teamId}  (micelio --team ${s.teamId} …)`)
  })

// ═══════════════════════════════ Più team (B3) ═══════════════════════════════

const teams = program.command('teams').description('i team di questo PC: elenco, predefinito, uscita (list | default | leave)')

teams.command('list', { isDefault: true })
  .description('i team di questo PC e la tua identità personale')
  .option('--json', 'output JSON (per script)')
  .action(async (o: { json?: boolean }) => {
    const r = await client().call<{ teams: TeamSummary[], identity: { name: string, publicKey: string } | null }>('GET', '/api/teams')
    if (o.json) return console.log(JSON.stringify(r, null, 2))
    if (!r.teams.length) return console.log('Nessun team. Creane uno con `micelio init <nome-team>` o entra con `micelio join <codice>`.')
    for (const t of r.teams) {
      console.log(`${t.isDefault ? '★' : ' '} ${t.id}  ${t.name ?? '(in sincronizzazione)'}  · ${t.role ?? '-'} · ${t.members} membri · ${t.memories} ricordi · ${t.peers} peer`)
    }
    if (r.identity) console.log(`\nTu: ${r.identity.name} (identità ${short(r.identity.publicKey)}, uguale in tutti i team)`)
    console.log('★ = team predefinito. Per un altro team: micelio --team <id o nome> <comando>')
  })

teams.command('default')
  .description('sceglie il team predefinito (usato quando non indichi --team)')
  .argument('<team>', 'id o nome del team')
  .action(async (team: string) => {
    const list = await client().call<TeamSummary[]>('POST', `/api/teams/${encodeURIComponent(team)}/default`)
    console.log(`Team predefinito: ${list.find((t) => t.isDefault)?.name ?? team}`)
  })

teams.command('leave')
  .description('toglie un team da QUESTO PC cancellandone i dati locali (il team resta sui PC dei colleghi)')
  .argument('<team>', 'id o nome del team')
  .option('--yes', 'conferma: senza, il comando spiega cosa farebbe e si ferma')
  .action(async (team: string, o: { yes?: boolean }) => {
    if (!o.yes) {
      console.log(`Questo cancella da questo PC il log, l'indice, l'inbox e le impostazioni del team "${team}".`)
      console.log('Il team continua a esistere sui PC dei colleghi; per rientrare servirà un nuovo invito.')
      console.log(`Per confermare: micelio teams leave ${team} --yes`)
      return
    }
    const list = await client().call<TeamSummary[]>('DELETE', `/api/teams/${encodeURIComponent(team)}`)
    console.log(`Team tolto da questo PC. Restano: ${list.map((t) => t.name).join(', ') || 'nessuno'}`)
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
  .argument('<key>', 'memory.language | filter.blockKeywords | distill.maxMemories')
  .argument('<value>', 'valore; JSON accettato (es. \'["parola1","parola2"]\')')
  .action(async (key: string, value: string) => {
    // Se il valore è JSON valido lo usiamo come tale (array, numeri…), altrimenti come stringa.
    let parsed: unknown = value
    try { parsed = JSON.parse(value) } catch {}
    await client().call('POST', '/api/team/config', { key, value: parsed })
    console.log(`${key} = ${JSON.stringify(parsed)} (replicato a tutto il team)`)
  })

/** Qualità della distillazione: serve all'admin per decidere `distill.maxMemories`. */
program.command('quality')
  .description('qualità della distillazione per posizione nel distillato, e indicazione sul limite di ricordi')
  .action(async () => {
    const q = await client().call<DistillQuality>('GET', '/api/distill/quality')
    const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(5)
    console.log(`Limite in vigore: ${q.maxMemories} ricordi per distillazione · ${q.total} ricordi distillati con posizione nota`)
    console.log(`Saturazione: ${q.saturation.atLimit}/${q.saturation.batches} distillazioni hanno raggiunto il limite (${Math.round(q.saturation.rate * 100)}%)\n`)
    console.log('Posizione      n  utili inutili rimossi mai usati punteggio  (recenti)')
    for (const b of q.buckets) console.log(`${b.label.padEnd(12)} ${String(b.n).padStart(4)} ${pct(b.useful)}   ${pct(b.notUseful)}   ${pct(b.removed)}     ${pct(b.unused)}     ${b.score.toFixed(2).padStart(5)}  (${b.young})`)
    const verb = { raise: 'ALZARE', keep: 'TENERE', lower: 'ABBASSARE', unknown: 'DATI INSUFFICIENTI' }[q.advice.action]
    console.log(`\nIndicazione: ${verb}. ${q.advice.reason}`)
    console.log('Per cambiarlo (admin): micelio team config distill.maxMemories <n>')
  })

// ═══════════════════════════════ Ricordi ═══════════════════════════════

program.command('remember')
  .description('propone un ricordo per il team (passa dal filtro privacy); corpo da --body o da stdin')
  .argument('<title>', 'titolo autoesplicativo')
  .option('-b, --body <text>', 'contenuto (Markdown)')
  .option('-k, --kind <kind>', `tipo: ${MEMORY_KINDS.join(' | ')}`, 'fact')
  .option('-t, --tags <tags>', 'tag separati da virgola')
  .option('-p, --personal', 'ricordo PERSONALE: resta solo su questo PC, il team non lo vede')
  .action(async (title: string, o: { body?: string, kind: string, tags?: string, personal?: boolean }) => {
    const body = o.body ?? (await readStdin()).trim()
    if (!body) throw new DaemonError('Serve un contenuto: usa --body "..." oppure passalo da stdin')
    const tags = o.tags ? o.tags.split(',').map((t) => t.trim()).filter(Boolean) : []
    if (o.personal) {
      const p = await client().call<{ id: string, duplicate: boolean }>('POST', '/api/memories', { title, body, kind: o.kind, tags, personal: true })
      console.log(`${p.duplicate ? 'Già presente' : 'Salvato'} come ricordo personale (id:${p.id.slice(0, 12)}): resta solo su questo PC.`)
      return
    }
    printOutcome(await client().call<ExplicitOutcome>('POST', '/api/memories', { title, body, kind: o.kind, tags }))
  })

// ── Ricordi personali (B4) ────────────────────────────────────────────────────────
const personal = program.command('personal').description('ricordi personali: solo su questo PC (list | share | delete)')

personal.command('list', { isDefault: true })
  .description('i tuoi ricordi personali')
  .action(async () => {
    const list = await client().call<RecallHit[]>('GET', '/api/personal')
    if (!list.length) return console.log('Nessun ricordo personale. Salvane uno con: micelio remember "<titolo>" -b "<testo>" --personal')
    for (const h of list) printHit(h)
  })

personal.command('share')
  .description('condivide un ricordo personale con il team (passa dal filtro, come un salvataggio)')
  .argument('<id>', 'id del ricordo (anche abbreviato)')
  .action(async (id: string) => {
    printOutcome(await client().call<ExplicitOutcome>('POST', `/api/personal/${encodeURIComponent(id)}/share`))
  })

personal.command('delete')
  .description('cancella un ricordo personale')
  .argument('<id>', 'id del ricordo (anche abbreviato)')
  .action(async (id: string) => {
    await client().call('DELETE', `/api/personal/${encodeURIComponent(id)}`)
    console.log('Ricordo personale cancellato')
  })

program.command('recall')
  .description('cerca nella memoria del team')
  .argument('<query...>', 'parole chiave')
  .option('-l, --limit <n>', 'numero massimo di risultati', '5')
  .action(async (query: string[], o: { limit: string }) => {
    const q = encodeURIComponent(query.join(' '))
    const hits = await client().call<RecallHit[]>('GET', `/api/memories/search?q=${q}&limit=${o.limit}`)
    if (!hits.length) return console.log('Nessun ricordo trovato')
    hits.forEach((h) => printHit(h))
  })

const dream = program.command('dream').description('dreaming: consolidamento del sapere del team (diario con `micelio dream log`)')
dream.command('now').description('sogna subito su questo nodo (fonde duplicati, archivia ciò che è decaduto)')
  .action(async () => {
    console.log('Sogno in corso (può richiedere qualche minuto)…')
    const r = await client().call<{ summary: string, merged: number, obsolete: number, linked: number, decayed: number }>('POST', '/api/dreams/run', undefined, 1_800_000)
    console.log(`\nFusi: ${r.merged} · superati: ${r.obsolete} · collegati: ${r.linked} · decaduti: ${r.decayed}\n\n${r.summary}`)
  })
dream.command('log').description('diario dei sogni del team')
  .action(async () => {
    const list = await client().call<{ epoch: string, by: string, ts: number, summary: string }[]>('GET', '/api/dreams')
    if (!list.length) return console.log('Nessun sogno ancora')
    for (const d of list) console.log(`\n◆ ${d.epoch} · ${date(d.ts)} · da ${short(d.by)}\n${indent(d.summary)}`)
  })

program.command('archive').description('ricordi archiviati o sostituiti (storico)')
  .action(async () => {
    const list = await client().call<{ id: string, title: string, status: string, statusReason?: string, ts: number }[]>('GET', '/api/archive')
    if (!list.length) return console.log('Archivio vuoto')
    for (const m of list) console.log(`[${m.status === 'superseded' ? 'sostituito' : 'archiviato'}] id:${m.id.slice(0, 12)} ${m.title}\n   ↳ ${m.statusReason ?? ''}`)
  })
program.command('redact').description('rimuove il contenuto di un ricordo per tutto il team (solo admin; non reversibile)')
  .argument('<id>').option('-r, --reason <motivo>', 'motivo, visibile nell\'archivio', '')
  .action(async (id: string, o: { reason: string }) => {
    await client().call('POST', `/api/memories/${encodeURIComponent(id)}/redact`, { reason: o.reason })
    console.log('Contenuto rimosso per tutto il team. Nota: chi l\'aveva già letto o esportato ne conserva una copia.')
  })

program.command('metrics').description('metriche sintetiche del nodo (JSON)')
  .action(async () => console.log(JSON.stringify(await client().call('GET', '/api/metrics'), null, 2)))

program.command('restore').description('ripristina un ricordo archiviato o sostituito').argument('<id>')
  .action(async (id: string) => { await client().call('POST', `/api/archive/${encodeURIComponent(id)}/restore`); console.log('Ripristinato') })

program.command('vote')
  .description('vota un ricordo: up (utile), down (fuorviante/obsoleto), clear (ritira il voto)')
  .argument('<id>').argument('<voto>', 'up | down | clear')
  .action(async (id: string, v: string) => {
    const delta = v === 'up' ? 1 : v === 'down' ? -1 : v === 'clear' ? 0 : null
    if (delta === null) throw new DaemonError('Voto non valido: usa up, down o clear')
    const h = await client().call<RecallHit>('POST', `/api/memories/${encodeURIComponent(id)}/vote`, { delta })
    console.log(`Voto registrato. Totale voti: ${h.votes ?? 0}`)
  })

program.command('pin').description('fissa un ricordo importante: non decade e non viene archiviato').argument('<id>')
  .action(async (id: string) => { await client().call('POST', `/api/memories/${encodeURIComponent(id)}/pin`); console.log('Ricordo fissato') })
program.command('unpin').description('sblocca un ricordo fissato').argument('<id>')
  .action(async (id: string) => { await client().call('DELETE', `/api/memories/${encodeURIComponent(id)}/pin`); console.log('Ricordo sbloccato') })

// ═══════════════════════════════ Sicurezza (Fase 9) ═══════════════════════════════

const security = program.command('security').alias('sicurezza').description('segreti e file sensibili: test | scan | clean | log | rules')

/** Riepilogo "tipo ×n" delle redazioni. */
const kindsText = (k: Record<string, number>) => Object.entries(k).map(([t, n]) => `${t.replace('secret:', '')}${n > 1 ? ` ×${n}` : ''}`).join(', ')

security.command('test')
  .description('banco di prova: cosa toglierebbe il filtro da un testo (o da stdin) e se un file è sensibile')
  .argument('[testo...]', 'testo da provare (senza argomenti: legge stdin)')
  .option('-f, --file <nome>', 'verifica anche se un file è considerato sensibile')
  .action(async (words: string[], o: { file?: string }) => {
    const text = words.length ? words.join(' ') : (process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8'))
    const r = await client().call<SecurityTestResult>('POST', '/api/security/test', { text, file: o.file })
    if (text) {
      console.log(r.text)
      console.log(`\nRedazioni: ${kindsText(r.redactions) || 'nessuna'}`)
      if (r.blockedBy.length) console.log(`BLOCCATO (resterebbe privato): ${r.blockedBy.join(', ')}`)
    }
    if (o.file) console.log(r.sensitiveFile ? `File sensibile (${r.sensitiveFile}): il contenuto non entra mai in Micelio` : 'File non sensibile')
  })

security.command('scan')
  .description('ricordi pubblicati che contengono segreti secondo le regole attuali')
  .action(async () => {
    const list = await client().call<SecurityFinding[]>('GET', '/api/security/scan')
    if (!list.length) return console.log('Nessun ricordo con segreti o dati personali.')
    for (const f of list) console.log(`  ${f.title}  (id:${f.id.slice(0, 12)}${f.root ? ', Radice' : ''})  → ${kindsText(f.kinds)}`)
    console.log('\nPer ripulirne uno (admin): micelio security clean <id>')
  })

security.command('clean')
  .description('ripulisce un ricordo (admin): pubblica la versione redatta e rimuove l\'originale')
  .argument('<id>')
  .action(async (id: string) => {
    const r = await client().call<{ id: string }>('POST', `/api/security/clean/${encodeURIComponent(id)}`)
    console.log(`✔ Ripulito: nuova versione id:${r.id.slice(0, 12)}, originale rimosso dalla vista di tutti`)
  })

security.command('log')
  .description('registro locale: cosa il filtro ha tolto, da dove, di che tipo (mai i valori)')
  .option('-n, --limit <n>', 'quante voci', '30')
  .action(async (o: { limit: string }) => {
    const list = await client().call<SecurityLogEntry[]>('GET', `/api/security/log?limit=${encodeURIComponent(o.limit)}`)
    if (!list.length) return console.log('Registro vuoto.')
    for (const e of list) {
      const omitted = e.omitted.length ? ` · file omessi: ${e.omitted.join(', ')}` : ''
      console.log(`${date(e.ts)}  [${e.source.type}] ${e.label.slice(0, 60)}  → ${kindsText(e.kinds) || '—'}${omitted}`)
    }
  })

security.command('rules')
  .description('regole in vigore (si modificano dalla schermata Sicurezza dell\'app, solo admin)')
  .action(async () => {
    const r = await client().call<SecurityRules>('GET', '/api/security/rules')
    console.log('Riconosciuti sempre:')
    for (const b of r.builtin) console.log(`  - ${b.label}`)
    console.log(`\nFile sensibili di default: ${r.defaultSensitiveFiles.join('  ')}`)
    console.log(`\nRegole del team:\n  pattern: ${r.team.secretPatterns.map((p) => p.name).join(', ') || 'nessuno'}\n  eccezioni: ${r.team.allow.join(', ') || 'nessuna'}\n  file sensibili aggiuntivi: ${r.team.sensitiveFiles.join(', ') || 'nessuno'}`)
  })

// ═══════════════════════════════ Radici (Fase 8) ═══════════════════════════════

/** Etichette italiane delle categorie delle Radici. */
const ROOT_LABEL: Record<string, string> = {
  architecture: 'Architettura', network: 'Rete e infrastruttura', interface: 'Interfacce e contratti',
  domain: 'Dominio', practice: 'Best practice', policy: 'Policy', other: 'Altro'
}

/**
 * Radici: il sapere fondante del team, mai dimenticato (architettura, rete, interfacce, dominio,
 * best practice, policy). Qualunque membro può promuovere, togliere e confermare.
 */
const roots = program.command('roots').alias('radici').description('Radici: sapere fondante che non viene mai dimenticato (list | add | remove | confirm | review)')

roots.command('list', { isDefault: true })
  .description('elenco delle Radici, raggruppate per categoria')
  .option('-p, --project <progetto>', 'solo le Radici di un progetto')
  .option('-c, --category <categoria>', `solo una categoria: ${ROOT_CATEGORIES.join(' | ')}`)
  .option('-q, --query <testo>', 'ordina per pertinenza')
  .action(async (o: { project?: string, category?: string, query?: string }) => {
    const qs = new URLSearchParams(Object.entries({ project: o.project, category: o.category, q: o.query }).filter(([, v]) => v) as [string, string][])
    const list = await client().call<RootView[]>('GET', `/api/roots${qs.size ? '?' + qs : ''}`)
    if (list.length === 0) { console.log('Nessuna Radice. Promuovi un ricordo con: micelio roots add <id> <categoria>'); return }
    let last = ''
    for (const r of list) {
      if (r.category !== last) { console.log(`\n${ROOT_LABEL[r.category] ?? r.category}`); last = r.category }
      const flag = r.status === 'review' ? `  ⚠ da rivedere: ${r.flags.map((f) => f.reason).join(' · ')}` : ''
      console.log(`  ■ ${r.memory.title}  (id:${r.id.slice(0, 12)}, rivista il ${date(r.reviewedAt)})${flag}`)
    }
  })

roots.command('suggested')
  .description('Radici suggerite dal distillatore su questo PC (promuovile con `roots add`)')
  .action(async () => {
    const list = await client().call<{ id: string, category: string, title: string }[]>('GET', '/api/roots/suggestions')
    if (!list.length) return console.log('Nessun suggerimento.')
    for (const s of list) console.log(`  ${s.title}  (id:${s.id.slice(0, 12)})  → micelio roots add ${s.id.slice(0, 12)} ${s.category}`)
  })

roots.command('add')
  .description('promuove un ricordo a Radice (o ne cambia la categoria)')
  .argument('<id>', 'id del ricordo (anche abbreviato)')
  .argument('<categoria>', ROOT_CATEGORIES.join(' | '))
  .action(async (id: string, category: string) => {
    const r = await client().call<RootView>('POST', `/api/roots/${encodeURIComponent(id)}`, { category })
    console.log(`✔ «${r.memory.title}» ora è una Radice (${ROOT_LABEL[r.category]})`)
  })

roots.command('remove')
  .description('il ricordo smette di essere una Radice (torna a decadere come gli altri)')
  .argument('<id>')
  .action(async (id: string) => { await client().call('DELETE', `/api/roots/${encodeURIComponent(id)}`); console.log('Non è più una Radice') })

roots.command('confirm')
  .description('Radice rivista e ancora valida: azzera le segnalazioni')
  .argument('<id>')
  .action(async (id: string) => {
    const r = await client().call<RootView>('POST', `/api/roots/${encodeURIComponent(id)}/confirm`)
    console.log(`✔ Confermata: «${r.memory.title}»`)
  })

roots.command('review')
  .description('revisione: segnala le Radici il cui codice o documento è cambiato, o che ricordi recenti contraddicono')
  .argument('[ids...]', 'Radici da rivedere (default: tutte)')
  .action(async (ids: string[]) => {
    console.log('Revisione in corso (git e, per le contraddizioni, Claude)…')
    const r = await client().call<RootReviewResult>('POST', '/api/roots/review', { ids: ids.length ? ids : undefined }, 600_000)
    console.log(`${r.checked} Radici esaminate, ${r.flagged.length} da rivedere.`)
    for (const f of r.flagged) {
      console.log(`\n⚠ ${f.title}`)
      for (const reason of f.reasons) console.log(`   - ${reason}`)
    }
    for (const n of r.notes) console.log(`\nNota: ${n.text}`)
    if (r.flagged.length) console.log('\nDopo aver controllato: micelio roots confirm <id> (ancora valida) oppure correggi il ricordo.')
  })

program.command('get')
  .description('mostra un ricordo dato l\'id (anche abbreviato)')
  .argument('<id>')
  .action(async (id: string) => {
    const h = await client().call<RecallHit & { error?: string }>('GET', `/api/memories/${encodeURIComponent(id)}`)
    if (h.error) throw new DaemonError(`Nessun ricordo con id ${id}`)
    printHit(h, true)
  })

program.command('export')
  .description('percorso dell\'export Markdown in sola lettura')
  .action(() => console.log(offlinePaths().export))

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
inbox.command('keep').description('tienilo per te: diventa un ricordo personale, non va al team').argument('<id>')
  .action(async (id: string) => {
    await client().call('POST', `/api/inbox/${encodeURIComponent(id)}/keep`)
    console.log('Tenuto come ricordo personale (solo su questo PC)')
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

const docs = program.command('docs').description('cartelle di documenti sorvegliate (PDF, DOCX, XLSX, PPTX, ODT, MD…)')
docs.action(async () => {
  const r = await client().call<{ folders: { path: string, shareable: boolean }[], stats: Record<string, number> }>('GET', '/api/documents')
  if (!r.folders.length) return console.log('Nessuna cartella di documenti: usa `micelio docs add <cartella> [--shareable]`')
  for (const f of r.folders) console.log(`${f.path}  ${f.shareable ? '[originali scaricabili dai colleghi]' : '[solo distillato]'}`)
  console.log(`Documenti: ${Object.entries(r.stats).map(([k, v]) => `${k} ${v}`).join(', ') || 'nessuno'}`)
})
docs.command('add').description('sorveglia una cartella di documenti').argument('[dir]', 'cartella', '.')
  .option('--shareable', 'i colleghi possono scaricare gli originali su richiesta')
  .option('--roots', 'cartella "di Radici": i ricordi dei suoi documenti diventano Radici (architettura, policy, regole…)')
  .action(async (dir: string, o: { shareable?: boolean, roots?: boolean }) => {
    const list = await client().call<{ path: string, shareable: boolean, roots: boolean }[]>('POST', '/api/documents/folders', { path: path.resolve(dir), shareable: !!o.shareable, roots: !!o.roots })
    console.log('Cartelle di documenti:\n' + list.map((f) => `${f.path}${f.shareable ? '  [condivisibile]' : ''}${f.roots ? '  [Radici]' : ''}`).join('\n'))
  })
docs.command('remove').description('smette di sorvegliare una cartella').argument('[dir]', 'cartella', '.')
  .action(async (dir: string) => {
    await client().call('DELETE', '/api/documents/folders', { path: path.resolve(dir) })
    console.log('Cartella rimossa (i ricordi già distillati restano nel team)')
  })

program.command('fetch')
  .description('scarica l\'originale del documento da cui viene un ricordo')
  .argument('<id>', 'id del ricordo (anche abbreviato)')
  .action(async (id: string) => {
    const f = await client().call<{ path: string, name: string, size: number, local: boolean }>('POST', `/api/memories/${encodeURIComponent(id)}/source`, undefined, 120_000)
    console.log(`${f.local ? 'Disponibile in locale' : 'Scaricato'}: ${f.name} (${Math.round(f.size / 1024)} KB)\n${f.path}`)
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
ingest.command('scan').description('cerca subito parti nuove nelle sessioni di Claude Code (anche in corso o perse) e le accoda')
  .action(async () => {
    const r = await client().call<{ queued: number }>('POST', '/api/ingest/scan')
    console.log(r.queued ? `${r.queued} sessioni accodate per la distillazione` : 'Nessuna parte nuova da distillare (le sessioni attive vengono prese dopo 10 minuti di pausa)')
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
 * Regole: non stampare nulla e NON fallire mai (exit 0 sempre): un errore qui disturberebbe
 * l'utente di Claude Code per un problema di Micelio. Di norma termina in un istante; solo se il
 * daemon è spento lo avvia, impiegando qualche secondo.
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
      // Daemon spento? Lo accendiamo noi invece di perdere la sessione. Se non fa in tempo, non è
      // grave: appena avviato, il daemon recupera da solo le sessioni finite (session-scanner).
      const p = paths()
      if (!(await new DaemonClient(p).health()) && !(await startInBackground(p, 20_000))) {
        throw new Error('daemon spento e non avviato in tempo: la sessione sarà recuperata al prossimo avvio')
      }
      await client().call('POST', '/api/ingest/session', {
        session_id: input.session_id, transcript_path: input.transcript_path, cwd: input.cwd ?? process.cwd()
      }, 3000)
    } catch (err) {
      // Niente output verso Claude Code, ma l'errore va registrato: un hook che fallisce in
      // silenzio è quasi impossibile da diagnosticare (es. daemon spento o su un'altra porta).
      try {
        const p = paths()
        fs.mkdirSync(p.logs, { recursive: true })
        fs.appendFileSync(path.join(p.logs, 'hook.log'), `${new Date().toISOString()} ${event}: ${(err as Error).message}\n`)
      } catch {}
    }
  })

// ═══════════════════════════════ Integrazioni ═══════════════════════════════

/**
 * Server MCP su stdio (shim verso il daemon): per i client che lanciano i server MCP come
 * processo. NON stampare nulla su stdout qui: è il canale del protocollo.
 */
program.command('mcp')
  .description('server MCP su stdio (per client che non supportano HTTP): inoltra al daemon')
  .action(async () => {
    const c = client()
    const { runStdioProxy } = require('../mcp/stdio-proxy') as typeof import('../mcp/stdio-proxy')
    await runStdioProxy(c.mcpUrl, c.config.token)
  })

/** Configurazioni pronte da incollare per i client MCP diversi da Claude Code (Fase 7). */
function clientSnippet (target: string, home: string): string | null {
  const slash = (p: string) => p.replace(/\\/g, '/')
  const cmd = slash(process.execPath)
  // Con --team il client usa sempre quel team (B3), anche se il predefinito cambia
  const team = program.opts().team as string | undefined
  const args = [slash(__filename), '--home', slash(home), ...(team ? ['--team', team] : []), 'mcp']
  switch (target) {
    case 'codex':
      return `# ~/.codex/config.toml\n[mcp_servers.micelio]\ncommand = ${JSON.stringify(cmd)}\nargs = ${JSON.stringify(args)}\n`
    case 'vscode':
      return `// .vscode/mcp.json (progetto) oppure "mcp" nelle impostazioni utente di VS Code\n${JSON.stringify({ servers: { micelio: { type: 'stdio', command: cmd, args } } }, null, 2)}\n`
    case 'webstorm':
    case 'jetbrains':
      return `// Impostazioni → Strumenti → AI Assistant → Model Context Protocol (MCP) → aggiungi da JSON\n${JSON.stringify({ mcpServers: { micelio: { command: cmd, args } } }, null, 2)}\n`
    default:
      return null
  }
}

program.command('setup')
  .description('configura un client AI per usare Micelio (MCP + raccolta di fine sessione)')
  .argument('<client>', 'claude-code (configura) | codex | vscode | webstorm (stampa la configurazione da incollare)')
  .option('--print', 'mostra cosa verrebbe fatto senza modificare nulla')
  .option('--no-hook', 'non installare l\'hook di fine sessione (solo MCP)')
  .option('--project <dir>', 'solo per questa cartella di progetto: Claude Code avviato lì usa il team indicato con --team (B3)')
  .action(async (target: string, o: { print?: boolean, hook: boolean, project?: string }) => {
    if (o.project && target === 'claude-code') {
      // MCP del team per un solo progetto, ambito "local" di Claude Code (vedi registerProjectMcp)
      const r = await client().call<{ dir: string, mcpUrl: string }>('POST', '/api/setup/project', { path: path.resolve(o.project) })
      console.log(`Claude Code avviato in ${r.dir} userà il team di ${r.mcpUrl}`)
      return
    }
    if (target !== 'claude-code') {
      // Per gli altri client stampiamo la configurazione da incollare: i loro file di configurazione
      // cambiano spesso formato fra una versione e l'altra, meglio non modificarli alla cieca.
      const snippet = clientSnippet(target, paths().home)
      if (!snippet) throw new DaemonError(`Client non supportato: ${target}. Disponibili: claude-code, codex, vscode, webstorm`)
      console.log(snippet)
      console.log('Il daemon deve essere attivo (`micelio start`). Lo shim `micelio mcp` inoltra le richieste al daemon.')
      return
    }
    const p = paths()
    const c = new DaemonClient(p)
    if (o.print) {
      const args = mcpAddArgs(c.mcpUrl, c.config.token)
      console.log(`claude ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`)
      if (o.hook) console.log(`+ hook SessionEnd in ${claudeSettingsFile()}:\n  ${hookCommand(p.home)}`)
      return
    }
    try {
      // Stessa logica del pulsante nelle Impostazioni della UI (src/node/integrations.ts).
      const r = setupClaudeCode({ mcpUrl: c.mcpUrl, token: c.config.token, home: p.home, hook: o.hook })
      console.log(`Server MCP registrato: ${r.mcpUrl}`)
      if (r.hookFile) console.log(`Hook di fine sessione installato in ${r.hookFile} (copia di backup accanto)`)
    } catch (err) {
      throw err instanceof IntegrationError ? new DaemonError(err.message + '\nProva `micelio setup claude-code --print` ed esegui i comandi a mano.') : err
    }
    console.log('\nClaude Code configurato. Il daemon deve essere attivo (`micelio start`).')
    console.log('Abilita la raccolta automatica nei progetti con:  micelio watch add <cartella>')
  })

/**
 * Apre la UI nel browser predefinito. Il daemon genera un link MONOUSO (valido 60 s) che
 * consegna il token alla pagina; il token non resta nell'URL né nella cronologia.
 * Per l'app desktop: `npm run desktop` dalla cartella del progetto.
 */
program.command('ui')
  .description('apre l\'interfaccia di Micelio nel browser')
  .option('--print', 'stampa il link senza aprire il browser')
  .action(async (o: { print?: boolean }) => {
    const { url } = await client().call<{ url: string }>('POST', '/api/ui/link')
    if (o.print) return console.log(url)
    // Comando di sistema per aprire un URL: start (Windows), open (macOS), xdg-open (Linux).
    const [cmd, args] = process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]]
    spawn(cmd, args as string[], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    console.log('Interfaccia aperta nel browser (il link è monouso e scade in 60 secondi).')
  })

program.parseAsync().catch((err: Error) => {
  // Gli errori "attesi" (DaemonError) si mostrano come messaggio; gli altri con lo stack.
  console.error(err instanceof DaemonError ? `✘ ${err.message}` : err)
  process.exit(1)
})
