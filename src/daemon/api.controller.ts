/**
 * @file API REST locale del daemon, usata dalla CLI `micelio` (e in futuro dalla UI).
 *
 * EN: Local REST API of the daemon, used by the `micelio` CLI (and later by the UI).
 *
 * Il controller è volutamente "sottile": valida l'input HTTP con zod e chiama il MicelioNode.
 * Tutta la logica sta nel nodo, così CLI, MCP e UI si comportano allo stesso modo.
 *
 * EN: The controller is deliberately "thin": it validates HTTP input with zod and calls the MicelioNode. All
 * the logic lives in the node, so CLI, MCP and UI behave the same way.
 *
 * Tutte le rotte richiedono il token (TokenGuard), tranne /api/health.
 * Gli errori diventano JSON `{ error }` tramite ErrorFilter (400 per errori dell'utente).
 *
 * EN: Every route requires the token (TokenGuard), except /api/health. Errors become JSON `{ error }`
 * through ErrorFilter (400 for user errors).
 */
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, SetMetadata } from '@nestjs/common'
import { z } from 'zod'
import { readManifest } from '../backup/archive'
import { MEMORY_KINDS, ROOT_CATEGORIES } from '../core/events'
import { claudeMcpStatus, IntegrationError, registerProjectMcp, setupClaudeCode } from '../node/integrations'
import { UserError } from '../node/micelio-node'
import type { DaemonOptions } from './micelio.module'
import { MicelioService } from './micelio.service'
import { shutdownSignal } from './shutdown'
import { DAEMON_OPTIONS, PUBLIC_ROUTE } from './tokens'

// ── Schemi dei body ───────────────────────────────────────────────────────────────────
// EN: Body schemas
/** Nome facoltativo: dal secondo team in poi si usa quello dell'identità personale (B3). / EN: Optional name: from the second team on, the personal identity's name is used (B3). */
const InitBody = z.object({
  team: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100).optional(),
  /** "local" = team solo per sé, senza rete (B4); assente = DHT pubblica come sempre. / EN: "local" = team just for yourself, no network (B4); missing = public DHT as always. */
  network: z.enum(['public', 'local']).optional()
})
const JoinBody = z.object({ code: z.string().trim().min(10), name: z.string().trim().min(1).max(100).optional() })
/** Richiesta di contesto degli hook di Claude Code (B4). / EN: Context request from the Claude Code hooks (B4). */
const ContextBody = z.object({
  event: z.enum(['session-start', 'prompt']),
  cwd: z.string().min(1).max(1000),
  session_id: z.string().max(200).optional(),
  prompt: z.string().max(50_000).optional()
})
/** Impostazioni del contesto automatico (B4). / EN: Automatic context settings (B4). */
const ContextSettingsBody = z.object({
  sessionStart: z.boolean().optional(),
  prompt: z.boolean().optional(),
  maxChars: z.number().int().min(500).max(20_000).optional()
})
/** Registrazione MCP per una cartella di progetto, sul team della richiesta (B3). / EN: MCP registration for a project folder, on the request's team (B3). */
const ProjectBody = z.object({ path: z.string().min(1) })
/** «Pubblica in…» dall'Inbox (0.6.1). / EN: «Pubblica in…» (Publish to…) from the Inbox (0.6.1). */
const MoveBody = z.object({ team: z.string().min(1).max(200), publish: z.boolean().default(true) })
/** Payload dell'hook SessionEnd di Claude Code, inoltrato da `micelio hook session-end`. / EN: Payload of the Claude Code SessionEnd hook, forwarded by `micelio hook session-end`. */
const SessionBody = z.object({ session_id: z.string().min(1), transcript_path: z.string().min(1), cwd: z.string().min(1) })
const WatchBody = z.object({ path: z.string().min(1) })
/** Cartella di documenti: percorso e se gli originali sono scaricabili dai colleghi (D10). / EN: Document folder: path, and whether colleagues can download the originals (D10). */
const DocFolderBody = z.object({ path: z.string().min(1), shareable: z.boolean().default(false), roots: z.boolean().default(false) })
const ConfigBody = z.object({ key: z.string().min(1).max(100), value: z.unknown() })
/** Modifiche facoltative in approvazione di un elemento dell'inbox. / EN: Optional edits when approving an Inbox item. */
const ApproveBody = z.object({
  title: z.string().min(3).max(200).optional(),
  body: z.string().min(1).max(20_000).optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  tags: z.array(z.string()).max(20).optional()
}).default({})
/** Impostazioni LLM modificabili a caldo dalla UI. / EN: LLM settings the UI can change on the fly. */
const LlmSettingsBody = z.object({
  classifyModel: z.string().min(1).max(100).optional(),
  distillModel: z.string().min(1).max(100).optional(),
  dailyBudget: z.number().int().min(0).max(100_000).optional()
})
/** Scelta della DHT; il formato dei nodi è controllato da MicelioNode.setNetwork. / EN: DHT choice; the node format is checked by MicelioNode.setNetwork. */
const NetworkBody = z.object({
  mode: z.enum(['public', 'private', 'local']),
  bootstrap: z.array(z.string().max(300)).max(10).optional()
})
const NetworkCheckBody = NetworkBody.partial().default({})
/** Promozione a Radice (o cambio di categoria). / EN: Promotion to Root (or category change). */
const RootBody = z.object({ category: z.enum(ROOT_CATEGORIES) })
/** Filtri dell'elenco delle Radici (query string): `files` separati da virgola. / EN: Filters for the Roots list (query string): comma-separated `files`. */
const RootQuery = z.object({
  project: z.string().max(200).optional(),
  category: z.enum(ROOT_CATEGORIES).optional(),
  files: z.string().max(5000).optional(),
  q: z.string().max(500).optional()
})
/** Regole di sicurezza del team (Fase 9): ogni campo è facoltativo e sostituisce l'elenco intero. / EN: Team security rules (Phase 9): every field is optional and replaces the whole list. */
const SecurityRulesBody = z.object({
  secretPatterns: z.array(z.object({ name: z.string().max(60), regex: z.string().max(300) })).max(100).optional(),
  allow: z.array(z.string().max(300)).max(200).optional(),
  sensitiveFiles: z.array(z.string().max(200)).max(200).optional()
})
/** Banco di prova: un testo (fino a 100 kB) e/o un nome di file. / EN: Test bench: a text (up to 100 kB) and/or a file name. */
const SecurityTestBody = z.object({ text: z.string().max(100_000).default(''), file: z.string().max(500).optional() })
const RedactBody = z.object({ reason: z.string().max(500).default('') }).default({ reason: '' })
/** Backup (B7): file in base64 e password. / EN: Backup (B7): base64 file and password. */
const BackupCreateBody = z.object({ password: z.string().min(1) })
const BackupFileBody = z.object({ data: z.string().min(1) })
const BackupRestoreBody = z.object({ data: z.string().min(1), password: z.string().min(1) })
const BackupNewTeamBody = BackupRestoreBody.extend({ teamName: z.string().max(100).optional(), name: z.string().max(100).optional(), network: z.enum(['public', 'private', 'local']).optional() })
const BackupSettingsBody = z.object({ enabled: z.boolean().optional(), folder: z.string().max(1000).optional(), keep: z.number().int().min(1).max(365).optional(), password: z.string().max(200).optional() })
/** Chat (B10): domanda e conversazione (assente = nuova). / EN: Chat (B10): question and conversation (missing = new one). */
const ChatBody = z.object({ question: z.string().trim().min(3).max(2000), chatId: z.number().int().positive().optional() })
const VoteBody = z.object({ delta: z.union([z.literal(-1), z.literal(0), z.literal(1)]) })
const SetupBody = z.object({ hook: z.boolean().default(true), context: z.boolean().default(true) }).default({ hook: true, context: true })

