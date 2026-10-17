// API REST locale del daemon, usata dalla CLI `micelio`.
import { Body, Controller, Get, HttpCode, Param, Post, Query, SetMetadata } from '@nestjs/common'
import { z } from 'zod'
import { MicelioService } from './micelio.service'
import { shutdownSignal } from './shutdown'
import { PUBLIC_ROUTE } from './tokens'

const InitBody = z.object({ team: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(100) })
const JoinBody = z.object({ code: z.string().trim().min(10), name: z.string().trim().min(1).max(100) })

@Controller('api')
export class ApiController {
  constructor (private readonly micelio: MicelioService) {}

  private get node () { return this.micelio.node }

  @Get('health')
  @SetMetadata(PUBLIC_ROUTE, true)
  health () {
    return { ok: true, pid: process.pid }
  }

  @Get('status')
  status () {
    return this.node.status()
  }

  @Post('team/init')
  init (@Body() body: unknown) {
    const { team, name } = InitBody.parse(body)
    return this.node.init(team, name)
  }

  @Post('team/join')
  join (@Body() body: unknown) {
    const { code, name } = JoinBody.parse(body)
    return this.node.join(code, name)
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

  @Post('memories')
  remember (@Body() body: Record<string, unknown>) {
    return this.node.remember({ ...body, source: { type: 'cli' } } as any)
  }

  @Get('memories/search')
  recall (@Query('q') q = '', @Query('limit') limit = '5') {
    return this.node.recall(q, Math.min(Math.max(Number(limit) || 5, 1), 50))
  }

  @Get('memories/:id')
  get (@Param('id') id: string) {
    return this.node.get(id) ?? { error: 'non trovato' }
  }

  @Post('shutdown')
  @HttpCode(202)
  shutdown () {
    // Risponde subito, poi chiude ordinatamente (vedi shutdown.ts).
    setTimeout(() => shutdownSignal.emit('shutdown'), 100)
    return { ok: true }
  }
}
