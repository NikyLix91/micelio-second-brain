/**
 * @file API REST locale del daemon, usata dalla CLI `micelio` (e in futuro dalla UI).
 *
 * Il controller è volutamente "sottile": valida l'input HTTP con zod e chiama il MicelioNode.
 * Tutta la logica sta nel nodo, così CLI, MCP e UI si comportano allo stesso modo.
 *
 * Tutte le rotte richiedono il token (TokenGuard), tranne /api/health.
 * Gli errori diventano JSON `{ error }` tramite ErrorFilter (400 per errori dell'utente).
 */
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, SetMetadata } from '@nestjs/common'
import { z } from 'zod'
import { MEMORY_KINDS } from '../core/events'
import { IntegrationError, setupClaudeCode } from '../node/integrations'
import { UserError } from '../node/micelio-node'
import type { DaemonOptions } from './micelio.module'
import { MicelioService } from './micelio.service'
import { shutdownSignal } from './shutdown'
import { DAEMON_OPTIONS, PUBLIC_ROUTE } from './tokens'

// ── Schemi dei body ───────────────────────────────────────────────────────────────────
const InitBody = z.object({ team: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(100) })
const JoinBody = z.object({ code: z.string().trim().min(10), name: z.string().trim().min(1).max(100) })
/** Payload dell'hook SessionEnd di Claude Code, inoltrato da `micelio hook session-end`. */
const SessionBody = z.object({ session_id: z.string().min(1), transcript_path: z.string().min(1), cwd: z.string().min(1) })
const WatchBody = z.object({ path: z.string().min(1) })
/** Cartella di documenti: percorso e se gli originali sono scaricabili dai colleghi (D10). */
const DocFolderBody = z.object({ path: z.string().min(1), shareable: z.boolean().default(false) })
const ConfigBody = z.object({ key: z.string().min(1).max(100), value: z.unknown() })
/** Modifiche facoltative in approvazione di un elemento dell'inbox. */
const ApproveBody = z.object({
  title: z.string().min(3).max(200).optional(),
  body: z.string().min(1).max(20_000).optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  tags: z.array(z.string()).max(20).optional()
}).default({})
/** Impostazioni LLM modificabili a caldo dalla UI. */
const LlmSettingsBody = z.object({
  classifyModel: z.string().min(1).max(100).optional(),
  distillModel: z.string().min(1).max(100).optional(),
  dailyBudget: z.number().int().min(0).max(100_000).optional()
})
/** Scelta della DHT; il formato dei nodi è controllato da MicelioNode.setNetwork. */
const NetworkBody = z.object({
  mode: z.enum(['public', 'private']),
  bootstrap: z.array(z.string().max(300)).max(10).optional()
})
const NetworkCheckBody = NetworkBody.partial().default({})
const RedactBody =z.object({ reason: z.string().max(500).default('') }).default({ reason: '' })
const VoteBody = z.object({ delta: z.union([z.literal(-1), z.literal(0), z.literal(1)]) })
const SetupBody = z.object({ hook: z.boolean().default(true) }).default({ hook: true })

@Controller('api')
export class ApiController {
  constructor (
    private readonly micelio: MicelioService,
    @Inject(DAEMON_OPTIONS) private readonly options: DaemonOptions
  ) {}

  private get node () { return this.micelio.node }

  // ═══════════════════════════════ Servizio ═══════════════════════════════

  /** Usata da `micelio start` per sapere quando il daemon è pronto. Unica rotta pubblica. */
  @Get('health')
  @SetMetadata(PUBLIC_ROUTE, true)
  health () {
    return { ok: true, pid: process.pid }
  }

  @Get('status')
  status () {
    return this.node.status()
  }

  /** Chiusura ordinata (vedi shutdown.ts per il perché non usiamo i segnali). */
  @Post('shutdown')
  @HttpCode(202)
  shutdown () {
    // Prima rispondiamo, poi chiudiamo: altrimenti la CLI vedrebbe la connessione cadere.
    setTimeout(() => shutdownSignal.emit('shutdown'), 100)
    return { ok: true }
  }

  // ═════════════════════════════════ Team ═════════════════════════════════

  @Post('team/init')
  init (@Body() body: unknown) {
    const { team, name } = InitBody.parse(body)
    return this.node.init(team, name)
  }

  /** Può durare fino a 2 minuti: attende che un membro online accolga la richiesta. */
  @Post('team/join')
  join (@Body() body: unknown) {
    const { code, name } = JoinBody.parse(body)
    return this.node.join(code, name)
  }

  /** Configurazione condivisa del team (solo admin), es. { key: "memory.language", value: "en" }. */
  @Post('team/config')
  @HttpCode(200)
  async setConfig (@Body() body: unknown) {
    const { key, value } = ConfigBody.parse(body)
    await this.node.setTeamConfig(key, value)
    return { ok: true }
  }