@Controller('api')
export class ApiController {
  constructor (
    private readonly micelio: MicelioService,
    @Inject(DAEMON_OPTIONS) private readonly options: DaemonOptions
  ) {}

  private get node () { return this.micelio.node }

  // ═══════════════════════════════ Servizio ═══════════════════════════════
  // EN: Service

  /** Usata da `micelio start` per sapere quando il daemon è pronto. Unica rotta pubblica. / EN: Used by `micelio start` to know when the daemon is ready. The only public route. */
  @Get('health')
  @SetMetadata(PUBLIC_ROUTE, true)
  health () {
    return { ok: true, pid: process.pid }
  }

  @Get('status')
  status () {
    return this.node.status()
  }

  /** Chiusura ordinata (vedi shutdown.ts per il perché non usiamo i segnali). / EN: Orderly shutdown (see shutdown.ts for why we don't use signals). */
  @Post('shutdown')
  @HttpCode(202)
  shutdown () {
    // Prima rispondiamo, poi chiudiamo: altrimenti la CLI vedrebbe la connessione cadere.
    // EN: Reply first, then close: otherwise the CLI would see the connection drop.
    setTimeout(() => shutdownSignal.emit('shutdown'), 100)
    return { ok: true }
  }

  // ═════════════════════════════════ Team ═════════════════════════════════
  // EN: Team

  /**
   * Crea un team. Con B3 si AGGIUNGE a quelli già presenti su questo PC (non serve più che il
   * nodo sia vuoto). Risponde con lo stato del nuovo team e il suo id locale.
   *
   * EN: Creates a team. With B3 it is ADDED to the ones already on this PC (the node no longer needs to be
   * empty). Replies with the new team's status and its local id.
   */
  @Post('team/init')
  async init (@Body() body: unknown) {
    const { team, name, network } = InitBody.parse(body)
    const { id, status } = await this.micelio.host.createTeam(team, name, network)
    return { ...status, teamId: id }
  }

  // ═══════════════════════════ Backup e ripristino (B7) ═══════════════════════════
  // EN: Backup and restore (B7)

