// Daemon NestJS: autenticazione, API REST, MCP via client MCP reale, persistenza al riavvio.
// EN: NestJS daemon: authentication, REST API, MCP via a real MCP client, persistence across restarts.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { NestExpressApplication } from '@nestjs/platform-express'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nodePaths } from '../../src/core/paths'
import { canonicalPath, loadConfig } from '../../src/node/config'
import { startDaemon } from '../../src/daemon/main'
import { writeTranscript } from '../fixtures/transcript'
import { localDht, tmpHome } from '../helpers'

describe('daemon', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  let app: NestExpressApplication
  const home = tmpHome('daemon')
  const paths = nodePaths(home)
  let base: string
  let token: string

  const api = async (method: string, path: string, body?: unknown, auth = true) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(auth ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    })
    return { status: res.status, data: await res.json().catch(() => null) as any }
  }

  const start = async () => {
    process.env.MICELIO_PORT = '0' // porta libera scelta dal sistema / EN: free port chosen by the OS
    process.env.MICELIO_LLM_ADAPTER = 'fake' // niente chiamate reali a Claude nei test / EN: no real Claude calls in tests
    process.env.MICELIO_EMBEDDER = 'hash' // niente download del modello di embedding / EN: no download of the embedding model
    process.env.MICELIO_DHT_BOOTSTRAP = dht.bootstrap.map((b) => `${b.host}:${b.port}`).join(',')
    app = await startDaemon(paths)
    const addr = app.getHttpServer().address() as import('node:net').AddressInfo
    base = `http://127.0.0.1:${addr.port}`
    token = loadConfig(paths).token
  }

  beforeAll(async () => {
    dht = await localDht()
    await start()
  })

  afterAll(async () => {
    await app?.close()
    await dht?.destroy()
    delete process.env.MICELIO_PORT
    delete process.env.MICELIO_DHT_BOOTSTRAP
    delete process.env.MICELIO_LLM_ADAPTER
    delete process.env.MICELIO_EMBEDDER
  })

  it('health è pubblico, il resto richiede il token', async () => {
    expect((await api('GET', '/api/health', undefined, false)).status).toBe(200)
    expect((await api('GET', '/api/status', undefined, false)).status).toBe(401)
    expect((await fetch(`${base}/api/status`, { headers: { authorization: 'Bearer sbagliato' } })).status).toBe(401)
    expect((await api('POST', '/mcp', {}, false)).status).toBe(401)
  })

  it('errori utente → 400 leggibili', async () => {
    const r = await api('POST', '/api/memories', { title: 'x', body: 'y' })
    expect(r.status).toBe(400)
    expect(r.data.error).toMatch(/non configurato/)
    expect((await api('POST', '/api/team/init', { team: '' })).status).toBe(400)
    // La UI chiede la lingua con x-micelio-lang: lo stesso errore in inglese
    // EN: The UI asks for the language with x-micelio-lang: the same error in English
    const en = await fetch(`${base}/api/memories`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-micelio-lang': 'en' },
      body: JSON.stringify({ title: 'x', body: 'y' })
    })
    expect(en.status).toBe(400)
    expect(((await en.json()) as { error: string }).error).toMatch(/Node not configured/)
  })

  it('init, remember e recall via API', async () => {
    const s = await api('POST', '/api/team/init', { team: 'Team Test', name: 'nodo-test' })
    expect(s.status).toBe(201)
    expect(s.data.role).toBe('admin')
    const r = await api('POST', '/api/memories', { title: 'Retry SFTP con keepalive', body: 'Usare keepaliveInterval e backoff esponenziale.', kind: 'howto', tags: ['sftp'] })
    expect(r.status).toBe(201)
    const hits = await api('GET', '/api/memories/search?q=sftp')
    expect(hits.data[0].title).toBe('Retry SFTP con keepalive')
  })

  it('MCP: un client reale vede i tool e li usa', async () => {
    // Come lo shim: manda la cartella della sessione, abilitata nel team (controllo del team, 0.6.1)
    // EN: Like the shim: sends the session's folder, enabled in the team (team check, 0.6.1)
    const mcpProject = tmpHome('progetto-mcp')
    await api('POST', '/api/watch', { path: mcpProject })
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}`, 'x-micelio-cwd': encodeURIComponent(mcpProject) } }
    }))
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['architecture', 'fetch_source', 'get', 'inbox_decide', 'inbox_review', 'mark_root', 'recall', 'remember', 'vote'])
    expect(client.getInstructions()).toMatch(/memoria condivisa/)

    const saved = await client.callTool({ name: 'remember', arguments: { title: 'Drizzle come ORM standard', body: 'Niente motore binario.', kind: 'decision', tags: ['orm'] } })
    expect((saved.content as any)[0].text).toMatch(/Pubblicato/)
    const again = await client.callTool({ name: 'remember', arguments: { title: 'Drizzle come ORM standard', body: 'Niente motore binario.', kind: 'decision' } })
    expect((again.content as any)[0].text).toMatch(/Già presente/)

    const found = await client.callTool({ name: 'recall', arguments: { query: 'quale orm usare' } })
    expect((found.content as any)[0].text).toMatch(/Drizzle come ORM standard/)
    const none = await client.callTool({ name: 'recall', arguments: { query: 'kubernetes' } })
    expect((none.content as any)[0].text).toMatch(/Nessun ricordo/)
    const bad = await client.callTool({ name: 'remember', arguments: { title: 'x', body: '' } })
    expect(bad.isError).toBe(true)
    await client.close()
    await api('DELETE', '/api/watch', { path: mcpProject })
  })

  it('ingestione di una sessione: solo nelle cartelle opt-in, poi ricercabile', async () => {
    const project = tmpHome('progetto')
    const transcriptPath = writeTranscript(project, 'sess-1', [
      { user: 'La build Angular va in out of memory sugli agent di Azure DevOps. '.repeat(8) },
      { assistant: 'LEZIONE: Heap Node basso sugli agent Azure | Impostare NODE_OPTIONS=--max-old-space-size=6144.' }
    ])
    const body = { session_id: 'sess-1', transcript_path: transcriptPath, cwd: project }

    // Cartella non abilitata: la sessione viene ignorata (D7)
    // EN: Folder not enabled: the session is ignored (D7)
    const ignored = await api('POST', '/api/ingest/session', body)
    expect(ignored.data).toMatchObject({ queued: false })

    expect((await api('POST', '/api/watch', { path: project })).data).toContain(canonicalPath(project)) // salvata in forma canonica (nome lungo) / EN: saved in canonical form (long name)
    expect((await api('POST', '/api/ingest/session', body)).data).toMatchObject({ queued: true })
    expect((await api('POST', '/api/ingest/run')).data).toEqual({ processed: true })

    const hits = await api('GET', '/api/memories/search?q=heap%20node%20azure')
    expect(hits.data[0].title).toBe('Heap Node basso sugli agent Azure')
    const status = await api('GET', '/api/ingest/status')
    expect(status.data).toMatchObject({ llm: { adapter: 'fake' }, jobs: { done: 1 }, inbox: 0 })
    await api('DELETE', '/api/watch', { path: project })
  })

  it('inbox via API: un caso dubbio si approva con correzioni', async () => {
    const r = await api('POST', '/api/memories', { title: 'Proxy aziendale [incerto]', body: 'Serve HTTPS_PROXY nella pipeline.' })
    expect(r.data.outcome).toBe('inbox')
    const ok = await api('POST', `/api/inbox/${r.data.inboxId}/approve`, { title: 'Proxy aziendale in pipeline' })
    expect(ok.data.memory.title).toBe('Proxy aziendale in pipeline')
    expect((await api('GET', '/api/inbox')).data).toEqual([])
    expect((await api('POST', '/api/inbox/inesistente/reject')).status).toBe(400)
  })

  it('SSE: un cambiamento arriva come evento "change" con il suo argomento', async () => {
    const ctrl = new AbortController()
    const res = await fetch(`${base}/api/events`, { headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal })
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let received = ''
    // Legge lo stream finché non vede un evento "inbox" (o scade il tempo).
    // EN: Reads the stream until it sees an "inbox" event (or time runs out).
    const waitFor = async (pattern: RegExp) => {
      const t0 = Date.now()
      while (!pattern.test(received) && Date.now() - t0 < 10_000) {
        const { value } = await reader.read()
        received += decoder.decode(value)
      }
    }
    await waitFor(/event: hello/)
    await api('POST', '/api/memories', { title: 'Evento SSE [incerto]', body: 'Questo finisce in inbox e genera un evento.' })
    await waitFor(/"topic":"inbox"/)
    ctrl.abort()
    expect(received).toMatch(/event: change\ndata: \{"topic":"inbox"\}/)
    // Pulizia: rifiuta l'elemento creato, per non alterare i conteggi dei test successivi
    // EN: Cleanup: reject the created item, so the counts of later tests aren't affected
    const inbox = await api('GET', '/api/inbox')
    for (const i of inbox.data) await api('POST', `/api/inbox/${i.id}/reject`)
  })

  it('link monouso per il browser: valido una sola volta', async () => {
    const { data } = await api('POST', '/api/ui/link')
    const code = new URL(data.url).searchParams.get('code')
    const first = await api('POST', '/api/ui/exchange', { code }, false)
    expect(first.data.token).toBe(token)
    const second = await api('POST', '/api/ui/exchange', { code }, false)
    expect(second.status).toBe(401)
  })

  it('impostazioni LLM modificabili a caldo, con validazione', async () => {
    const r = await api('PUT', '/api/settings/llm', { dailyBudget: 42, distillModel: 'opus' })
    expect(r.data.llm).toMatchObject({ dailyBudget: 42, distillModel: 'opus' })
    expect((await api('GET', '/api/ingest/status')).data.llm.budget.limit).toBe(42)
    expect((await api('PUT', '/api/settings/llm', { dailyBudget: -1 })).status).toBe(400)
    await api('PUT', '/api/settings/llm', { dailyBudget: 300, distillModel: 'sonnet' })
  })

  it('Fase 7: metriche e redazione (admin)', async () => {
    const m = await api('GET', '/api/metrics')
    expect(m.data).toMatchObject({ members: 1 })
    expect(typeof m.data.uptimeSeconds).toBe('number')
    const r = await api('POST', '/api/memories', { title: 'Ricordo da redigere per errore', body: 'Contenuto pubblicato per sbaglio nel team.' })
    expect(r.data.outcome).toBe('team')
    expect((await api('POST', `/api/memories/${r.data.id}/redact`, { reason: 'errore' })).status).toBe(200)
    expect((await api('GET', '/api/memories/search?q=redigere')).data).toEqual([])
    // Ripristino non permesso per un ricordo redatto
    // EN: Restore not allowed for a redacted memory
    expect((await api('POST', `/api/archive/${r.data.id}/restore`)).status).toBe(400)
  })

  it('Radici via API: promozione, elenco, revisione, conferma, rimozione (rotte senza conflitti)', async () => {
    const id = (await api('GET', '/api/memories/search?q=sftp')).data[0].id
    expect((await api('POST', `/api/roots/${id}`, { category: 'practice' })).data.category).toBe('practice')
    expect((await api('POST', `/api/roots/${id}`, { category: 'inventata' })).status).toBe(400)
    expect((await api('GET', '/api/roots?category=practice')).data.map((r: any) => r.id)).toEqual([id])
    // "review" e "suggestions" non devono essere scambiati per l'id di un ricordo
    // EN: "review" and "suggestions" must not be mistaken for a memory id
    const review = await api('POST', '/api/roots/review', {})
    expect(review.status).toBe(200)
    expect(review.data).toMatchObject({ checked: 1, flagged: [] })
    expect((await api('GET', '/api/roots/suggestions')).data).toEqual([])
    expect((await api('POST', `/api/roots/${id}/confirm`)).data.status).toBe('ok')
    expect((await api('DELETE', `/api/roots/${id}`)).status).toBe(200)
    expect((await api('GET', '/api/roots')).data).toEqual([])
  })

  it('limite di ricordi distillati: impostazione di team validata e metriche di qualità', async () => {
    expect((await api('POST', '/api/team/config', { key: 'distill.maxMemories', value: 30 })).status).toBe(400)
    expect((await api('POST', '/api/team/config', { key: 'distill.maxMemories', value: 8 })).status).toBeLessThan(300)
    expect((await api('GET', '/api/team/config')).data.maxMemories).toBe(8)
    const q = await api('GET', '/api/distill/quality')
    expect(q.data).toMatchObject({ maxMemories: 8, advice: { action: 'unknown' } })
    expect(q.data.buckets.map((b: any) => b.label)).toEqual(['1ª', '2ª', '3ª', '4ª–5ª', '6ª–10ª'])
  })

  it('dopo un riavvio il nodo ritrova team e ricordi', async () => {
    await app.close()
    await start()
    const s = await api('GET', '/api/status')
    expect(s.data.team.name).toBe('Team Test')
    expect(s.data.memories).toBe(4) // 1 API + 1 MCP + 1 sessione + 1 inbox approvato / EN: 1 API + 1 MCP + 1 session + 1 approved inbox item
    expect((await api('GET', '/api/memories/search?q=drizzle')).data).toHaveLength(1)
  })

  it('più team (B3): un secondo team, intestazione x-micelio-team, MCP per team', async () => {
    // il secondo team si aggiunge al primo; il nome viene dall'identità personale
    // EN: the second team is added to the first; the name comes from the personal identity
    const created = await api('POST', '/api/team/init', { team: 'Secondo' })
    expect(created.status).toBe(201)
    expect(created.data).toMatchObject({ nodeName: 'nodo-test', role: 'admin' })
    const second = created.data.teamId as string
    const list = await api('GET', '/api/teams')
    expect(list.data.teams.map((t: any) => [t.name, t.isDefault])).toEqual([['Team Test', true], ['Secondo', false]])
    expect(list.data.identity).toMatchObject({ name: 'nodo-test' })
    expect(list.data.identity.secretKey).toBeUndefined() // la chiave segreta non esce mai / EN: the secret key never leaves

    // senza intestazione: il predefinito; con l'intestazione (id o nome): l'altro team
    // EN: without the header: the default; with the header (id or name): the other team
    const inTeam = (team: string) => ({ authorization: `Bearer ${token}`, 'x-micelio-team': team })
    expect((await api('GET', '/api/status')).data.team.name).toBe('Team Test')
    const st = await fetch(`${base}/api/status`, { headers: inTeam('secondo') })
    expect(((await st.json()) as any).team.name).toBe('Secondo')
    const hits = await fetch(`${base}/api/memories/search?q=drizzle`, { headers: inTeam(second) })
    expect(await hits.json()).toEqual([]) // il sapere del primo team non si vede dal secondo / EN: the first team's knowledge isn't visible from the second
    const unknown = await fetch(`${base}/api/status`, { headers: inTeam('gamma') })
    expect(unknown.status).toBe(400)

    // MCP del secondo team senza cartella (registrazione HTTP vecchia): cerca solo lì, e
    // `remember` non pubblica, perché non sa da quale cartella arriva (0.6.1)
    // EN: MCP of the second team without a folder (old HTTP registration): it searches only there,
    //     and `remember` doesn't publish, because it doesn't know which folder it comes from (0.6.1)
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${second}`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } }
    }))
    const noFolder = await client.callTool({ name: 'remember', arguments: { title: 'Solo nel secondo team', body: 'Le demo si fanno il venerdì.', kind: 'fact' } })
    expect((noFolder.content as any)[0].text).toMatch(/NON pubblicato: è nell'Inbox del team «Secondo»[\s\S]*Soluzione:[\s\S]*Configura/)
    expect(((await client.callTool({ name: 'recall', arguments: { query: 'drizzle orm' } })).content as any)[0].text).toMatch(/Nessun ricordo/)
    await client.close()
    const inbox2 = await (await fetch(`${base}/api/inbox`, { headers: inTeam(second) })).json() as any[]
    expect(inbox2.find((i) => i.memory.title === 'Solo nel secondo team')).toMatchObject({ teamCheck: { problem: 'no-folder', cwd: null, session: { id: second, name: 'Secondo' } } })
    expect((await api('GET', '/api/memories/search?q=venerdì demo')).data).toEqual([])
    expect((await api('POST', '/mcp/gamma', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(404)

    // `/mcp` con la cartella di lavoro (shim stdio): vale il team che la possiede, non il
    // predefinito. Bug reale del 2026-10-21: ricordi di un team finiti nel predefinito.
    // La cartella si abilita DOPO l'apertura della connessione: il team si sceglie a ogni chiamata.
    // EN: `/mcp` with the working folder (stdio shim): the team that owns it wins, not the
    //     default. Real bug of 2026-10-21: one team's memories ended up in the default team.
    //     The folder is enabled AFTER the connection is opened: the team is chosen on every call.
    const project = path.join(home, 'progetto-secondo')
    fs.mkdirSync(path.join(project, 'sub'), { recursive: true })
    const viaShim = (cwd: string) => {
      const c = new Client({ name: 'test-shim', version: '1.0.0' })
      return c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}`, 'x-micelio-cwd': encodeURIComponent(cwd) } }
      })).then(() => c)
    }
    // sottocartella, e su Windows con la lettera del disco minuscola come la passa VS Code
    // EN: a subfolder, and on Windows with the lowercase drive letter as VS Code passes it
    const sub = path.join(project, 'sub')
    const shim = await viaShim(process.platform === 'win32' ? sub[0].toLowerCase() + sub.slice(1) : sub)
    const watch = await fetch(`${base}/api/watch`, { method: 'POST', headers: { ...inTeam(second), 'content-type': 'application/json' }, body: JSON.stringify({ path: project }) })
    expect(watch.status).toBe(200)
    const saved = await shim.callTool({ name: 'remember', arguments: { title: 'Dalla cartella del secondo team', body: 'Il rilascio si fa con il tag vX.Y.Z.', kind: 'fact' } })
    expect((saved.content as any)[0].text).toMatch(/team «Secondo»/)
    await shim.close()
    expect((await api('GET', '/api/memories/search?q=rilascio tag')).data).toEqual([])
    const there = await fetch(`${base}/api/memories/search?q=rilascio tag`, { headers: inTeam(second) })
    expect(((await there.json()) as any[]).map((m) => m.title)).toEqual(['Dalla cartella del secondo team'])
    // una cartella che non appartiene a nessun team: `remember` non pubblica, va nell'Inbox del
    // predefinito con il problema (0.6.1); gli strumenti di lettura non rispondono (0.6.2: un
    // repository non fidato non deve far leggere all'agente la memoria di un team)
    // EN: a folder that belongs to no team: `remember` doesn't publish, it goes to the default
    //     team's Inbox with the problem (0.6.1); the read tools don't answer (0.6.2: an untrusted
    //     repository must not make the agent read a team's memory)
    const other = await viaShim(path.join(home, 'altrove'))
    expect(((await other.callTool({ name: 'remember', arguments: { title: 'Da una cartella qualsiasi', body: 'Le build notturne partono alle 2.', kind: 'fact' } })).content as any)[0].text).toMatch(/NON pubblicato: è nell'Inbox del team «Team Test».*perché la cartella .* non è abilitata in nessun team/)
    for (const [name, args] of [['recall', { query: 'drizzle orm' }], ['architecture', {}], ['inbox_review', {}]] as const) {
      const locked = ((await other.callTool({ name, arguments: args })).content as any)[0].text as string
      expect(locked).toMatch(/Micelio non legge la memoria da questa sessione: la cartella .*altrove non è abilitata in nessun team/)
      expect(locked).not.toMatch(/Drizzle/)
    }
    await other.close()
    // lo stesso senza cartella su `/mcp` (registrazione HTTP vecchia o client diverso dallo shim)
    // EN: the same without a folder on `/mcp` (old HTTP registration or a client other than the shim)
    const bare = new Client({ name: 'test-bare', version: '1.0.0' })
    await bare.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
    expect(((await bare.callTool({ name: 'recall', arguments: { query: 'drizzle orm' } })).content as any)[0].text).toMatch(/il client non ha indicato da quale cartella arriva/)
    await bare.close()
    // e niente contesto automatico per la sessione di quella cartella
    // EN: and no automatic context for that folder's session
    // (la stessa richiesta da una cartella del team predefinito riceve il ricordo: la domanda è pertinente)
    // EN: (the same request from a folder of the default team gets the memory: the question is relevant)
    const mine = path.join(home, 'progetto-predefinito')
    fs.mkdirSync(mine, { recursive: true })
    await api('POST', '/api/watch', { path: mine })
    const ask = (cwd: string) => api('POST', '/api/context', { event: 'prompt', cwd, session_id: `s-${path.basename(cwd)}`, prompt: 'Drizzle come ORM standard: quale orm usare?' })
    expect((await ask(mine)).data.context).toMatch(/Drizzle come ORM standard/)
    expect((await ask(path.join(home, 'altrove'))).data).toEqual({ context: '' })
    await api('DELETE', '/api/watch', { path: mine })
    const held = ((await api('GET', '/api/inbox')).data as any[]).find((i) => i.memory.title === 'Da una cartella qualsiasi')
    expect(held.teamCheck).toMatchObject({ problem: 'not-enabled', session: { name: 'Team Test' } })
    expect(((await api('GET', '/api/memories/search?q=build notturne')).data as any[]).some((m) => m.title === 'Da una cartella qualsiasi')).toBe(false)
    // «Pubblica in…»: dall'Inbox del predefinito al secondo team, pubblicato lì
    // EN: «Pubblica in…» (Publish to…): from the default team's Inbox to the second team, published there
    expect((await api('POST', `/api/inbox/${held.id}/move`, { team: 'Secondo' })).data).toMatchObject({ team: second, published: { duplicate: false } })
    expect(((await api('GET', '/api/inbox')).data as any[]).some((i) => i.id === held.id)).toBe(false)
    const moved = await fetch(`${base}/api/memories/search?q=build notturne`, { headers: inTeam(second) })
    expect(((await moved.json()) as any[]).map((m) => m.title)).toEqual(['Da una cartella qualsiasi'])
    expect(((await api('GET', '/api/decisions')).data as any[])[0]).toMatchObject({ outcome: 'moved' })

    // registrazione `/mcp/<team>` vecchia, ma dalla cartella di un ALTRO team: va nell'Inbox del
    // team della cartella, dove approvarlo lo pubblica (0.6.1)
    // EN: old `/mcp/<team>` registration, but from the folder of ANOTHER team: it goes to the Inbox
    //     of the folder's team, where approving publishes it (0.6.1)
    const pinned = new Client({ name: 'test-pinned', version: '1.0.0' })
    await pinned.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${encodeURIComponent('Team Test')}`), {
      requestInit: { headers: { authorization: `Bearer ${token}`, 'x-micelio-cwd': encodeURIComponent(sub) } }
    }))
    const wrong = await pinned.callTool({ name: 'remember', arguments: { title: 'Dalla cartella giusta ma team sbagliato', body: 'Le migrazioni si lanciano prima del deploy.', kind: 'howto' } })
    expect((wrong.content as any)[0].text).toMatch(/NON pubblicato: è nell'Inbox del team «Secondo».*abilitata nel team «Secondo», ma la sessione salvava nel team «Team Test»/)
    await pinned.close()
    const inSecond = (await (await fetch(`${base}/api/inbox`, { headers: inTeam(second) })).json() as any[]).find((i) => i.memory.title === 'Dalla cartella giusta ma team sbagliato')
    expect(inSecond.teamCheck).toMatchObject({ problem: 'other-team', folder: { id: second }, session: { name: 'Team Test' } })
    const approved = await fetch(`${base}/api/inbox/${inSecond.id}/approve`, { method: 'POST', headers: { ...inTeam(second), 'content-type': 'application/json' }, body: '{}' })
    expect(approved.status).toBe(200)
    expect(((await api('GET', '/api/memories/search?q=migrazioni deploy')).data as any[]).some((m) => m.title === 'Dalla cartella giusta ma team sbagliato')).toBe(false)

    // il predefinito si cambia, poi si toglie il secondo team da questo PC
    // EN: change the default, then remove the second team from this PC
    expect((await api('POST', `/api/teams/${second}/default`)).data.find((t: any) => t.isDefault).name).toBe('Secondo')
    expect((await api('DELETE', '/api/teams/Secondo')).data.map((t: any) => t.name)).toEqual(['Team Test'])
    expect((await api('GET', '/api/status')).data.team.name).toBe('Team Test')
  })
})
