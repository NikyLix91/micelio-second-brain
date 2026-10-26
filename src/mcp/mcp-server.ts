/**
 * @file Server MCP di Micelio (DESIGN §11): ciò che gli agenti AI vedono della memoria del team.
 *
 * EN: Micelio MCP server (DESIGN §11): what AI agents see of the team memory.
 *
 * Indipendente dal trasporto: il daemon lo collega a Streamable HTTP (src/daemon/mcp.controller.ts),
 * ma lo stesso server funzionerebbe su stdio. Viene creato a ogni richiesta (modalità stateless),
 * quindi non deve tenere stato proprio: tutto lo stato sta nel MicelioNode.
 *
 * EN: Transport-agnostic: the daemon wires it to Streamable HTTP (src/daemon/mcp.controller.ts),
 * but the same server would work over stdio. It is created on every request (stateless mode),
 * so it must not hold state of its own: all state lives in the MicelioNode.
 *
 * Le DESCRIZIONI dei tool e le ISTRUZIONI del server sono a tutti gli effetti dei prompt: è ciò che
 * guida l'agente su quando cercare, quando salvare e cosa non salvare mai. Vanno curate come codice.
 *
 * EN: The tool DESCRIPTIONS and the server INSTRUCTIONS are prompts in every respect: they guide
 * the agent on when to search, when to save and what never to save. Treat them like code.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { formatCodeRefs } from '../core/code-refs'
import { MEMORY_KINDS, ROOT_CATEGORIES } from '../core/events'
import type { RecallHit } from '../core/model'
import type { MemoryInput } from '../core/events'
import { teamCheckSolution, type TeamRef } from '../core/team-check'
import type { ExplicitOutcome } from '../ingest/pipeline'
import type { MicelioNode, RootView } from '../node/micelio-node'

/**
 * Salvataggio con il controllo del team (0.6.1): lo fornisce il controller, che conosce la
 * cartella della sessione e tutti i team (MicelioHost.rememberFromAgent).
 *
 * EN: Save with the team check (0.6.1): provided by the controller, which knows the session's
 * folder and all the teams (MicelioHost.rememberFromAgent).
 */
export type AgentRemember = (input: MemoryInput) => Promise<{ outcome: ExplicitOutcome, team: TeamRef }>

const VERSION = '0.2.0'

/** Istruzioni inviate all'agente alla connessione. / EN: Instructions sent to the agent on connection. */
const INSTRUCTIONS = `Micelio è la memoria condivisa del team di sviluppo: ogni ricordo salvato qui arriva a TUTTI i colleghi.
- All'inizio di un task non banale usa "recall" per cercare soluzioni, decisioni e gotcha già noti al team.
- Usa "remember" solo quando l'utente lo chiede o lo conferma, e solo per conoscenza tecnica riutilizzabile
  (soluzioni verificate, decisioni con il loro perché, gotcha, procedure).
- Quando salvi, scrivi SOLO ciò che l'utente ha detto o che è stato dimostrato nella sessione: non aggiungere
  dettagli, cause o raccomandazioni tue. Dopo il salvataggio mostra all'utente il testo salvato.
- NON salvare mai dati personali, valutazioni di persone, questioni HR, credenziali, segreti o dati di clienti.
- Se l'utente chiede di ricordare qualcosa "per sé" (non per il team), usa "remember" con personal: true: resta solo
  sul suo PC. I ricordi PERSONALI compaiono nelle ricerche marcati come tali.
- Un ricordo marcato "CODICE CAMBIATO" cita file modificati dopo la sua scrittura: verifica sul codice attuale prima di fidarti.
- Alcuni ricordi finiscono nell'inbox dell'utente per una verifica: puoi proporgli di rivederli con "inbox_review".
- Se un ricordo viene da un documento e serve approfondire, "fetch_source" scarica l'originale dal collega che lo possiede.
- Le RADICI sono il sapere fondante del team (architettura, mappe di rete, interfacce, modello di dominio,
  best practice, policy di sicurezza). PRIMA di progettare o modificare una parte dell'architettura, o per capire
  come funziona un sistema, chiama "architecture" (con il progetto, cioè il nome della cartella del repository,
  e se puoi i file che stai toccando) e rispetta ciò che dicono. Le Radici "da rivedere" potrebbero non essere
  più aggiornate: segnalalo all'utente.
- Se un ricordo ha riferimenti al codice (Progetto, File, Simboli, Commit) e stai lavorando nello stesso progetto,
  per approfondire apri quei file o usa "git show <commit>"; il codice attuale può essere cambiato dopo il ricordo.`