  /** Crea il backup del team corrente: il file torna in base64 con nome suggerito e contenuto. / EN: Creates the backup of the current team: the file comes back in base64, with a suggested name and its contents. */
  @Post('backup')
  @HttpCode(200)
  async createBackup (@Body() body: unknown) {
    const { file, name, manifest } = await this.node.createBackup(BackupCreateBody.parse(body).password)
    return { name, manifest, data: file.toString('base64') }
  }

  /** Cosa contiene un file di backup (parte in chiaro): si mostra prima di chiedere la password. / EN: What a backup file contains (plain-text part): shown before asking for the password. */
  @Post('backup/manifest')
  @HttpCode(200)
  backupManifest (@Body() body: unknown) {
    return readManifest(Buffer.from(BackupFileBody.parse(body).data, 'base64'))
  }

  /** Ripristina un backup DENTRO il team corrente (solo admin). / EN: Restores a backup INTO the current team (admin only). */
  @Post('backup/restore')
  @HttpCode(200)
  restoreBackup (@Body() body: unknown) {
    const { data, password } = BackupRestoreBody.parse(body)
    return this.node.restoreBackup(Buffer.from(data, 'base64'), password)
  }

  /** Ripristina un backup in un team NUOVO su questo PC (chi ripristina ne diventa admin). / EN: Restores a backup into a NEW team on this PC (whoever restores it becomes its admin). */
  @Post('teams/restore')
  @HttpCode(200)
  restoreAsNewTeam (@Body() body: unknown) {
    const { data, password, teamName, name, network } = BackupNewTeamBody.parse(body)
    return this.micelio.host.restoreAsNewTeam(Buffer.from(data, 'base64'), password, { teamName, nodeName: name, network })
  }

  // ═══════════════════════════ Chat sulla memoria (B10) ═══════════════════════════
  // EN: Chat over the memory (B10)

  /** Mappa mentale di una domanda, senza LLM (subito). / EN: Mind map of a question, without the LLM (immediate). */
  @Post('chat/map')
  @HttpCode(200)
  async chatMap (@Body() body: unknown) {
    const { question } = ChatBody.parse(body)
    return (await this.node.chatContext(question)).map
  }

  /** Domanda alla chat: risposta dell'LLM sui ricordi del team, con la mappa. / EN: Chat question: the LLM answer over the team's memories, with the map. */
  @Post('chat/ask')
  @HttpCode(200)
  chatAsk (@Body() body: unknown) {
    const { question, chatId } = ChatBody.parse(body)
    return this.node.askChat(question, chatId)
  }

  /** "Espandi" un ricordo nella mappa: i suoi vicini nella costellazione. / EN: "Expand" a memory in the map: its neighbors in the constellation. */
  @Get('chat/expand/:id')
  chatExpand (@Param('id') id: string) {
    return this.node.chatExpand(id)
  }

  /** "Salva come ricordo" una risposta. / EN: "Save as memory" an answer. */
  @Post('chat/messages/:id/save')
  @HttpCode(200)
  saveChatAnswer (@Param('id') id: string) {
    return this.node.saveChatAnswer(Number(id))
  }

  @Get('chats')
  chats () {
    return this.node.chats()
  }

  @Get('chats/:id')
  chatMessages (@Param('id') id: string) {
    return this.node.chatMessages(Number(id))
  }

  @Put('chats/:id')
  renameChat (@Param('id') id: string, @Body() body: unknown) {
    this.node.renameChat(Number(id), z.object({ title: z.string().max(120) }).parse(body).title)
    return { ok: true }
  }

  @Delete('chats/:id')
  deleteChat (@Param('id') id: string) {
    this.node.deleteChat(Number(id))
    return { ok: true }
  }

  // ═══════════════════════════ Efficacia (B11) ═══════════════════════════
  // EN: Effectiveness (B11)

  /** Consultazioni degli agenti, esiti, ricordi più utili, rumore, sbagliati, domande senza risposta. / EN: Agent queries, outcomes, most useful memories, noise, wrong ones, unanswered questions. */
  @Get('efficacy')
  efficacy (@Query('days') days?: string, @Query('project') project?: string) {
    const d = Math.min(365, Math.max(1, Number(days) || 30))
    return this.node.efficacyReport(d, project || undefined)
  }

  /** Esiti da notificare sul desktop dopo `since` (vuoto se le notifiche sono spente). / EN: Outcomes to show as desktop notifications after `since` (empty if notifications are off). */
  @Get('efficacy/notices')
  efficacyNotices (@Query('since') since?: string) {
    return this.node.efficacyNotices(Number(since) || 0)
  }

  @Put('settings/efficacy')
  updateEfficacy (@Body() body: unknown) {
    return this.node.setEfficacyNotify(z.object({ notify: z.boolean() }).parse(body).notify)
  }

  /** Backup automatici del team corrente (la password non torna mai indietro). / EN: Automatic backups of the current team (the password is never sent back). */
  @Get('settings/backup')
  backupSettings () {
    return this.node.backupSettings()
  }

  @Put('settings/backup')
  async updateBackupSettings (@Body() body: unknown) {
    await this.node.setBackupSettings(BackupSettingsBody.parse(body))
    return this.node.backupSettings()
  }

