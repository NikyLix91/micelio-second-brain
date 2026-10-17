// Nodo Micelio: orchestra rete (TeamNode), indice di ricerca ed export. Non dipende da NestJS:
// il daemon lo espone via HTTP/MCP, i test lo usano direttamente.
import fs from 'node:fs'
import { MemoryInput, memoryId, type MemoryData } from '../core/events'
import type { InviteRecord, MemberRecord, NodeStatus, RecallHit } from '../core/model'
import type { NodePaths } from '../core/paths'
import { writeExport } from '../export/markdown'
import { TeamNode } from '../net/team-node'
import { MemoryIndex } from '../store/memory-index'
import { loadState, saveState } from './config'

export interface MicelioNodeOptions {
  bootstrap?: { host: string, port: number }[]
  log?: (msg: string) => void
  /** Ritardo di accorpamento degli aggiornamenti della vista prima di reindicizzare. */
  materializeDelayMs?: number
}

export class UserError extends Error {}

export class MicelioNode {
  private team: TeamNode | null = null
  private nodeName: string | null = null
  private readonly index: MemoryIndex
  private timer: NodeJS.Timeout | null = null
  private materializing: Promise<void> = Promise.resolve()
  private readonly log: (msg: string) => void

  constructor (private readonly paths: NodePaths, private readonly opts: MicelioNodeOptions = {}) {
    this.log = opts.log ?? (() => {})
    fs.mkdirSync(paths.home, { recursive: true })
    this.index = new MemoryIndex(paths.index)
  }

  /** Avvia il nodo: se il team è già configurato si ricollega alla rete. */
  async start (): Promise<void> {
    const state = loadState(this.paths)
    if (!state) {
      this.log('nodo non ancora configurato: usa `micelio init` o `micelio join`')
      return
    }
    this.nodeName = state.nodeName
    const team = this.newTeamNode()
    await team.open(state)
    this.attach(team)
    await this.materialize()
  }

