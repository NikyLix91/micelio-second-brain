/**
 * @file Server MCP di Micelio (DESIGN §11): ciò che gli agenti AI vedono della memoria del team.
 *
 * Indipendente dal trasporto: il daemon lo collega a Streamable HTTP (src/daemon/mcp.controller.ts),
 * ma lo stesso server funzionerebbe su stdio. Viene creato a ogni richiesta (modalità stateless),
 * quindi non deve tenere stato proprio: tutto lo stato sta nel MicelioNode.
 *
 * Le DESCRIZIONI dei tool e le ISTRUZIONI del server sono a tutti gli effetti dei prompt: è ciò che
 * guida l'agente su quando cercare, quando salvare e cosa non salvare mai. Vanno curate come codice.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { MEMORY_KINDS } from '../core/events'
import type { RecallHit } from '../core/model'
import type { MicelioNode } from '../node/micelio-node'

const VERSION = '0.2.0'

/** Istruzioni inviate all'agente alla connessione. */
const INSTRUCTIONS = `Micelio è la memoria condivisa del team di sviluppo: ogni ricordo salvato qui arriva a TUTTI i colleghi.
- All'inizio di un task non banale usa "recall" per cercare soluzioni, decisioni e gotcha già noti al team.
- Usa "remember" solo quando l'utente lo chiede o lo conferma, e solo per conoscenza tecnica riutilizzabile
  (soluzioni verificate, decisioni con il loro perché, gotcha, procedure).
- Quando salvi, scrivi SOLO ciò che l'utente ha detto o che è stato dimostrato nella sessione: non aggiungere
  dettagli, cause o raccomandazioni tue. Dopo il salvataggio mostra all'utente il testo salvato.
- NON salvare mai dati personali, valutazioni di persone, questioni HR, credenziali, segreti o dati di clienti.
- Alcuni ricordi finiscono nell'inbox dell'utente per una verifica: puoi proporgli di rivederli con "inbox_review".`

/** Formatta un risultato di ricerca come Markdown compatto (titolo, metadati, corpo). */
function formatHit (h: RecallHit): string {
  const who = h.authorName ?? h.author.slice(0, 8)
  const tags = h.tags.length ? `  #${h.tags.join(' #')}` : ''
  return `### ${h.title}\n[${h.kind}] id:${h.id.slice(0, 12)} · ${who} · ${new Date(h.ts).toISOString().slice(0, 10)}${tags}\n\n${h.body}`
}

/** Risposta testuale di un tool. */
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
/** Risposta d'errore: l'agente la vede come fallimento del tool e può correggersi. */
const error = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true })

/**
 * Crea un server MCP collegato a un nodo.
 * @param node il nodo locale: tutte le operazioni passano dai suoi metodi pubblici
 */
