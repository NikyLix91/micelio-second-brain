/**
 * @file API REST locale del daemon, usata dalla CLI `micelio` (e in futuro dalla UI).
 *
 * Il controller è volutamente "sottile": valida l'input HTTP con zod e chiama il MicelioNode.
 * Tutta la logica sta nel nodo, così CLI, MCP e UI si comportano allo stesso modo.
 *
 * Tutte le rotte richiedono il token (TokenGuard), tranne /api/health.
 * Gli errori diventano JSON `{ error }` tramite ErrorFilter (400 per errori dell'utente).
 */
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, SetMetadata } from '@nestjs/common'
import { z } from 'zod'
import { MEMORY_KINDS } from '../core/events'
import { MicelioService } from './micelio.service'
import { shutdownSignal } from './shutdown'
import { PUBLIC_ROUTE } from './tokens'

// ── Schemi dei body ───────────────────────────────────────────────────────────────────
const InitBody = z.object({ team: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(100) })
const JoinBody = z.object({ code: z.string().trim().min(10), name: z.string().trim().min(1).max(100) })
/** Payload dell'hook SessionEnd di Claude Code, inoltrato da `micelio hook session-end`. */
const SessionBody = z.object({ session_id: z.string().min(1), transcript_path: z.string().min(1), cwd: z.string().min(1) })
const WatchBody = z.object({ path: z.string().min(1) })
const ConfigBody = z.object({ key: z.string().min(1).max(100), value: z.unknown() })
/** Modifiche facoltative in approvazione di un elemento dell'inbox. */
const ApproveBody = z.object({
  title: z.string().min(3).max(200).optional(),
  body: z.string().min(1).max(20_000).optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  tags: z.array(z.string()).max(20).optional()
}).default({})

@Controller('api')
export class ApiController {
  constructor (private readonly micelio: MicelioService) {}

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

  @Get('memories/search')
  recall (@Query('q') q = '', @Query('limit') limit = '5') {
    // Il limite arriva come stringa dalla query: lo riportiamo fra 1 e 50.
    return this.node.recall(q, Math.min(Math.max(Number(limit) || 5, 1), 50))
  }

  @Get('memories/:id')
  get (@Param('id') id: string) {
    return this.node.get(id) ?? { error: 'non trovato' }
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

  /** Elabora subito il prossimo lavoro in coda (utile per provare senza aspettare il worker). */
  @Post('ingest/run')
  @HttpCode(200)
  async ingestRun () {
    return { processed: await this.node.processQueue() }
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
}
