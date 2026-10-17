// Daemon NestJS: autenticazione, API REST, MCP via client MCP reale, persistenza al riavvio.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { NestExpressApplication } from '@nestjs/platform-express'
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
    process.env.MICELIO_PORT = '0' // porta libera scelta dal sistema
    process.env.MICELIO_LLM_ADAPTER = 'fake' // niente chiamate reali a Claude nei test
    process.env.MICELIO_EMBEDDER = 'hash' // niente download del modello di embedding
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
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } }
    }))
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['fetch_source', 'get', 'inbox_decide', 'inbox_review', 'recall', 'remember', 'vote'])
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
  })

  it('ingestione di una sessione: solo nelle cartelle opt-in, poi ricercabile', async () => {
    const project = tmpHome('progetto')
    const transcriptPath = writeTranscript(project, 'sess-1', [
      { user: 'La build Angular va in out of memory sugli agent di Azure DevOps. '.repeat(8) },
      { assistant: 'LEZIONE: Heap Node basso sugli agent Azure | Impostare NODE_OPTIONS=--max-old-space-size=6144.' }
    ])
    const body = { session_id: 'sess-1', transcript_path: transcriptPath, cwd: project }

    // Cartella non abilitata: la sessione viene ignorata (D7)
    const ignored = await api('POST', '/api/ingest/session', body)
    expect(ignored.data).toMatchObject({ queued: false })

    expect((await api('POST', '/api/watch', { path: project })).data).toContain(canonicalPath(project)) // salvata in forma canonica (nome lungo)
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
    expect((await api('POST', `/api/archive/${r.data.id}/restore`)).status).toBe(400)
  })

  it('dopo un riavvio il nodo ritrova team e ricordi', async () => {
    await app.close()
    await start()
    const s = await api('GET', '/api/status')
    expect(s.data.team.name).toBe('Team Test')
    expect(s.data.memories).toBe(4) // 1 API + 1 MCP + 1 sessione + 1 inbox approvato
    expect((await api('GET', '/api/memories/search?q=drizzle')).data).toHaveLength(1)
  })
})
