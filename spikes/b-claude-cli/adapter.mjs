// Spike B — Adapter LLM via Claude Code CLI headless (nessuna API key: usa l'abbonamento dell'utente).
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'

// Cartella vuota e isolata: l'agente non deve vedere né toccare nessun progetto.
const SANDBOX = mkdtempSync(path.join(tmpdir(), 'micelio-llm-'))

/**
 * Esegue un task strutturato con `claude -p`.
 * @template T
 * @param {{ system: string, input: string, schema: z.ZodType<T>, model?: string, timeoutMs?: number }} task
 * @returns {Promise<{ data: T, ms: number, model: string }>}
 */
export async function runClaude ({ system, input, schema, model = 'haiku', timeoutMs = 120_000 }) {
  const args = [
    '-p',
    '--output-format', 'json',
    // Il validatore del CLI non conosce il meta-schema draft 2020-12 (default di zod 4): usiamo draft-07.
    '--json-schema', JSON.stringify(z.toJSONSchema(schema, { target: 'draft-7' })),
    '--model', model,
    '--system-prompt', system,
    '--tools', '',               // nessuno strumento: deve solo rispondere
    '--strict-mcp-config',       // nessun server MCP (incluso Micelio stesso)
    '--setting-sources', '',     // niente hook/impostazioni utente
    '--no-session-persistence'   // non sporca la cronologia delle sessioni
  ]
  const t0 = Date.now()
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: SANDBOX,
      env: { ...process.env, MICELIO_INTERNAL: '1' }, // anti-loop: gli hook di Micelio ignorano queste sessioni
      // Niente shell: con shell:true su Windows gli argomenti (es. lo schema JSON) vengono
      // concatenati senza escape e si rompono. L'installer nativo fornisce claude.exe.
      // Se in futuro si trova solo uno shim .cmd (installazione npm), va risolto lo script node sottostante.
      windowsHide: true
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')) }, timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('close', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve(out) : reject(new Error(`claude exit ${code}: ${err || out}`))
    })
    child.stdin.end(input)
  })
  const res = JSON.parse(stdout)
  if (res.is_error) throw new Error(`claude error: ${res.result}`)
  // Doppia validazione: lo schema JSON lato CLI e zod lato nostro.
  const data = schema.parse(res.structured_output)
  return { data, ms: Date.now() - t0, model: Object.keys(res.modelUsage || {}).join('+') }
}