  @Post('invites')
  invite () {
    return this.node.invite()
  }

  @Get('invites')
  invites () {
    return this.node.invites()
  }

  @Get('members')
  members () {
    return this.node.members()
  }

  /** `ref` = nome del membro o chiave (anche abbreviata). */
  @Post('members/:ref/remove')
  @HttpCode(200)
  remove (@Param('ref') ref: string) {
    return this.node.removeMember(ref)
  }

  @Post('members/:ref/promote')
  @HttpCode(200)
  promote (@Param('ref') ref: string) {
    return this.node.promoteMember(ref)
  }

  // ═══════════════════════════════ Ricordi ═══════════════════════════════

  /**
   * Salvataggio esplicito: passa da filtro e classificazione (D6).
   * La risposta dice dove è finito il ricordo: { outcome: 'team' | 'inbox' | 'private', … }.
   * La validazione completa del ricordo la fa il nodo (MemoryInput).
   */
  @Post('memories')
  remember (@Body() body: Record<string, unknown>) {
    return this.node.remember({ ...body, source: { type: 'cli' } } as any)
  }

  /** Costellazione del sapere per la schermata principale della UI. */
  @Get('graph')
  graph () {
    return this.node.graph()
  }

  /** Ultimi ricordi (dal più recente). Dichiarata prima di memories/:id per non esserne "catturata". */
  @Get('memories')
  recent (@Query('limit') limit = '20') {
    return this.node.recent(Math.min(Math.max(Number(limit) || 20, 1), 200))
  }

  /** Ricerca ibrida (parole chiave + significato + attivazione, Fase 5). */
  @Get('memories/search')
  recall (@Query('q') q = '', @Query('limit') limit = '5') {
    // Il limite arriva come stringa dalla query: lo riportiamo fra 1 e 50.
    return this.node.recallHybrid(q, Math.min(Math.max(Number(limit) || 5, 1), 50))
  }

  /** Voto di utilità: { delta: 1 | -1 | 0 } (0 ritira il voto). */
  @Post('memories/:id/vote')
  @HttpCode(200)
  async vote (@Param('id') id: string, @Body() body: unknown) {
    await this.node.vote(id, VoteBody.parse(body).delta)
    return this.node.detail(id)
  }

  @Post('memories/:id/pin')
  @HttpCode(200)
  async pin (@Param('id') id: string) {
    await this.node.pin(id, true)
    return this.node.detail(id)
  }

  @Delete('memories/:id/pin')
  async unpin (@Param('id') id: string) {
    await this.node.pin(id, false)
    return this.node.detail(id)
  }

  /**
   * Scarica (o trova in locale) l'originale del documento da cui viene un ricordo (§12-bis).
   * Può richiedere fino a un minuto: il file arriva dal nodo del collega che lo possiede.
   */
  @Post('memories/:id/source')
  @HttpCode(200)
  fetchSource (@Param('id') id: string) {
    return this.node.fetchSource(id)
  }

  @Get('memories/:id')
  get (@Param('id') id: string) {
    return this.node.detail(id) ?? { error: 'non trovato' }
  }

  // ═══════════════════════════════ Ingestione ═══════════════════════════════

  /**
   * Chiamata dall'hook SessionEnd di Claude Code. Risponde subito: l'elaborazione avviene in
   * background. Se la cartella non è opt-in risponde `queued: false` con il motivo.
   */
  @Post('ingest/session')
  @HttpCode(200)
  ingestSession (@Body() body: unknown) {
    const s = SessionBody.parse(body)
    return this.node.ingestSession({ sessionId: s.session_id, transcriptPath: s.transcript_path, cwd: s.cwd })
  }

  @Get('ingest/status')
  ingestStatus () {
    return this.node.ingestStatus()
  }

  /** Controlla subito le trascrizioni (sessioni in corso o perse) e accoda le parti nuove. */
  @Post('ingest/scan')
  @HttpCode(200)
  ingestScan () {
    return { queued: this.node.scanSessions() }
  }

  /** Elabora subito il prossimo lavoro in coda (utile per provare senza aspettare il worker). */
  @Post('ingest/run')
  @HttpCode(200)
  async ingestRun () {
    return { processed: await this.node.processQueue() }
  }

  /** Cartelle di documenti e conteggi per stato (in coda, elaborati, bloccati…). */
  @Get('documents')
  documents () {
    return { folders: this.node.settings().documents, stats: this.node.documentStats() }
  }

  @Post('documents/folders')
  @HttpCode(200)
  documentsAdd (@Body() body: unknown) {
    const { path, shareable } = DocFolderBody.parse(body)
    return this.node.documentsAdd(path, shareable)
  }

  @Delete('documents/folders')
  documentsRemove (@Body() body: unknown) {
    return this.node.documentsRemove(WatchBody.parse(body).path)
  }

