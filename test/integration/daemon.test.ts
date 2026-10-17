// Daemon NestJS: autenticazione, API REST, MCP via client MCP reale, persistenza al riavvio.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nodePaths } from '../../src/core/paths'
import { loadConfig } from '../../src/node/config'
import { startDaemon } from '../../src/daemon/main'
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
    expect(tools.map((t) => t.name).sort()).toEqual(['get', 'recall', 'remember'])
    expect(client.getInstructions()).toMatch(/memoria condivisa/)

    const saved = await client.callTool({ name: 'remember', arguments: { title: 'Drizzle come ORM standard', body: 'Niente motore binario.', kind: 'decision', tags: ['orm'] } })
    expect((saved.content as any)[0].text).toMatch(/Salvato/)
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

  it('dopo un riavvio il nodo ritrova team e ricordi', async () => {
    await app.close()
    await start()
    const s = await api('GET', '/api/status')
    expect(s.data.team.name).toBe('Team Test')
    expect(s.data.memories).toBe(2)
    expect((await api('GET', '/api/memories/search?q=drizzle')).data).toHaveLength(1)
  })
})