export function createMcpServer (node: MicelioNode): McpServer {
  const server = new McpServer({ name: 'micelio', version: VERSION }, { instructions: INSTRUCTIONS })

  // ── recall ──────────────────────────────────────────────────────────────────────────
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

  // ── remember ────────────────────────────────────────────────────────────────────────
  // Passa da filtro e classificazione (D6). La risposta riporta SEMPRE il testo salvato,
  // così l'utente vede cosa è stato scritto a suo nome (problema emerso in Fase 1).
  server.registerTool('remember', {
    title: 'Salva nella memoria del team',
    description: 'Propone un ricordo atomico per la memoria condivisa del team. Prima di arrivare ai colleghi passa da un filtro privacy: ' +
      'può essere pubblicato, messo in attesa di verifica dell\'utente (inbox) o trattenuto come privato. ' +
      'Il ricordo deve essere autosufficiente, tecnico, riutilizzabile e fedele a quanto detto: niente dettagli inventati. ' +
      'Mai dati personali, valutazioni di persone, credenziali o dati di clienti.',
    inputSchema: {
      title: z.string().min(3).max(200).describe('Una riga autoesplicativa'),
      body: z.string().min(1).max(20_000).describe('Contenuto in Markdown, conciso: il cosa e soprattutto il perché'),
      kind: z.enum(MEMORY_KINDS).optional().describe('fact | howto | decision | gotcha | snippet | reference'),
      tags: z.array(z.string()).max(20).optional().describe('Tecnologie, progetti, domini (es. angular, ci)')
    }
  }, async ({ title, body, kind, tags }) => {
    try {
      const r = await node.remember({ title, body, kind, tags, source: { type: 'mcp' } })
      switch (r.outcome) {
        case 'team':
          return text(`${r.duplicate ? 'Già presente' : 'Pubblicato'} nella memoria del team (id:${r.id.slice(0, 12)}). Testo salvato:\n\n### ${r.memory.title}\n${r.memory.body}`)
        case 'inbox':
          return text(`NON pubblicato subito: è nell'inbox dell'utente in attesa di verifica (id inbox: ${r.inboxId}).\nMotivo: ${r.reason}\nL'utente può approvarlo con "micelio inbox approve ${r.inboxId}" o chiedendoti di usare inbox_decide.`)
        case 'private':
          return text(`NON pubblicato: trattenuto come privato. Motivo: ${r.reason}`)
      }
    } catch (err) {
      return error(`Impossibile salvare: ${(err as Error).message}`)
    }
  })

  // ── get ─────────────────────────────────────────────────────────────────────────────
  server.registerTool('get', {
    title: 'Leggi un ricordo',
    description: 'Restituisce un ricordo completo dato il suo id (anche abbreviato, come mostrato da recall).',
    inputSchema: { id: z.string().min(6).describe('Id del ricordo') },
    annotations: { readOnlyHint: true }
  }, async ({ id }) => {
    const hit = node.get(id)
    return hit ? text(formatHit(hit)) : error(`Nessun ricordo con id ${id}`)
  })

  // ── inbox_review ────────────────────────────────────────────────────────────────────
  // L'inbox contiene SOLO i casi dubbi (D9). È locale: nessun collega la vede.
  server.registerTool('inbox_review', {
    title: 'Ricordi in attesa di verifica',
    description: 'Elenca i ricordi trattenuti nell\'inbox locale dell\'utente perché il filtro privacy non ha potuto decidere da solo. Mostrali all\'utente e chiedi cosa farne.',
    inputSchema: {},
    annotations: { readOnlyHint: true }
  }, async () => {
    const items = node.inbox()
    if (items.length === 0) return text('L\'inbox è vuota.')
    return text(items.map((i) =>
      `### [${i.id}] ${i.memory.title}\nMotivo: ${i.reason} · scade il ${new Date(i.expires).toISOString().slice(0, 10)}\n\n${i.memory.body}`
    ).join('\n\n---\n\n'))
  })

  // ── inbox_decide ────────────────────────────────────────────────────────────────────
  // Va usato SOLO dopo una decisione esplicita dell'utente: approvare significa pubblicare a tutti.
  server.registerTool('inbox_decide', {
    title: 'Decidi su un ricordo in attesa',
    description: 'Approva (pubblica nel team) o rifiuta un elemento dell\'inbox. Usalo SOLO dopo che l\'utente ha deciso esplicitamente. ' +
      'In approvazione si possono correggere titolo e corpo, per esempio per togliere dettagli sensibili.',
    inputSchema: {
      id: z.string().min(4).describe('Id dell\'elemento in inbox'),
      decision: z.enum(['approve', 'reject']),
      title: z.string().min(3).max(200).optional().describe('Titolo corretto (solo approve)'),
      body: z.string().min(1).max(20_000).optional().describe('Corpo corretto (solo approve)')
    }
  }, async ({ id, decision, title, body }) => {
    try {
      if (decision === 'reject') {
        node.reject(id)
        return text(`Elemento ${id} rifiutato: non verrà condiviso.`)
      }
      const r = await node.approve(id, { ...(title ? { title } : {}), ...(body ? { body } : {}) })
      return text(`Pubblicato nella memoria del team (id:${r.id.slice(0, 12)}):\n\n### ${r.memory.title}\n${r.memory.body}`)
    } catch (err) {
      return error((err as Error).message)
    }
  })

  return server
}