  /** Entra in un altro team. Può durare fino a 2 minuti: attende che un membro online accolga la richiesta. / EN: Joins another team. Can take up to 2 minutes: it waits for an online member to accept the request. */
  @Post('team/join')
  async join (@Body() body: unknown) {
    const { code, name } = JoinBody.parse(body)
    const { id, status } = await this.micelio.host.joinTeam(code, name)
    return { ...status, teamId: id }
  }

  // ═══════════════════════════════ Più team (B3) ═══════════════════════════════
  // EN: Multiple teams (B3)

  /** I team di questo PC e l'identità personale (senza la chiave segreta). / EN: The teams on this PC and the personal identity (without the secret key). */
  @Get('teams')
  async teams () {
    const id = this.micelio.host.identity()
    return { teams: await this.micelio.host.teams(), identity: id ? { name: id.name, publicKey: id.publicKey } : null }
  }

  /** Sceglie il team predefinito (quello delle richieste senza intestazione x-micelio-team). / EN: Picks the default team (the one used by requests without the x-micelio-team header). */
  @Post('teams/:ref/default')
  @HttpCode(200)
  setDefaultTeam (@Param('ref') ref: string) {
    return this.micelio.host.setDefault(ref)
  }

  /** Toglie un team da questo PC, cancellandone i dati locali (la UI chiede conferma). / EN: Removes a team from this PC, deleting its local data (the UI asks for confirmation). */
  @Delete('teams/:ref')
  leaveTeam (@Param('ref') ref: string) {
    return this.micelio.host.leaveTeam(ref)
  }

  /** Configurazione condivisa del team (solo admin), es. { key: "memory.language", value: "en" }. / EN: Shared team configuration (admin only), e.g. { key: "memory.language", value: "en" }. */
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

  /** `ref` = nome del membro o chiave (anche abbreviata). / EN: `ref` = member name or key (even abbreviated). */
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
  // EN: Memories

  /**
   * Salvataggio esplicito: passa da filtro e classificazione (D6).
   * La risposta dice dove è finito il ricordo: { outcome: 'team' | 'inbox' | 'private', … }.
   * La validazione completa del ricordo la fa il nodo (MemoryInput).
   *
   * EN: Explicit save: goes through the filter and classification (D6). The reply says where the memory
   * ended up: { outcome: 'team' | 'inbox' | 'private', … }. The node does the full validation of the
   * memory (MemoryInput).
   */
  @Post('memories')
  remember (@Body() body: Record<string, unknown>) {
    // `personal: true` = ricordo personale (B4): resta su questo PC, non passa al team
    // EN: `personal: true` = personal memory (B4): it stays on this PC and does not go to the team
    const { personal, ...memory } = body
    if (personal === true) return this.node.rememberPersonal({ ...memory, source: { type: 'cli' } } as any)
    return this.node.remember({ ...memory, source: { type: 'cli' } } as any)
  }

  // ═══════════════════════ Lacune e riepilogo (B4) ═══════════════════════
  // EN: Knowledge gaps and digest (B4)

  /** Le tue ricerche senza risposta (solo su questo PC). / EN: Your searches with no answer (on this PC only). */
  @Get('gaps/mine')
  myGaps () {
    return this.node.myGaps()
  }

  @Delete('gaps/mine/:key')
  dismissGap (@Param('key') key: string) {
    this.node.dismissGap(key)
    return { ok: true }
  }

  /** Segnala al team una tua lacuna (o una domanda scritta a mano: { question }). / EN: Reports one of your knowledge gaps to the team (or a hand-written question: { question }). */
  @Post('gaps/report')
  @HttpCode(200)
  reportGap (@Body() body: unknown) {
    const { key, question } = z.object({ key: z.string().max(400).default(''), question: z.string().max(300).optional() }).parse(body ?? {})
    return this.node.reportGap(key, question)
  }

  /** Lacune segnalate al team. / EN: Knowledge gaps reported to the team. */
  @Get('gaps')
  teamGaps () {
    return this.node.teamGaps()
  }

  @Post('gaps/:id/close')
  @HttpCode(200)
  closeGap (@Param('id') id: string, @Body() body: unknown) {
    const { memory } = z.object({ memory: z.string().max(64).optional() }).default({}).parse(body ?? {})
    return this.node.closeGap(id, memory)
  }

  /** Riepilogo degli ultimi giorni (default 7). / EN: Digest of the last few days (default 7). */
  @Get('digest')
  digest (@Query('days') days = '7') {
    return this.node.digest(Math.min(Math.max(Number(days) || 7, 1), 90))
  }

  // ═══════════════════════════ Ricordi personali (B4) ═══════════════════════════
  // EN: Personal memories (B4)

  @Get('personal')
  personal () {
    return this.node.personal()
  }

  /** Condivide un ricordo personale con il team (filtro e classificazione come un salvataggio). / EN: Shares a personal memory with the team (filter and classification, as for a save). */
  @Post('personal/:id/share')
  @HttpCode(200)
  sharePersonal (@Param('id') id: string) {
    return this.node.sharePersonal(id)
  }