/**
 * Formatta un ricordo come Markdown (titolo, metadati, riferimenti, corpo).
 *
 * EN: Formats a memory as Markdown (title, metadata, references, body).
 *
 * @param full true per `get` (tutti i riferimenti al codice), false per `recall` (forma compatta)
 *             EN: true for `get` (all code references), false for `recall` (compact form)
 */
function formatHit (h: RecallHit, full = false): string {
  const who = h.authorName ?? h.author.slice(0, 8)
  const tags = h.tags.length ? `  #${h.tags.join(' #')}` : ''
  // Ricordi distillati da un documento: l'agente sa che può chiedere l'originale con fetch_source.
  // EN: Memories distilled from a document: the agent knows it can ask for the original with fetch_source.
  const doc = h.source?.type === 'document' ? `\nFonte: documento «${h.source.name ?? '?'}» (originale disponibile con fetch_source)` : ''
  // Ricordi distillati da una sessione di codice: dove guardare per approfondire.
  // EN: Memories distilled from a coding session: where to look to dig deeper.
  const code = formatCodeRefs(h.source?.code, full).map((l) => '\n' + l).join('')
  return `### ${h.title}\n[${h.kind}] id:${h.id.slice(0, 12)} · ${who} · ${new Date(h.ts).toISOString().slice(0, 10)}${tags}${rootLine(h)}${personalLine(h)}${broughtLine(h)}${staleLine(h)}${doc}${code}\n\n${h.body}`
}

/** Ricordo personale (B4): solo sul PC dell'utente. / EN: Personal memory (B4): only on the user's PC. */
function personalLine (h: RecallHit): string {
  return h.personal ? '\nPERSONALE · solo sul PC dell\'utente, il team non lo vede' : ''
}

/** Portato da una sinapsi d'uso (B12): non contiene per forza le parole cercate. / EN: Brought by a use synapse (B12): it doesn't necessarily contain the searched words. */
function broughtLine (h: RecallHit): string {
  return h.broughtBy ? `\nPORTATO DA id:${h.broughtBy.slice(0, 12)} · nel team serve di solito insieme a quel ricordo` : ''
}

/** Il codice citato è cambiato dopo il ricordo (B4): l'agente deve verificare. / EN: The cited code changed after the memory (B4): the agent must verify. */
function staleLine (h: RecallHit): string {
  if (!h.stale || (!h.stale.commits && !h.stale.missing)) return ''
  const parts = [h.stale.commits ? `${h.stale.commits} commit sui file citati` : '', h.stale.missing ? `${h.stale.missing} file citati non più presenti` : ''].filter(Boolean)
  return `\n⚠ CODICE CAMBIATO dopo questo ricordo (${parts.join(', ')}): verifica sul codice attuale`
}

/** Lunghezza massima della risposta di `architecture` (le Radici sono testi lunghi). / EN: Maximum length of the `architecture` response (Roots are long texts). */
const ARCHITECTURE_MAX_CHARS = 30_000

/** Etichette italiane delle categorie delle Radici. / EN: Italian labels of the Root categories. */
const ROOT_LABEL: Record<string, string> = {
  architecture: 'Architettura', network: 'Rete e infrastruttura', interface: 'Interfacce e contratti',
  domain: 'Dominio', practice: 'Best practice', policy: 'Policy', other: 'Altro'
}

/** Riga di stato di una Radice, aggiunta all'intestazione del ricordo. / EN: Status line of a Root, added to the memory header. */
function rootLine (h: RecallHit): string {
  if (!h.root) return ''
  return `\nRADICE · ${ROOT_LABEL[h.root.category] ?? h.root.category}${h.root.status === 'review' ? ' · ⚠ DA RIVEDERE: potrebbe non essere aggiornata' : ''}`
}

