// Server MCP di Micelio (DESIGN §11). Indipendente dal trasporto: il daemon lo collega a
// Streamable HTTP, ma lo stesso server funzionerebbe su stdio.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { MEMORY_KINDS } from '../core/events'
import type { RecallHit } from '../core/model'
import type { MicelioNode } from '../node/micelio-node'

const VERSION = '0.1.0'

const INSTRUCTIONS = `Micelio è la memoria condivisa del team di sviluppo: ogni ricordo salvato qui arriva a TUTTI i colleghi.
- All'inizio di un task non banale usa "recall" per cercare soluzioni, decisioni e gotcha già noti al team.
- Usa "remember" solo quando l'utente lo chiede o conferma, e solo per conoscenza tecnica riutilizzabile
  (soluzioni verificate, decisioni con il loro perché, gotcha, procedure).
- NON salvare mai dati personali, valutazioni di persone, questioni HR, credenziali, segreti o dati di clienti.`

function formatHit (h: RecallHit): string {
  const who = h.authorName ?? h.author.slice(0, 8)
  const tags = h.tags.length ? `  #${h.tags.join(' #')}` : ''
  return `### ${h.title}\n[${h.kind}] id:${h.id.slice(0, 12)} · ${who} · ${new Date(h.ts).toISOString().slice(0, 10)}${tags}\n\n${h.body}`
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
const error = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true })

export function createMcpServer (node: MicelioNode): McpServer {
  const server = new McpServer({ name: 'micelio', version: VERSION }, { instructions: INSTRUCTIONS })

  server.registerTool('recall', {
    title: 'Cerca nella memoria del team',
    description: 'Cerca nella memoria condivisa del team soluzioni, decisioni, gotcha e procedure. Usa parole chiave specifiche (tecnologie, errori, nomi di componenti).',
    inputSchema: {
      query: z.string().min(2).describe('Parole chiave da cercare'),
      limit: z.number().int().min(1).max(20).optional().describe('Numero massimo di risultati (default 5)')
    },
    annotations: { readOnlyHint: true }
  }, async ({ query, limit }) => {
    const hits = node.recall(query, limit ?? 5)
    if (hits.length === 0) return text(`Nessun ricordo del team trovato per "${query}".`)
    return text(hits.map(formatHit).join('\n\n---\n\n'))
  })

  server.registerTool('remember', {
    title: 'Salva nella memoria del team',
    description: 'Salva un ricordo atomico nella memoria condivisa: verrà replicato su tutti i nodi del team. ' +
      'Il ricordo deve essere autosufficiente (comprensibile senza questa conversazione), tecnico e riutilizzabile. ' +
      'Mai dati personali, valutazioni di persone, credenziali o dati di clienti.',
    inputSchema: {
      title: z.string().min(3).max(200).describe('Una riga autoesplicativa'),
      body: z.string().min(1).max(20_000).describe('Contenuto in Markdown, conciso: il cosa e soprattutto il perché'),
      kind: z.enum(MEMORY_KINDS).optional().describe('fact | howto | decision | gotcha | snippet | reference'),
      tags: z.array(z.string()).max(20).optional().describe('Tecnologie, progetti, domini (es. angular, ci)')
    }
  }, async ({ title, body, kind, tags }) => {
    try {
      const { id, duplicate } = await node.remember({ title, body, kind, tags, source: { type: 'mcp' } })
      return text(duplicate ? `Già presente nella memoria del team (id:${id.slice(0, 12)}).` : `Salvato nella memoria del team (id:${id.slice(0, 12)}).`)
    } catch (err) {
      return error(`Impossibile salvare: ${(err as Error).message}`)
    }
  })

  server.registerTool('get', {
    title: 'Leggi un ricordo',
    description: 'Restituisce un ricordo completo dato il suo id (anche abbreviato, come mostrato da recall).',
    inputSchema: { id: z.string().min(6).describe('Id del ricordo') },
    annotations: { readOnlyHint: true }
  }, async ({ id }) => {
    const hit = node.get(id)
    return hit ? text(formatHit(hit)) : error(`Nessun ricordo con id ${id}`)
  })

  return server
}
