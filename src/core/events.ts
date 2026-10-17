// Schema degli eventi replicati nel log del team (DESIGN §4.1).
// Ogni evento è appeso al feed del nodo autore; l'autore NON è nel payload ma viene dal feed
// (node.from in apply), quindi non può essere falsificato.
import { createHash } from 'node:crypto'
import { z } from 'zod'

export const MEMORY_KINDS = ['fact', 'howto', 'decision', 'gotcha', 'snippet', 'reference'] as const
export const MemoryKind = z.enum(MEMORY_KINDS)
export type MemoryKind = z.infer<typeof MemoryKind>

const hexKey = z.string().regex(/^[0-9a-f]{64}$/, 'chiave esadecimale di 32 byte')

export const MemoryInput = z.object({
  kind: MemoryKind.default('fact'),
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(20_000),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(50)).max(20).default([]),
  source: z.object({
    type: z.enum(['mcp', 'cli', 'api']),
    ref: z.string().max(200).optional()
  }).default({ type: 'api' })
})
export type MemoryInput = z.input<typeof MemoryInput>
export type MemoryData = z.output<typeof MemoryInput>

const base = { v: z.literal(1), ts: z.number().int().nonnegative() }

export const TeamEvent = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('team.init'), name: z.string().min(1).max(100), founderName: z.string().min(1).max(100) }),
  z.object({ ...base, type: z.literal('memory.add'), memory: MemoryInput }),
  z.object({ ...base, type: z.literal('invite.add'), id: hexKey, publicKey: hexKey, expires: z.number().int() }),
  z.object({ ...base, type: z.literal('invite.del'), id: hexKey }),
  z.object({ ...base, type: z.literal('member.add'), key: hexKey, name: z.string().min(1).max(100), inviteId: hexKey.optional() }),
  z.object({ ...base, type: z.literal('member.remove'), key: hexKey }),
  z.object({ ...base, type: z.literal('member.promote'), key: hexKey }),
  z.object({ ...base, type: z.literal('team.config'), key: z.string().min(1).max(100), value: z.unknown() })
])
export type TeamEvent = z.infer<typeof TeamEvent>

/** Payload di un evento, senza i campi di envelope che aggiunge `envelope()`. */
export type EventPayload = TeamEvent extends infer E ? (E extends TeamEvent ? Omit<E, 'v' | 'ts'> : never) : never

export function envelope (payload: EventPayload, now = Date.now()): TeamEvent {
  return TeamEvent.parse({ ...payload, v: 1, ts: now })
}

/** Id content-addressed: lo stesso ricordo scritto da due nodi produce lo stesso id (DESIGN §4.2). */
export function memoryId (m: Pick<MemoryData, 'kind' | 'title' | 'body'>): string {
  const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  return createHash('sha256').update(`${m.kind}\n${normalize(m.title)}\n${normalize(m.body)}`).digest('hex')
}