  @Delete('personal/:id')
  async deletePersonal (@Param('id') id: string) {
    await this.node.deletePersonal(id)
    return { ok: true }
  }

  /** Un elemento dell'inbox resta come ricordo personale invece di andare al team. / EN: An Inbox item stays as a personal memory instead of going to the team. */
  @Post('inbox/:id/keep')
  @HttpCode(200)
  keepPersonal (@Param('id') id: string) {
    return this.node.keepPersonal(id)
  }

  /** Costellazione del sapere per la schermata principale della UI. / EN: Knowledge constellation for the UI's main screen. */
  @Get('graph')
  graph () {
    return this.node.graph()
  }

  /** Ultimi ricordi (dal più recente). Dichiarata prima di memories/:id per non esserne "catturata". / EN: Latest memories (newest first). Declared before memories/:id so it is not "captured" by it. */
  @Get('memories')
  recent (@Query('limit') limit = '20') {
    return this.node.recent(Math.min(Math.max(Number(limit) || 20, 1), 200))
  }

  /** Ricordi il cui codice citato è cambiato dopo la scrittura (B4). Prima di memories/:id. / EN: Memories whose cited code changed after they were written (B4). Before memories/:id. */
  @Get('memories/stale')
  staleMemories () {
    return this.node.staleMemories()
  }

  /** Ricontrolla subito il codice citato dai ricordi (repository di questo PC). / EN: Rechecks now the code cited by memories (repositories on this PC). */
  @Post('memories/stale/check')
  @HttpCode(200)
  checkStale () {
    return this.node.checkStaleness()
  }

  /** Ricerca ibrida (parole chiave + significato + attivazione, Fase 5). / EN: Hybrid search (keywords + meaning + activation, Phase 5). */
  @Get('memories/search')
  recall (@Query('q') q = '', @Query('limit') limit = '5') {
    // Il limite arriva come stringa dalla query: lo riportiamo fra 1 e 50.
    // EN: The limit comes in as a string from the query: we clamp it between 1 and 50.
    return this.node.recallHybrid(q, Math.min(Math.max(Number(limit) || 5, 1), 50))
  }

  /** Voto di utilità: { delta: 1 | -1 | 0 } (0 ritira il voto). / EN: Usefulness vote: { delta: 1 | -1 | 0 } (0 withdraws the vote). */
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

  // ═══════════════════════════ Sicurezza (Fase 9) ═══════════════════════════
  // EN: Security (Phase 9)

  /** Regole in vigore: riconoscitori fissi, file sensibili di default, regole del team. / EN: Rules in force: built-in detectors, default sensitive files, team rules. */
  @Get('security/rules')
  securityRules () {
    return this.node.securityRules()
  }

  /** Aggiorna le regole del team (solo admin): pattern di segreti, eccezioni, file sensibili. / EN: Updates the team rules (admin only): secret patterns, exceptions, sensitive files. */
  @Put('security/rules')
  setSecurityRules (@Body() body: unknown) {
    return this.node.setSecurityRules(SecurityRulesBody.parse(body))
  }

  /** Banco di prova: cosa farebbe il filtro con un testo e/o un nome di file. Non salva nulla. / EN: Test bench: what the filter would do with a text and/or a file name. Saves nothing. */
  @Post('security/test')
  @HttpCode(200)
  securityTest (@Body() body: unknown) {
    const { text, file } = SecurityTestBody.parse(body ?? {})
    return this.node.securityTest(text, file)
  }

  /** Scansione dei ricordi pubblicati con le regole attuali. / EN: Scan of the published memories with the current rules. */
  @Get('security/scan')
  securityScan () {
    return this.node.securityScan()
  }

  /** Ripulisce un ricordo (solo admin): versione redatta pubblicata, originale rimosso. / EN: Cleans a memory (admin only): redacted version published, original removed. */
  @Post('security/clean/:id')
  @HttpCode(200)
  securityClean (@Param('id') id: string) {
    return this.node.securityClean(id)
  }

  /** Registro di sicurezza locale. / EN: Local security log. */
  @Get('security/log')
  securityLog (@Query('limit') limit?: string) {
    return this.node.securityLog(limit ? Math.min(1000, Math.max(1, Number(limit) || 200)) : 200)
  }

  // ═══════════════════════════════ Radici (Fase 8) ═══════════════════════════════
  // EN: Roots (Phase 8)

  /** Elenco delle Radici, con filtri facoltativi (?project=&category=&files=a,b&q=). / EN: List of Roots, with optional filters (?project=&category=&files=a,b&q=). */
  @Get('roots')
  roots (@Query() query: unknown) {
    const { project, category, files, q } = RootQuery.parse(query ?? {})
    return this.node.roots({ project, category, files: files ? files.split(',').map((f) => f.trim()).filter(Boolean) : undefined, query: q })
  }