  async stop (): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    await this.materializing.catch(() => {})
    await this.team?.close()
    this.team = null
    this.index.close()
  }

  // ---------- Team ----------

  async init (teamName: string, nodeName: string): Promise<NodeStatus> {
    this.assertNotConfigured()
    const team = this.newTeamNode()
    try {
      const secrets = await team.create(teamName, nodeName)
      saveState(this.paths, { nodeName, ...secrets })
    } catch (err) {
      await team.close()
      throw err
    }
    this.nodeName = nodeName
    this.attach(team)
    await this.materialize()
    return this.status()
  }

  async join (code: string, nodeName: string): Promise<NodeStatus> {
    this.assertNotConfigured()
    const team = this.newTeamNode()
    try {
      const secrets = await team.join(code, nodeName)
      saveState(this.paths, { nodeName, ...secrets })
    } catch (err) {
      await team.close()
      throw err
    }
    this.nodeName = nodeName
    this.attach(team)
    await this.materialize()
    return this.status()
  }

  async invite (): Promise<{ code: string, expires: number, replicated: boolean }> {
    return this.requireTeam().createInvite()
  }

  async invites (): Promise<InviteRecord[]> {
    return this.requireTeam().invites()
  }

  async members (): Promise<MemberRecord[]> {
    return this.requireTeam().members()
  }

  async removeMember (ref: string): Promise<MemberRecord> {
    await this.requireAdmin()
    const target = await this.resolveMember(ref)
    if (target.key === this.team?.localKey) throw new UserError('Un nodo non può espellere se stesso')
    await this.requireTeam().append({ type: 'member.remove', key: target.key })
    await this.sync()
    return target
  }

  async promoteMember (ref: string): Promise<MemberRecord> {
    await this.requireAdmin()
    const target = await this.resolveMember(ref)
    await this.requireTeam().append({ type: 'member.promote', key: target.key })
    await this.sync()
    return target
  }

  // ---------- Ricordi ----------

  async remember (input: MemoryInput): Promise<{ id: string, duplicate: boolean }> {
    const team = this.requireTeam()
    const parsed = MemoryInput.safeParse(input)
    if (!parsed.success) throw new UserError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    const memory: MemoryData = parsed.data
    const id = memoryId(memory)
    const duplicate = this.index.get(id)?.id === id
    if (!duplicate) {
      await team.append({ type: 'memory.add', memory })
      await this.sync()
    }
    return { id, duplicate }
  }

  recall (query: string, limit = 5): RecallHit[] {
    return this.index.search(query, limit)
  }

  get (id: string): RecallHit | null {
    return this.index.get(id)
  }

  // ---------- Stato ----------

  async status (): Promise<NodeStatus> {
    const team = this.team
    if (!team) {
      return { configured: false, nodeName: this.nodeName, nodeKey: null, team: null, writable: false, indexer: false, role: null, peers: 0, members: 0, memories: 0 }
    }
    const members = (await team.members()).filter((m) => !m.removed)
    const me = members.find((m) => m.key === team.localKey)
    return {
      configured: true,
      nodeName: this.nodeName,
      nodeKey: team.localKey,
      team: await team.team(),
      writable: team.writable,
      indexer: team.isIndexer,
      role: me?.role ?? null,
      peers: team.peers,
      members: members.length,
      memories: this.index.count()
    }
  }

  /** Allinea la vista e l'indice locali con quanto già replicato. */
  async sync (): Promise<void> {
    await this.requireTeam().update()
    await this.materialize()
  }

  // ---------- Interni ----------

  private newTeamNode (): TeamNode {
    return new TeamNode({ storeDir: this.paths.store, bootstrap: this.opts.bootstrap, log: this.log })
  }

  private attach (team: TeamNode): void {
    this.team = team
    team.on('update', () => this.scheduleMaterialize())
  }

  private scheduleMaterialize (): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.materialize().catch((err) => this.log(`errore di indicizzazione: ${err.message}`))
    }, this.opts.materializeDelayMs ?? 250)
  }

  /**
   * Ricostruisce indice ed export dalla vista. Per l'MVP è una ricostruzione completa: con
   * migliaia di ricordi costa decine di millisecondi. L'aggiornamento incrementale è in Fase 4.
   */
  private materialize (): Promise<void> {
    this.materializing = this.materializing.catch(() => {}).then(async () => {
      const team = this.team
      if (!team) return
      const [memories, members] = await Promise.all([team.memories(), team.members()])
      this.index.rebuild(memories, members)
      writeExport(this.paths.export, memories, members)
    })
    return this.materializing
  }

  private requireTeam (): TeamNode {
    if (!this.team) throw new UserError('Nodo non configurato: esegui prima `micelio init` o `micelio join`')
    return this.team
  }

  /**
   * Le azioni da admin vengono rifiutate già qui, oltre che in apply. Motivo: apply valuta i
   * permessi nell'ordine linearizzato, e un'espulsione emessa da un membro CONCORRENTEMENTE
   * alla sua promozione potrebbe essere ordinata dopo la promozione e quindi accettata.
   */
  private async requireAdmin (): Promise<void> {
    await this.sync()
    if ((await this.status()).role !== 'admin') throw new UserError('Operazione riservata agli admin del team')
  }

  private assertNotConfigured (): void {
    if (this.team || loadState(this.paths)) throw new UserError('Questo nodo appartiene già a un team')
  }

  /** Trova un membro per chiave (anche abbreviata, min 6 caratteri) o per nome esatto. */
  private async resolveMember (ref: string): Promise<MemberRecord> {
    const all = (await this.requireTeam().members()).filter((m) => !m.removed)
    const byName = all.filter((m) => m.name === ref)
    const byKey = ref.length >= 6 ? all.filter((m) => m.key.startsWith(ref.toLowerCase())) : []
    const found = byName.length ? byName : byKey
    if (found.length === 0) throw new UserError(`Nessun membro attivo corrisponde a "${ref}"`)
    if (found.length > 1) throw new UserError(`"${ref}" è ambiguo: usa una parte più lunga della chiave`)
    return found[0]
  }
}