/** Una Radice completa (tool `architecture`), con le eventuali segnalazioni di revisione. / EN: A full Root (`architecture` tool), with any review flags. */
function formatRoot (r: RootView): string {
  const flags = r.status === 'review' && r.flags.length
    ? `\nSegnalazioni: ${r.flags.map((f) => f.reason + (f.refs.length ? ` (${f.refs.slice(0, 5).join(', ')})` : '')).join(' · ')}`
    : ''
  return formatHit(r.memory, true) + flags
}

/** Risposta testuale di un tool. / EN: Text response of a tool. */
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
/** Risposta d'errore: l'agente la vede come fallimento del tool e può correggersi. / EN: Error response: the agent sees it as a tool failure and can correct itself. */
const error = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true })

/**
 * Crea un server MCP collegato a un nodo.
 *
 * EN: Creates an MCP server bound to a node.
 *
 * @param node il nodo locale: tutte le operazioni passano dai suoi metodi pubblici
 *             EN: the local node: every operation goes through its public methods
 */
/**
 * Nome del team fra virgolette, per le risposte di `remember`: l'utente vede subito DOVE è finito
 * il ricordo e si accorge se è il team sbagliato (bug reale del 2026-10-21).
 *
 * EN: Team name in quotes, for `remember` replies: the user immediately sees WHERE the memory
 * ended up and notices if it's the wrong team (real bug of 2026-10-21).
 */
function teamLabel (node: MicelioNode): string {
  return node.teamName ? ` «${node.teamName}»` : ''
}

/**
 * @param locked se presente, la sessione arriva da una cartella che non è in nessun team: tutti gli
 *        strumenti tranne `remember` rispondono con questo testo invece di leggere o toccare la
 *        memoria (revisione di sicurezza 2026-10-26, vedi lockedReadsMessage in team-check.ts)
 *        EN: if present, the session comes from a folder that is in no team: every tool except
 *        `remember` replies with this text instead of reading or touching the memory (security
 *        review 2026-10-26, see lockedReadsMessage in team-check.ts)
 */