  /**
   * Revisione manuale delle Radici (tutte, o quelle in `ids`).
   * ATTENZIONE: dichiarata PRIMA di `roots/:id`, altrimenti "review" verrebbe preso per un id. Può richiedere tempo: usa git e,
   * per le contraddizioni, l'LLM (al massimo 30 confronti).
   *
   * EN: Manual review of the Roots (all of them, or those in `ids`). WARNING: declared BEFORE `roots/:id`,
   * otherwise "review" would be taken as an id. It can take a while: it uses git and, for
   * contradictions, the LLM (at most 30 comparisons).
   */
  @Post('roots/review')
  @HttpCode(200)
  rootReview (@Body() body: unknown) {
    const { ids } = z.object({ ids: z.array(z.string().max(64)).max(500).optional() }).default({}).parse(body ?? {})
    return this.node.rootReview(ids)
  }

  /** File per gli agenti tenuti aggiornati con le Radici (B4). Prima di roots/:id. / EN: Agent files kept up to date with the Roots (B4). Before roots/:id. */
  @Get('roots/agent-files')
  agentFiles () {
    return this.node.agentFiles()
  }

  /** Scrive le Radici in CLAUDE.md / AGENTS.md / regole di Cursor di una cartella (keep = tienilo aggiornato). / EN: Writes the Roots into a folder's CLAUDE.md / AGENTS.md / Cursor rules (keep = keep it up to date). */
  @Post('roots/agent-files')
  @HttpCode(200)
  exportAgentFile (@Body() body: unknown) {
    const b = z.object({ dir: z.string().min(1).max(1000), format: z.enum(['claude', 'agents', 'cursor']), project: z.string().max(200).optional(), keep: z.boolean().default(true) }).parse(body)
    return this.node.exportAgentFile(b)
  }

  @Delete('roots/agent-files')
  removeAgentFile (@Body() body: unknown) {
    const b = z.object({ dir: z.string().min(1).max(1000), format: z.enum(['claude', 'agents', 'cursor']) }).parse(body)
    this.node.removeAgentFile(b.dir, b.format)
    return { ok: true }
  }

  /** Importa come Radici ADR, CLAUDE.md / AGENTS.md o un vault Markdown (file o cartella). / EN: Imports ADRs, CLAUDE.md / AGENTS.md or a Markdown vault (file or folder) as Roots. */
  @Post('roots/import')
  @HttpCode(200)
  importRoots (@Body() body: unknown) {
    const b = z.object({ path: z.string().min(1).max(1000), category: z.enum(ROOT_CATEGORIES).optional() }).parse(body)
    return this.node.importRoots(b.path, b.category)
  }

  /** Radici suggerite dal distillatore su questo nodo, da promuovere o ignorare. / EN: Roots suggested by the distiller on this node, to promote or ignore. */
  @Get('roots/suggestions')
  rootSuggestions () {
    return this.node.rootSuggestions()
  }

  /** Ignora un suggerimento di Radice. / EN: Ignores a Root suggestion. */
  @Delete('roots/suggestions/:id')
  dismissRootSuggestion (@Param('id') id: string) {
    this.node.dismissRootSuggestion(id)
    return { ok: true }
  }

  /** Promuove un ricordo a Radice o ne cambia la categoria (qualunque membro). / EN: Promotes a memory to Root or changes its category (any member). */
  @Post('roots/:id')
  @HttpCode(200)
  rootSet (@Param('id') id: string, @Body() body: unknown) {
    return this.node.rootSet(id, RootBody.parse(body).category)
  }

  /** Il ricordo smette di essere una Radice. / EN: The memory stops being a Root. */
  @Delete('roots/:id')
  async rootUnset (@Param('id') id: string) {
    await this.node.rootUnset(id)
    return { ok: true }
  }

  /** Radice rivista e confermata: segnalazioni azzerate. / EN: Root reviewed and confirmed: reports reset. */
  @Post('roots/:id/confirm')
  @HttpCode(200)
  rootConfirm (@Param('id') id: string) {
    return this.node.rootConfirm(id)
  }

  /**
   * Scarica (o trova in locale) l'originale del documento da cui viene un ricordo (§12-bis).
   * Può richiedere fino a un minuto: il file arriva dal nodo del collega che lo possiede.
   *
   * EN: Downloads (or finds locally) the original of the document a memory comes from (§12-bis). It can take
   * up to a minute: the file comes from the node of the colleague who owns it.
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
  // EN: Ingestion

  /**
   * Chiamata dall'hook SessionEnd di Claude Code. Risponde subito: l'elaborazione avviene in
   * background. Se la cartella non è opt-in risponde `queued: false` con il motivo.
   *
   * EN: Called by the Claude Code SessionEnd hook. Replies immediately: processing happens in the
   * background. If the folder is not opted in, it replies `queued: false` with the reason.
   */
  @Post('ingest/session')
  @HttpCode(200)
  ingestSession (@Body() body: unknown) {
    const s = SessionBody.parse(body)
    // Con più team la sessione va al team della sua cartella, non a quello della richiesta
    // EN: With multiple teams, the session goes to the team of its folder, not to the request's team
    return this.micelio.host.ingestSession({ sessionId: s.session_id, transcriptPath: s.transcript_path, cwd: s.cwd })
  }

