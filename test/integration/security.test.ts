// Sicurezza dei segreti (Fase 9) su un nodo vero: regole del team (solo admin, validate),
// banco di prova, scansione retroattiva dei ricordi, "ripulisci" (una Radice resta Radice),
// registro locale, e riassunto git che non riporta il diff dei file sensibili.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { summarizeChanges } from '../../src/ingest/git-changes'
import type { MicelioNode } from '../../src/node/micelio-node'
import { eventually, localDht, makeNode, published, tmpHome } from '../helpers'

describe('sicurezza dei segreti', () => {
  let dht: Awaited<ReturnType<typeof localDht>>
  let node: MicelioNode
  let leaky: string

  beforeAll(async () => {
    dht = await localDht()
    node = makeNode('sec', dht.bootstrap).node
    await node.start()
    await node.init('Team Sicurezza', 'admin')
    // Un ricordo pubblicato quando la regola del team non esisteva ancora: contiene un "codice cliente"
    leaky = published(await node.remember({ kind: 'howto', title: 'Ambiente di test del gestionale', body: 'Usare il tenant CLI-482913 per le prove di integrazione.' })).id
    await node.rootSet(leaky, 'practice')
  })

  afterAll(async () => {
    await node?.stop().catch(() => {})
    await dht?.destroy()
  })

  it('regole del team: pattern non validi rifiutati con un messaggio chiaro', async () => {
    await expect(node.setSecurityRules({ secretPatterns: [{ name: 'rotto', regex: '([' }] })).rejects.toThrow(/non valido/)
    await expect(node.setSecurityRules({ secretPatterns: [{ name: 'vuoto', regex: '.*' }] })).rejects.toThrow(/troppo generico/)
    const r = await node.setSecurityRules({ secretPatterns: [{ name: 'Codice cliente', regex: 'CLI-\\d{6}' }], allow: ['demo-key-pubblica'], sensitiveFiles: ['**/*.conf'] })
    expect(r.team).toEqual({ secretPatterns: [{ name: 'Codice cliente', regex: 'CLI-\\d{6}' }], allow: ['demo-key-pubblica'], sensitiveFiles: ['**/*.conf'] })
    expect(r.builtin.length).toBeGreaterThan(15)
  })

  it('banco di prova: testo e nome di file, con le regole del team', async () => {
    const t = await node.securityTest('tenant CLI-123456, API_KEY=demo-key-pubblica, token ghp_' + 'a'.repeat(36), 'deploy/prod.conf')
    expect(t.text).toContain('[REDACTED:team:codice-cliente]')
    expect(t.text).toContain('demo-key-pubblica')
    expect(t.redactions).toMatchObject({ 'secret:team:codice-cliente': 1, 'secret:github-token': 1 })
    expect(t.sensitiveFile).toBe('**/*.conf')
    expect((await node.securityTest('', 'src/app.ts')).sensitiveFile).toBeNull()
  })

  it('scansione e ripulitura: versione redatta pubblicata, originale rimosso, la Radice resta', async () => {
    const scan = await node.securityScan()
    expect(scan.map((f) => f.id)).toEqual([leaky])
    expect(scan[0]).toMatchObject({ root: true, kinds: { 'secret:team:codice-cliente': 1 } })

    const { id } = await node.securityClean(leaky)
    await eventually(() => node.get(leaky) === null && node.get(id) !== null, [node])
    expect(node.get(id)!.body).toContain('[REDACTED:team:codice-cliente]')
    expect((await node.roots()).map((r) => r.id)).toEqual([id])
    expect(await node.securityScan()).toEqual([])
    await expect(node.securityClean(id)).rejects.toThrow(/non contiene segreti/)
    // Il registro locale annota la pulizia (tipo), senza il valore
    const log = node.securityLog()
    expect(log[0]).toMatchObject({ source: { type: 'clean', ref: leaky } })
    expect(JSON.stringify(log)).not.toContain('482913')
  })

  it('riassunto git: dei file sensibili solo il nome, mai il diff', () => {
    const repo = tmpHome('git-sec')
    const git = (args: string[]) => spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: repo })
    git(['init', '-q'])
    fs.writeFileSync(path.join(repo, '.env'), 'export function leak () {}\nAPI_KEY=abc\n')
    fs.writeFileSync(path.join(repo, 'app.ts'), 'export function main () {}\n')
    git(['add', '-A'])
    git(['commit', '-q', '-m', 'configurazione'])
    const s = summarizeChanges(repo, Date.now() - 60_000, Date.now(), false)!.text!
    expect(s).toContain('.env (nuovo, file sensibile: contenuto escluso)')
    expect(s).not.toContain('leak')
    expect(s).toMatch(/app\.ts \(nuovo\): \+ main/)
  })
})