export function createMcpServer (node: MicelioNode, agentRemember: AgentRemember, locked?: string): McpServer {
  const server = new McpServer({ name: 'micelio', version: VERSION }, { instructions: INSTRUCTIONS })
  // Registrazione degli strumenti che leggono o toccano la memoria: bloccati con `locked`.
  // Gli strumenti restano elencati, così l'agente può spiegare all'utente perché non rispondono.
  // EN: Registration of the tools that read or touch the memory: blocked with `locked`.
  //     The tools stay listed, so the agent can explain to the user why they don't answer.
  const register: typeof server.registerTool = locked === undefined
    ? server.registerTool.bind(server)
    : ((name: string, config: any) => server.registerTool(name, config, (async () => text(locked)) as any)) as typeof server.registerTool

  // ── recall ──────────────────────────────────────────────────────────────────────────
  register('recall', {
    title: 'Cerca nella memoria del team',
    description: 'Cerca nella memoria condivisa del team soluzioni, decisioni, gotcha e procedure. Usa parole chiave specifiche (tecnologie, errori, nomi di componenti).',
    inputSchema: {
      query: z.string().min(2).describe('Parole chiave da cercare'),
      limit: z.number().int().min(1).max(20).optional().describe('Numero massimo di risultati (default 5)')
    },
    annotations: { readOnlyHint: true }
  }, async ({ query, limit }) => {
    const t0 = Date.now()
    const hits = await node.recallHybrid(query, limit ?? 5)
    // Radici pertinenti non già fra i risultati: il sapere fondante arriva anche se la ricerca
    // non lo mette in cima (è il motivo per cui le Radici esistono).
    // EN: Relevant Roots not already among the results: foundational knowledge comes through even
    //     if the search doesn't rank it at the top (that's why Roots exist).
    const roots = await node.relatedRoots(query, hits.map((h) => h.id))
    // B11: ogni richiesta di un agente finisce nel registro dell'efficacia (anche senza risultati)
    // EN: B11: every agent request goes into the effectiveness log (even with no results)
    node.consulted('recall', query, [...hits, ...roots].map((h) => h.id), Date.now() - t0)
    if (hits.length === 0 && roots.length === 0) return text(`Nessun ricordo del team trovato per "${query}".`)
    const main = hits.length ? hits.map((h) => formatHit(h)).join('\n\n---\n\n') : `Nessun ricordo specifico trovato per "${query}".`
    const extra = roots.length ? `\n\n=== RADICI PERTINENTI (sapere fondante del team: tienine conto) ===\n\n${roots.map((h) => formatHit(h)).join('\n\n---\n\n')}` : ''
    return text(main + extra)
  })

  // ── architecture ────────────────────────────────────────────────────────────────────
  // Le Radici di un progetto: da leggere prima di toccare l'architettura (Fase 8).
  // EN: A project's Roots: to be read before touching the architecture (Phase 8).
  register('architecture', {
    title: 'Radici del team (architettura e regole fondanti)',
    description: 'Restituisce le RADICI: il sapere fondante del team (paradigmi architetturali, mappe di rete, interfacce e contratti, ' +
      'modello di dominio, best practice, policy di sicurezza). Chiamalo PRIMA di progettare o modificare una parte dell\'architettura ' +
      'o per capire come funziona un sistema. Filtra per progetto (nome della cartella del repository), per categoria, per i file ' +
      'che stai toccando, o ordina per pertinenza con query.',
    inputSchema: {
      project: z.string().max(200).optional().describe('Progetto: nome della cartella radice del repository'),
      category: z.enum(ROOT_CATEGORIES).optional().describe('architecture | network | interface | domain | practice | policy | other'),
      files: z.array(z.string().max(300)).max(50).optional().describe('File su cui stai lavorando (relativi alla radice del repository)'),
      query: z.string().max(500).optional().describe('Argomento, per ordinare le Radici per pertinenza')
    },
    annotations: { readOnlyHint: true }
  }, async ({ project, category, files, query }) => {
    const t0 = Date.now()
    let roots = await node.roots({ project, category, files, query })
    // Un progetto senza Radici proprie: valgono comunque quelle generali del team (best practice,
    // policy…), cioè quelle che non appartengono a nessun progetto.
    // EN: A project without its own Roots: the team's general ones still apply (best practices,
    //     policies…), i.e. those that belong to no project.
    let note = ''
    if (project && roots.length === 0) {
      roots = (await node.roots({ category, query })).filter((r) => !r.memory.source?.code?.project)
      note = `Nessuna Radice specifica per il progetto "${project}": ecco quelle generali del team.\n\n`
    }
    // B11: registro dell'efficacia (la "domanda" è il filtro usato)
    // EN: B11: effectiveness log (the "question" is the filter used)
    node.consulted('architecture', [project, category, query, ...(files ?? [])].filter(Boolean).join(' · ') || null, roots.map((r) => r.memory.id), Date.now() - t0, { project: project ?? null })
    if (roots.length === 0) return text('Il team non ha ancora Radici' + (category ? ` di categoria ${category}` : '') + '.')
    // Raggruppate per categoria; limite di lunghezza per non saturare il contesto dell'agente
    // EN: Grouped by category; length limit so the agent's context isn't flooded
    const out: string[] = []
    let size = 0
    for (const r of roots) {
      const block = `## ${ROOT_LABEL[r.category] ?? r.category}\n${formatRoot(r)}`
      if (size + block.length > ARCHITECTURE_MAX_CHARS && out.length) { out.push(`(altre ${roots.length - out.length} Radici: restringi con project, category, files o query)`); break }
      out.push(block)
      size += block.length
    }
    return text(note + out.join('\n\n---\n\n'))
  })

  // ── mark_root ───────────────────────────────────────────────────────────────────────
  // Qualunque membro può promuovere una Radice (decisione dell'utente); l'agente lo fa solo su
  // richiesta esplicita, perché una Radice vale per tutto il team e non viene mai dimenticata.
  // EN: Any member can promote a Root (user decision); the agent does it only on explicit
  //     request, because a Root applies to the whole team and is never forgotten.
  register('mark_root', {
    title: 'Rendi un ricordo una Radice',
    description: 'Promuove un ricordo del team a RADICE (sapere fondante che non viene mai dimenticato: architettura, rete, interfacce, ' +
      'dominio, best practice, policy). Usalo SOLO quando l\'utente lo chiede esplicitamente.',
    inputSchema: {
      id: z.string().min(6).describe('Id del ricordo (come mostrato da recall)'),
      category: z.enum(ROOT_CATEGORIES).describe('architecture | network | interface | domain | practice | policy | other')
    }
  }, async ({ id, category }) => {
    try {
      const r = await node.rootSet(id, category)
      return text(`«${r.memory.title}» ora è una Radice (${ROOT_LABEL[r.category]}): non verrà dimenticata ed emergerà nelle ricerche pertinenti.`)
    } catch (err) {
      return error((err as Error).message)
    }
  })

  // ── remember ────────────────────────────────────────────────────────────────────────
  // Passa da filtro e classificazione (D6). La risposta riporta SEMPRE il testo salvato,
  // così l'utente vede cosa è stato scritto a suo nome (problema emerso in Fase 1).
  // EN: Goes through filter and classification (D6). The response ALWAYS includes the saved text,
  //     so the user sees what was written on their behalf (issue found in Phase 1).
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
      tags: z.array(z.string()).max(20).optional().describe('Tecnologie, progetti, domini (es. angular, ci)'),
      personal: z.boolean().optional().describe('true = ricordo PERSONALE dell\'utente: resta solo sul suo PC, il team non lo vede. Solo se l\'utente lo chiede')
    }
  }, async ({ title, body, kind, tags, personal }) => {
    try {
      if (personal) {
        const p = await node.rememberPersonal({ title, body, kind, tags, source: { type: 'mcp' } })
        return text(`${p.duplicate ? 'Già presente' : 'Salvato'} come ricordo PERSONALE (id:${p.id.slice(0, 12)}): resta solo su questo PC.\n\n### ${title}\n${body}`)
      }
      const { outcome: r, team } = await agentRemember({ title, body, kind, tags, source: { type: 'mcp' } })
      switch (r.outcome) {
        case 'team': {
          // B4: il nuovo ricordo ha aggiornato uno esistente: si mostra la versione salvata davvero
          // EN: B4: the new memory updated an existing one: show the version actually saved
          if (r.updated) {
            const saved = node.detail(r.id)
            return text(`Aggiornato un ricordo esistente del team${teamLabel(node)} (id:${r.updated.slice(0, 12)} → id:${r.id.slice(0, 12)}): invece di un doppione c'è ora una versione unica. Testo salvato:\n\n### ${saved?.title ?? r.memory.title}\n${saved?.body ?? r.memory.body}`)
          }
          return text(`${r.duplicate ? 'Già presente' : 'Pubblicato'} nella memoria del team${teamLabel(node)} (id:${r.id.slice(0, 12)}). Testo salvato:\n\n### ${r.memory.title}\n${r.memory.body}`)
        }
        case 'inbox':
          // 0.6.1: la cartella della sessione non è del team su cui si salvava. Si dice all'utente
          // cosa non torna e come rimediare, e si mostra il testo.
          // EN: 0.6.1: the session's folder doesn't belong to the team being saved to. The user is
          //     told what doesn't match and how to fix it, and the text is shown.
          if (r.teamCheck) {
            return text(`NON pubblicato: è nell'Inbox del team «${team.name}» (id inbox: ${r.inboxId}), perché ${r.reason}.
` +
              `Soluzione: ${teamCheckSolution(r.teamCheck)}
` +
              `Dillo all'utente con queste parole. Testo trattenuto:

### ${r.memory.title}
${r.memory.body}`)
          }
          return text(`NON pubblicato subito: è nell'inbox dell'utente in attesa di verifica (id inbox: ${r.inboxId}).\nMotivo: ${r.reason}\nL'utente può approvarlo con "micelio inbox approve ${r.inboxId}" o chiedendoti di usare inbox_decide.`)
        case 'private':
          return text(`NON pubblicato: trattenuto come privato. Motivo: ${r.reason}`)
      }
    } catch (err) {
      return error(`Impossibile salvare: ${(err as Error).message}`)
    }
  })

  // ── vote ────────────────────────────────────────────────────────────────────────────
  // Segnale di utilità (Fase 5): i ricordi votati utili salgono nelle ricerche di tutti.
  // EN: Usefulness signal (Phase 5): memories voted useful rank higher in everyone's searches.
  register('vote', {
    title: 'Vota un ricordo',
    description: 'Segnala se un ricordo del team è stato utile (useful: true) o fuorviante/obsoleto (useful: false). ' +
      'Usalo quando l\'utente conferma che un ricordo lo ha aiutato o che è sbagliato: migliora le ricerche di tutto il team.',
    inputSchema: { id: z.string().min(6).describe('Id del ricordo'), useful: z.boolean() }
  }, async ({ id, useful }) => {
    try {
      await node.vote(id, useful ? 1 : -1)
      return text(useful ? 'Grazie: il ricordo è stato segnato come utile.' : 'Segnalato come poco utile o obsoleto.')
    } catch (err) {
      return error((err as Error).message)
    }
  })

  // ── get ─────────────────────────────────────────────────────────────────────────────
  register('get', {
    title: 'Leggi un ricordo',
    description: 'Restituisce un ricordo completo dato il suo id (anche abbreviato, come mostrato da recall).',
    inputSchema: { id: z.string().min(6).describe('Id del ricordo') },
    annotations: { readOnlyHint: true }
  }, async ({ id }) => {
    const t0 = Date.now()
    const hit = node.get(id)
    node.consulted('get', id, hit ? [hit.id] : [], Date.now() - t0)
    return hit ? text(formatHit(hit, true)) : error(`Nessun ricordo con id ${id}`)
  })

  // ── fetch_source ────────────────────────────────────────────────────────────────────
  // Documento originale su richiesta (§12-bis): il file arriva dal nodo del collega che lo
  // possiede (che deve essere online) e viene salvato in locale. Restituiamo il percorso (Claude
  // Code può aprirlo direttamente) e il testo estratto, per gli agenti che non leggono file.
  // EN: Original document on demand (§12-bis): the file comes from the node of the colleague who
  //     owns it (who must be online) and is saved locally. We return the path (Claude Code can
  //     open it directly) and the extracted text, for agents that don't read files.
  register('fetch_source', {
    title: 'Scarica il documento originale',
    description: 'Per un ricordo distillato da un documento, scarica il documento ORIGINALE completo dal collega che lo possiede ' +
      '(deve essere online e condividere quella cartella) e ne restituisce il percorso locale e il testo. Usalo quando il ricordo ' +
      'non basta e serve approfondire.',
    inputSchema: { id: z.string().min(6).describe('Id del ricordo (come mostrato da recall)') }
  }, async ({ id }) => {
    try {
      const t0 = Date.now()
      const f = await node.fetchSource(id)
      const rec = node.get(id)
      node.consulted('fetch_source', id, rec ? [rec.id] : [], Date.now() - t0)
      const textContent = await node.sourceText(f.path)
      return text(`Documento: ${f.name} (${Math.round(f.size / 1024)} KB)\nPercorso locale: ${f.path}\n\n` +
        (textContent ? `--- Testo (primi 20.000 caratteri) ---\n${textContent}` : '(testo non estraibile: apri il file dal percorso indicato)'))
    } catch (err) {
      return error((err as Error).message)
    }
  })

  // ── inbox_review ────────────────────────────────────────────────────────────────────
  // L'inbox contiene SOLO i casi dubbi (D9). È locale: nessun collega la vede.
  // EN: The Inbox holds ONLY the doubtful cases (D9). It is local: no colleague sees it.
  register('inbox_review', {
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
  // EN: To be used ONLY after an explicit user decision: approving means publishing to everyone.
  register('inbox_decide', {
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