  /**
   * Contesto da inserire nella conversazione di un agente (hook `micelio hook session-start` e
   * `micelio hook prompt`). Il team è quello della cartella di lavoro. `context: ''` = niente.
   *
   * EN: Context to inject into an agent's conversation (hooks `micelio hook session-start` and `micelio hook
   * prompt`). The team is the one of the working folder. `context: ''` = nothing.
   */
  @Post('context')
  @HttpCode(200)
  async context (@Body() body: unknown) {
    const b = ContextBody.parse(body)
    return { context: await this.micelio.host.agentContext({ event: b.event, cwd: b.cwd, sessionId: b.session_id, prompt: b.prompt }) }
  }

  @Get('ingest/status')
  ingestStatus () {
    return this.node.ingestStatus()
  }

  /** Controlla subito le trascrizioni (sessioni in corso o perse) e accoda le parti nuove. / EN: Checks the transcripts now (ongoing or lost sessions) and queues the new parts. */
  @Post('ingest/scan')
  @HttpCode(200)
  async ingestScan () {
    return { queued: await this.node.scanSessions() }
  }

  /** Elabora subito il prossimo lavoro in coda (utile per provare senza aspettare il worker). / EN: Processes the next queued job now (handy for testing without waiting for the worker). */
  @Post('ingest/run')
  @HttpCode(200)
  async ingestRun () {
    return { processed: await this.node.processQueue() }
  }

  /** Cartelle di documenti e conteggi per stato (in coda, elaborati, bloccati…). / EN: Document folders and counts by state (queued, processed, blocked…). */
  @Get('documents')
  documents () {
    return { folders: this.node.settings().documents, stats: this.node.documentStats() }
  }

