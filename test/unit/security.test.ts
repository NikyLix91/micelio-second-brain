/**
 * Sicurezza dei segreti (Fase 9), parte deterministica:
 * - nuovi riconoscitori e stringhe ad alta entropia (hash esclusi);
 * - pattern ed eccezioni del team;
 * - file sensibili: nomi, comandi di shell, input degli strumenti;
 * - trascrizioni: il contenuto letto/scritto da file sensibili sparisce per intero;
 * - pipeline: documento sensibile mai aperto, registro di sicurezza senza valori.
 *
 * EN: Secret safety (Phase 9), deterministic part:
 * - new recognizers and high-entropy strings (hashes excluded);
 * - team patterns and exceptions;
 * - sensitive files: names, shell commands, tool inputs;
 * - transcripts: content read/written from sensitive files disappears entirely;
 * - pipeline: sensitive document never opened, security log without values.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashFile } from '../../src/ingest/documents'
import { IngestPipeline } from '../../src/ingest/pipeline'
import { extractTranscript } from '../../src/ingest/transcript'
import { FakeAdapter } from '../../src/llm/fake'
import { LlmRunner } from '../../src/llm/runner'
import { applyFilter, compileTeamPatterns, looksLikeSecret, mergeRules } from '../../src/privacy/filter'
import { mergeBlockedPaths } from '../../src/privacy/paths'
import { sensitiveInCommand, sensitiveInToolInput, sensitiveMatch } from '../../src/privacy/sensitive-files'
import { PrivateStore } from '../../src/store/private-store'
import { tmpHome } from '../helpers'

const rules = mergeRules([])

describe('riconoscimento dei segreti', () => {
  it('nuovi formati: Azure, Stripe, npm, SendGrid, Authorization/Bearer, private_key nei JSON', () => {
    const cases: [string, string][] = [
      ['DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=' + 'A1b2C3d4'.repeat(8) + '==;EndpointSuffix=core.windows.net', 'azure-account-key'],
      ['https://acct.blob.core.windows.net/c?sv=2022-11-02&sig=AbCdEf1234567890xyzXYZ%3D', 'azure-sas'],
      ['STRIPE=sk_live_' + 'a1B2c3D4e5F6g7H8', 'stripe-key'],
      ['//registry.npmjs.org/:_authToken=npm_' + 'a'.repeat(36), 'npm-token'],
      ['SG.abcdefghijklmnopqrst.ABCDEFGHIJKLMNOPQRSTuv', 'sendgrid-key'],
      ['curl -H "Authorization: Bearer abc.def.ghi-jkl_mno"', 'auth-header'],
      ['"private_key_id": "0123456789abcdef0123"', 'assignment']
    ]
    for (const [text, kind] of cases) {
      const r = applyFilter(text, rules)
      expect(Object.keys(r.redactions).map((k) => k.replace('secret:', '')), text).toContain(kind)
    }
  })

  it('alta entropia: i token casuali sì, hash esadecimali e identificatori no', () => {
    expect(looksLikeSecret('Zk3vQ9pL2mX8rT5wY7aB1cD4eF6gH0jN')).toBe(true)
    expect(looksLikeSecret('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')).toBe(false) // sha256 / EN: sha256
    expect(looksLikeSecret('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0')).toBe(false) // commit git / EN: git commit
    expect(looksLikeSecret('getMemoriesByAuthorAndProjectAndKind')).toBe(false) // identificatore / EN: identifier
    // opzioni composte da parole intere: non sono segreti (falso positivo visto in un ricordo reale)
    // EN: options made of whole words are not secrets (false positive seen in a real memory)
    expect(looksLikeSecret('NODE_OPTIONS=--max-old-space-size=6144')).toBe(false)
    expect(looksLikeSecret('spring.datasource-Hikari-maximum-pool-size=20'.replace('.', '-'))).toBe(false)
    // un token url-safe con trattini resta un segreto: i suoi pezzi mescolano maiuscole e cifre
    // EN: a url-safe token with dashes is still a secret: its pieces mix uppercase letters and digits
    expect(looksLikeSecret('Zk3vQ9pL-2mX8rT5w_Y7aB1cD4-eF6gH0jN')).toBe(true)
    const r = applyFilter('chiave generata: Zk3vQ9pL2mX8rT5wY7aB1cD4eF6gH0jN · commit a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', rules)
    expect(r.text).toContain('[REDACTED:high-entropy]')
    expect(r.text).toContain('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0')
  })

  it('idempotente: un testo già redatto non contiene più segreti (nessun falso positivo sui segnaposto)', () => {
    const sample = [
      'postgres://app:Segreta123@staging:5432/app', 'Server=db;Password=Segreta123;', 'API_KEY=abcdef123456',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789', 'sig=AbCdEf1234567890xyzXYZ%3D', 'Zk3vQ9pL2mX8rT5wY7aB1cD4eF6gH0jN'
    ].join('\n')
    const once = applyFilter(sample, rules)
    expect(Object.keys(once.redactions).length).toBeGreaterThan(4)
    const twice = applyFilter(once.text, rules)
    expect(twice.redactions).toEqual({})
    expect(twice.text).toBe(once.text)
  })

  it('pattern del team ed eccezioni (testo letterale o /regex/)', () => {
    const team = mergeRules([], [{ name: 'Codice cliente', regex: 'CLI-\\d{6}' }], ['demo-token-pubblico', '/^sk_test_/'])
    const r = applyFilter('cliente CLI-123456, API_KEY=demo-token-pubblico, STRIPE=sk_test_' + 'a1B2c3D4e5F6g7H8', team)
    expect(r.text).toContain('[REDACTED:team:codice-cliente]')
    expect(r.text).toContain('demo-token-pubblico') // eccezione letterale / EN: literal exception
    expect(r.text).toContain('sk_test_') // eccezione regex / EN: regex exception
    expect(compileTeamPatterns([{ name: 'rotto', regex: '([' }, { name: 'ok', regex: 'x+' }]).map((p) => p.label)).toEqual(['ok'])
  })
})

describe('file sensibili', () => {
  it('nomi e percorsi; i file di esempio non sono sensibili', () => {
    for (const f of ['.env', 'config/.env.production', 'C:\\app\\secrets.json', 'id_rsa', '~/.aws/credentials', 'deploy/prod.tfvars', 'certs/server.pem', '.npmrc']) {
      expect(sensitiveMatch(f), f).not.toBeNull()
    }
    for (const f of ['.env.example', '.env.sample', 'src/environment.ts', 'README.md', 'id_rsa.pub', 'id_rsa.pub.md']) expect(sensitiveMatch(f), f).toBeNull()
    expect(sensitiveMatch('config/azienda.conf', ['**/*.conf'])).toBe('**/*.conf')
  })

  it('comandi di shell e input degli strumenti', () => {
    expect(sensitiveInCommand('cat .env && npm start')).toEqual(['.env'])
    expect(sensitiveInCommand('type config\\secrets.json')).toEqual(['config/secrets.json'])
    expect(sensitiveInCommand('npm test -- --watch')).toEqual([])
    expect(sensitiveInToolInput({ file_path: 'C:/app/.env.local' })).toEqual(['C:/app/.env.local'])
    expect(sensitiveInToolInput({ command: 'source ./.env' })).toEqual(['.env'])
    expect(sensitiveInToolInput({ file_path: 'src/app.ts' })).toEqual([])
  })

  it('trascrizione: input ed esito di Read/Write/Bash su file sensibili spariscono per intero', () => {
    const dir = tmpHome('tr-sec')
    const file = path.join(dir, 's.jsonl')
    const lines = [
      { type: 'user', message: { content: 'Configura il database' } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:/app/.env' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'DB_PASSWORD=SuperSegreta!99\nSMTP_HOST=mail.local' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'cat config/secrets.yml' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'token: abc' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'Write', input: { file_path: '.env.local', content: 'API_SECRET=xyz' } }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't4', name: 'Read', input: { file_path: 'src/db.ts' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't4', content: 'export const db = connect()' }] } }
    ]
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'))
    const ex = extractTranscript(file)
    expect(ex.text).not.toMatch(/SuperSegreta|SMTP_HOST|token: abc|API_SECRET/)
    expect(ex.text).toContain('[contenuto omesso: file sensibile .env]')
    expect(ex.text).toContain('export const db = connect()') // file normale: invariato / EN: normal file: unchanged
    expect(ex.omitted.sort()).toEqual(['.env', '.env.local', 'secrets.yml'])

    // Esito in un capitolo successivo alla richiesta: sparisce comunque
    // EN: Result in a chapter after the request: it disappears anyway
    expect(extractTranscript(file, 2).text).not.toContain('SuperSegreta')
  })
})

describe('pipeline: documenti sensibili e registro', () => {
  const make = () => {
    const store = new PrivateStore(':memory:')
    const p = new IngestPipeline({
      store,
      llm: new LlmRunner(new FakeAdapter(), store, { dailyBudget: () => 100 }),
      models: () => ({ classify: 'haiku', distill: 'sonnet' }),
      publish: async () => ({ id: 'x', duplicate: false }),
      rules: async () => mergeRules([]),
      blockedPaths: async () => mergeBlockedPaths([]),
      sensitiveFiles: async () => ['**/*.conf.md'],
      language: async () => 'it',
      log: () => {}
    })
    return { p, store }
  }

  it('un documento sensibile (anche per regola del team) non viene aperto e finisce nel registro', async () => {
    const { p, store } = make()
    const folder = tmpHome('docs-sec')
    const file = path.join(folder, 'produzione.conf.md')
    fs.writeFileSync(file, 'password=segreta')
    p.enqueueDocument({ path: file, folder, hash: await hashFile(file), size: 16 })
    await p.tick()
    expect(store.getDocument(file)?.status).toBe('blocked')
    expect(store.listDecisions()[0].reason).toMatch(/file sensibile/)
    expect(store.securityLog()[0]).toMatchObject({ omitted: ['produzione.conf.md'] })
  })

  it('il registro conta i tipi tolti, mai i valori', async () => {
    const { p, store } = make()
    await p.ingestExplicit({ title: 'Accesso al DB di staging', body: 'Usare postgres://app:Segreta123@staging:5432/app per i test.' })
    const e = store.securityLog()[0]
    expect(e.kinds).toEqual({ 'secret:url-credentials': 1 })
    expect(JSON.stringify(e)).not.toContain('Segreta123')
  })
})
