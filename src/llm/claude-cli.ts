// Adapter per Claude Code CLI in modalità headless (verificato nello spike B, DESIGN §7).
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { type LlmAdapter, type LlmTask, LlmUnavailableError } from './types'

export class ClaudeCliAdapter implements LlmAdapter {
  readonly name = 'claude'
  // Cartella vuota e isolata: l'agente non deve vedere né toccare nessun progetto.
  private readonly sandbox = mkdtempSync(path.join(tmpdir(), 'micelio-llm-'))
  private availability: Promise<boolean> | null = null

  constructor (private readonly command = 'claude') {}

  available (): Promise<boolean> {
    this.availability ??= new Promise((resolve) => {
      const child = spawn(this.command, ['--version'], { windowsHide: true, stdio: 'ignore' })
      child.on('error', () => resolve(false))
      child.on('close', (code) => resolve(code === 0))
    })
    return this.availability
  }

  async run<T> (task: LlmTask<T>): Promise<T> {
    if (!(await this.available())) throw new LlmUnavailableError(`CLI "${this.command}" non disponibile`)
    const args = [
      '-p',
      '--output-format', 'json',
      // Il validatore del CLI non conosce il draft 2020-12 (default di zod 4): draft-07.
      '--json-schema', JSON.stringify(z.toJSONSchema(task.schema, { target: 'draft-7' })),
      '--model', task.model,
      '--system-prompt', task.system,
      '--tools', '', // nessuno strumento: deve solo rispondere
      '--strict-mcp-config', // nessun server MCP, incluso Micelio stesso
      '--setting-sources', '', // niente hook/impostazioni utente (anti-loop)
      '--no-session-persistence' // nessuna trascrizione: non verrà a sua volta distillata
    ]
    const stdout = await new Promise<string>((resolve, reject) => {
      // Niente shell: su Windows shell:true concatena gli argomenti senza escape (spike B).
      const child = spawn(this.command, args, {
        cwd: this.sandbox,
        env: { ...process.env, MICELIO_INTERNAL: '1' },
        windowsHide: true
      })
      let out = ''
      let err = ''
      const timer = setTimeout(() => { child.kill(); reject(new Error(`timeout dopo ${task.timeoutMs} ms`)) }, task.timeoutMs ?? 180_000)
      child.stdout.on('data', (d) => { out += d })
      child.stderr.on('data', (d) => { err += d })
      child.on('error', (e) => { clearTimeout(timer); reject(new LlmUnavailableError(e.message)) })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve(out)
        else reject(new Error(`claude exit ${code}: ${(err || out).slice(0, 500)}`))
      })
      child.stdin.end(task.input)
    })
    const res = JSON.parse(stdout)
    if (res.is_error) throw new Error(`claude: ${String(res.result).slice(0, 500)}`)
    return task.schema.parse(res.structured_output)
  }
}