  @Get('watch')
  watched () {
    return this.node.watched()
  }

  @Post('watch')
  @HttpCode(200)
  watchAdd (@Body() body: unknown) {
    return this.node.watchAdd(WatchBody.parse(body).path)
  }

  @Delete('watch')
  watchRemove (@Body() body: unknown) {
    return this.node.watchRemove(WatchBody.parse(body).path)
  }

  // ═══════════════════════════════ Inbox e privato ═══════════════════════════════

  @Get('inbox')
  inbox () {
    return this.node.inbox()
  }

  @Post('inbox/:id/approve')
  @HttpCode(200)
  approve (@Param('id') id: string, @Body() body: unknown) {
    return this.node.approve(id, ApproveBody.parse(body ?? {}))
  }

  @Post('inbox/:id/reject')
  @HttpCode(200)
  reject (@Param('id') id: string) {
    this.node.reject(id)
    return { ok: true }
  }

  /** Registro di ciò che non è andato al team. Solo locale. */
  @Get('decisions')
  decisions (@Query('limit') limit = '50') {
    return this.node.decisions(Math.min(Math.max(Number(limit) || 50, 1), 500))
  }

  // ═══════════════════════════════ Dreaming (Fase 6) ═══════════════════════════════

  /** Diario dei sogni del team. */
  @Get('dreams')
  dreams () {
    return this.node.dreams()
  }

  /** Avvia subito un sogno su questo nodo (può richiedere minuti: una chiamata LLM per gruppo). */
  @Post('dreams/run')
  @HttpCode(200)
  dreamNow () {
    return this.node.dreamNow()
  }

  /** Ricordi archiviati o sostituiti (storico). */
  @Get('archive')
  archived () {
    return this.node.archived()
  }

  /** Redazione di un ricordo (solo admin). */
  @Post('memories/:id/redact')
  @HttpCode(200)
  async redact (@Param('id') id: string, @Body() body: unknown) {
    await this.node.redact(id, RedactBody.parse(body ?? {}).reason)
    return { ok: true }
  }

  /** Metriche sintetiche del nodo. */
  @Get('metrics')
  metrics () {
    return this.node.metrics()
  }

  @Post('archive/:id/restore')
  @HttpCode(200)
  async restore (@Param('id') id: string) {
    await this.node.restore(id)
    return { ok: true }
  }

  // ═══════════════════════════════ Impostazioni ═══════════════════════════════

  /** Impostazioni locali (LLM, cartelle abilitate, porta). */
  @Get('settings')
  settings () {
    return this.node.settings()
  }

  /** Modifica modelli e budget LLM (effetto immediato, senza riavvio). */
  @Put('settings/llm')
  updateLlm (@Body() body: unknown) {
    return this.node.updateLlmSettings(LlmSettingsBody.parse(body))
  }

  /** Rete P2P in uso: DHT pubblica o privata (vedi server/README.md). */
  @Get('network')
  network () {
    return this.node.networkSettings()
  }

  /**
   * Sceglie la DHT e la applica subito (il nodo si ricollega). Tutti i membri devono usare la
   * stessa: la UI lo ricorda prima di confermare.
   */
  @Put('network')
  setNetwork (@Body() body: unknown) {
    const { mode, bootstrap } = NetworkBody.parse(body)
    return this.node.setNetwork(mode, bootstrap)
  }

  /** Diagnosi di una DHT (quella indicata, o quella in uso) senza cambiare nulla. Fino a ~20 s. */
  @Post('network/check')
  @HttpCode(200)
  checkNetwork (@Body() body: unknown) {
    const { mode, bootstrap } = NetworkCheckBody.parse(body ?? {})
    return this.node.checkNetwork(mode, bootstrap)
  }

  /** Spazio occupato su disco e quota del log del team per membro. */
  @Get('storage')
  storage () {
    return this.node.storage()
  }

  /** Configurazione condivisa del team (lingua, parole chiave del filtro). */
  @Get('team/config')
  teamConfig () {
    return this.node.teamConfig()
  }

  /**
   * Configura Claude Code (MCP + hook di fine sessione) come `micelio setup claude-code`.
   * Modifica la configurazione dell'utente: la UI chiede conferma prima di chiamarla.
   */
  @Post('setup/claude-code')
  @HttpCode(200)
  setupClaudeCode (@Body() body: unknown) {
    const { hook } = SetupBody.parse(body ?? {})
    const { host, port, token } = this.options.config
    const h = host === '0.0.0.0' ? '127.0.0.1' : host
    try {
      return setupClaudeCode({ mcpUrl: `http://${h}:${port}/mcp`, token, home: this.options.paths.home, hook })
    } catch (err) {
      // Errori di configurazione (claude assente, settings.json non valido) → 400 leggibile.
      throw err instanceof IntegrationError ? new UserError(err.message) : err
    }
  }
}
