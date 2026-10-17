/**
 * @file Raccolta delle sessioni di Claude Code IN CORSO e recupero di quelle perse.
 *
 * L'hook di fine sessione (SessionEnd) da solo non basta:
 * - le sessioni lunghe durano giorni: senza raccolta intermedia la conoscenza arriva al team
 *   solo quando la conversazione viene chiusa;
 * - se il daemon è spento quando una sessione finisce, la notifica si perde;
 * - le sessioni aperte prima di `micelio setup` non hanno l'hook.
 *
 * Soluzione: il daemon controlla periodicamente le trascrizioni che Claude Code scrive su disco
 * (~/.claude/projects/<progetto>/<sessione>.jsonl) e accoda la PARTE NUOVA di quelle avviate in una
 * cartella abilitata. La pipeline elabora solo le righe non ancora elaborate (session_progress),
 * quindi ogni parte viene distillata una sola volta, che arrivi dall'hook o da qui.
 *
 * Quando una parte nuova è "matura" per essere distillata:
 * - la sessione è in PAUSA da almeno `idleMinutes` (nessuna scrittura recente): di solito vuol
 *   dire che un problema è stato chiuso, e si evita di distillare un tentativo a metà;
 * - e c'è abbastanza contenuto nuovo (`minUserTurns` messaggi o `minChars` caratteri);
 * - oppure la sessione è ferma da molte ore (`staleHours`): allora basta qualunque contenuto non
 *   banale, per non lasciare per sempre indietro la coda di una sessione abbandonata.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isInsideWatched } from '../node/config'
import type { PrivateStore } from '../store/private-store'
import { extractTranscript } from './transcript'

export interface ScanOptions {
  /** Cartella delle trascrizioni di Claude Code. */
  projectsDir: string
  /** Cartelle abilitate alla raccolta (D7). */
  watched: string[]
  idleMinutes: number
  minUserTurns: number
  minChars: number
  staleHours: number
  now?: number
}

export interface SessionCandidate { sessionId: string, transcriptPath: string, cwd: string }

/** Cartella delle trascrizioni di Claude Code (rispetta CLAUDE_CONFIG_DIR). */
export function claudeProjectsDir (): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
}

/** Contenuto minimo perché una parte valga una distillazione anche se "vecchia". */
const MIN_STALE_CHARS = 400

/**
 * Cartella di lavoro di una sessione, letta dalle prime righe della trascrizione (ogni messaggio
 * riporta `cwd`). Legge al massimo 256 KB: non serve caricare file di molti MB.
 */
export function transcriptCwd (file: string): string | null {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(256 * 1024)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    for (const line of buf.subarray(0, n).toString('utf8').split('\n')) {
      try {
        const row = JSON.parse(line)
        if (typeof row.cwd === 'string') return row.cwd
      } catch {
        // riga incompleta (fine del buffer) o non JSON: si passa alla successiva
      }
    }
    return null
  } finally {
    fs.closeSync(fd)
  }
}

export class SessionScanner {
  /** Cache percorso → cartella di lavoro: la cwd di una trascrizione non cambia. */
  private readonly cwdCache = new Map<string, string | null>()
  /** Ultima dimensione vista per file: un file invariato non va riletto. */
  private readonly sizeSeen = new Map<string, number>()

  constructor (private readonly store: PrivateStore) {}

  /**
   * Trova le sessioni con una parte nuova pronta da distillare.
   * Non accoda nulla: lo fa il chiamante (MicelioNode), che conosce la pipeline.
   */
  scan (o: ScanOptions): SessionCandidate[] {
    const now = o.now ?? Date.now()
    if (o.watched.length === 0 || !fs.existsSync(o.projectsDir)) return []
    const pending = this.store.pendingSessionIds()
    const out: SessionCandidate[] = []
    for (const dir of fs.readdirSync(o.projectsDir)) {
      const full = path.join(o.projectsDir, dir)
      if (!fs.statSync(full).isDirectory()) continue
      for (const f of fs.readdirSync(full)) {
        if (!f.endsWith('.jsonl')) continue
        const file = path.join(full, f)
        const sessionId = f.slice(0, -'.jsonl'.length)
        if (pending.has(sessionId)) continue
        const st = fs.statSync(file)
        // 1) Sessione ancora attiva (scritta da poco): aspettiamo una pausa.
        const idleMs = now - st.mtimeMs
        if (idleMs < o.idleMinutes * 60_000) continue
        // 2) File invariato dall'ultimo controllo: niente di nuovo.
        if (this.sizeSeen.get(file) === st.size) continue
        // 3) Solo le sessioni avviate in una cartella abilitata.
        if (!this.cwdCache.has(file)) this.cwdCache.set(file, transcriptCwd(file))
        const cwd = this.cwdCache.get(file)
        if (!cwd || !isInsideWatched(cwd, o.watched)) { this.sizeSeen.set(file, st.size); continue }
        // 4) Parte nuova abbastanza "matura"?
        const ex = extractTranscript(file, this.store.sessionLines(sessionId))
        const stale = idleMs >= o.staleHours * 3600_000
        const enough = ex.userTurns >= o.minUserTurns || ex.text.length >= o.minChars
        if (ex.userTurns === 0 || !(enough || (stale && ex.text.length >= MIN_STALE_CHARS))) continue
        this.sizeSeen.set(file, st.size)
        out.push({ sessionId, transcriptPath: file, cwd })
      }
    }
    return out
  }
}