  @Post('documents/folders')
  @HttpCode(200)
  documentsAdd (@Body() body: unknown) {
    const { path, shareable, roots } = DocFolderBody.parse(body)
    return this.node.documentsAdd(path, shareable, roots)
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
  // EN: Inbox and private

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

  /**
   * «Pubblica in…» (0.6.1): sposta un elemento nell'Inbox di un altro team e, con `publish`, lo
   * pubblica subito lì. Serve ai salvataggi trattenuti dal controllo del team (src/core/team-check.ts).
   *
   * EN: «Pubblica in…» (Publish to…) (0.6.1): moves an item to another team's Inbox and, with
   * `publish`, publishes it right away there. For saves held by the team check (src/core/team-check.ts).
   */
  @Post('inbox/:id/move')
  @HttpCode(200)
  moveInbox (@Param('id') id: string, @Body() body: unknown) {
    const { team, publish } = MoveBody.parse(body ?? {})
    return this.micelio.host.moveInbox(this.micelio.host.idOf(this.node), id, team, publish)
  }

  /** Registro di ciò che non è andato al team. Solo locale. / EN: Log of what did not go to the team. Local only. */
  @Get('decisions')
  decisions (@Query('limit') limit = '50') {
    return this.node.decisions(Math.min(Math.max(Number(limit) || 50, 1), 500))
  }

  // ═══════════════════════════════ Dreaming (Fase 6) ═══════════════════════════════
  // EN: Dreaming (Phase 6)

  /** Diario dei sogni del team. / EN: The team's dream journal. */
  @Get('dreams')
  dreams () {
    return this.node.dreams()
  }

  /** Avvia subito un sogno su questo nodo (può richiedere minuti: una chiamata LLM per gruppo). / EN: Starts a dream on this node now (can take minutes: one LLM call per group). */
  @Post('dreams/run')
  @HttpCode(200)
  dreamNow () {
    return this.node.dreamNow()
  }

  /** Ricordi archiviati o sostituiti (storico). / EN: Archived or replaced memories (history). */
  @Get('archive')
  archived () {
    return this.node.archived()
  }

  /** Redazione di un ricordo (solo admin). / EN: Redaction of a memory (admin only). */
  @Post('memories/:id/redact')
  @HttpCode(200)
  async redact (@Param('id') id: string, @Body() body: unknown) {
    await this.node.redact(id, RedactBody.parse(body ?? {}).reason)
    return { ok: true }
  }

  /** Redazioni del team con le conferme dei membri (B12). Visibili a tutti i membri. / EN: The team's redactions with the members' confirmations (B12). Visible to every member. */
  @Get('redactions')
  redactions () {
    return this.node.redactions()
  }

  /** Ricevuta di una redazione: testo leggibile (nella lingua chiesta) e JSON verificabile. / EN: Receipt of a redaction: readable text (in the requested language) and verifiable JSON. */
  @Get('redactions/:id/receipt')
  redactionReceipt (@Param('id') id: string, @Query('lang') lang?: string) {
    return this.node.redactionReceipt(id, lang === 'en' ? 'en' : 'it')
  }

  /** Metriche sintetiche del nodo. / EN: Summary metrics of the node. */
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
  // EN: Settings

  /** Impostazioni locali (LLM, cartelle abilitate, porta). / EN: Local settings (LLM, enabled folders, port). */
  @Get('settings')
  settings () {
    return this.node.settings()
  }

  /** Contesto automatico per gli agenti: cosa inseriscono gli hook (B4). / EN: Automatic context for agents: what the hooks inject (B4). */
  @Put('settings/context')
  updateContext (@Body() body: unknown) {
    return this.node.updateContextSettings(ContextSettingsBody.parse(body))
  }

  /** Modifica modelli e budget LLM (effetto immediato, senza riavvio). / EN: Changes LLM models and budget (immediate effect, no restart). */
  @Put('settings/llm')
  updateLlm (@Body() body: unknown) {
    return this.node.updateLlmSettings(LlmSettingsBody.parse(body))
  }

  /** Rete P2P in uso: DHT pubblica o privata (vedi server/README.md). / EN: P2P network in use: public or private DHT (see server/README.md). */
  @Get('network')
  network () {
    return this.node.networkSettings()
  }

  /**
   * Sceglie la DHT e la applica subito (il nodo si ricollega). Tutti i membri devono usare la
   * stessa: la UI lo ricorda prima di confermare.
   *
   * EN: Picks the DHT and applies it right away (the node reconnects). All members must use the same one:
   * the UI reminds you before confirming.
   */
  @Put('network')
  setNetwork (@Body() body: unknown) {
    const { mode, bootstrap } = NetworkBody.parse(body)
    return this.node.setNetwork(mode, bootstrap)
  }

  /** Diagnosi di una DHT (quella indicata, o quella in uso) senza cambiare nulla. Fino a ~20 s. / EN: Diagnoses a DHT (the given one, or the one in use) without changing anything. Up to ~20 s. */
  @Post('network/check')
  @HttpCode(200)
  checkNetwork (@Body() body: unknown) {
    const { mode, bootstrap } = NetworkCheckBody.parse(body ?? {})
    return this.node.checkNetwork(mode, bootstrap)
  }

  /** Spazio occupato su disco e quota del log del team per membro. / EN: Disk space used and per-member quota of the team log. */
  @Get('storage')
  storage () {
    return this.node.storage()
  }

  /** Qualità della distillazione: metriche per fascia di posizione e indicazione sul limite. / EN: Distillation quality: metrics by position band and a hint about the limit. */
  @Get('distill/quality')
  distillQuality () {
    return this.node.distillQuality()
  }

  /** Configurazione condivisa del team (lingua, parole chiave del filtro). / EN: Shared team configuration (language, filter keywords). */
  @Get('team/config')
  teamConfig () {
    return this.node.teamConfig()
  }

  /**
   * Configura Claude Code (MCP + hook di fine sessione) come `micelio setup claude-code`.
   * Modifica la configurazione dell'utente: la UI chiede conferma prima di chiamarla.
   *
   * EN: Configures Claude Code (MCP + session-end hook) like `micelio setup claude-code`. It changes the
   * user's configuration: the UI asks for confirmation before calling it.
   */
  /**
   * Come è collegato Claude Code (0.6.1): shim giusto, HTTP vecchio o assente, e se il daemon ha
   * appena aggiornato le registrazioni (allora le sessioni già aperte vanno riaperte).
   *
   * EN: How Claude Code is connected (0.6.1): right shim, old HTTP or missing, and whether the
   * daemon has just updated the registrations (then sessions already open must be reopened).
   */
  @Get('setup/claude-code')
  claudeCodeStatus () {
    return claudeMcpStatus(this.options.config.port)
  }

  @Post('setup/claude-code')
  @HttpCode(200)
  setupClaudeCode (@Body() body: unknown) {
    const { hook, context } = SetupBody.parse(body ?? {})
    const { host, port, token } = this.options.config
    const h = host === '0.0.0.0' ? '127.0.0.1' : host
    try {
      return setupClaudeCode({ mcpUrl: `http://${h}:${port}/mcp`, token, home: this.options.paths.home, hook, context })
    } catch (err) {
      // Errori di configurazione (claude assente, settings.json non valido) → 400 leggibile.
      // EN: Configuration errors (claude missing, invalid settings.json) → readable 400.
      throw err instanceof IntegrationError ? new UserError(err.message, err.en) : err
    }
  }

  /**
   * Registra l'MCP del team della richiesta per una cartella di progetto (B3): Claude Code avviato
   * lì parla con questo team invece che con il predefinito. Vedi registerProjectMcp.
   *
   * EN: Registers the MCP of the request's team for a project folder (B3): Claude Code started there talks
   * to this team instead of the default one. See registerProjectMcp.
   */
  @Post('setup/project')
  @HttpCode(200)
  setupProject (@Body() body: unknown) {
    const { path: dir } = ProjectBody.parse(body)
    try {
      return registerProjectMcp(dir, this.options.paths.home)
    } catch (err) {
      throw err instanceof IntegrationError ? new UserError(err.message, err.en) : err
    }
  }
}
