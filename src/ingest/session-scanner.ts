/**
 * @file Raccolta delle sessioni di Claude Code IN CORSO e recupero di quelle perse.
 *
 * EN: Collects Claude Code sessions IN PROGRESS and recovers the lost ones.
 *
 * L'hook di fine sessione (SessionEnd) da solo non basta:
 * - le sessioni lunghe durano giorni: senza raccolta intermedia la conoscenza arriva al team
 *   solo quando la conversazione viene chiusa;
 * - se il daemon è spento quando una sessione finisce, la notifica si perde;
 * - le sessioni aperte prima di `micelio setup` non hanno l'hook.
 *
 * EN: The session-end hook (SessionEnd) alone is not enough:
 * - long sessions last for days: without intermediate collection the knowledge reaches the team only
 *   when the conversation is closed;
 * - if the daemon is off when a session ends, the notification is lost;
 * - sessions opened before `micelio setup` don't have the hook.
 *
 * Soluzione: il daemon controlla periodicamente le trascrizioni che Claude Code scrive su disco
 * (~/.claude/projects/<progetto>/<sessione>.jsonl) e accoda la PARTE NUOVA di quelle avviate in una
 * cartella abilitata. La pipeline elabora solo le righe non ancora elaborate (session_progress),
 * quindi ogni parte viene distillata una sola volta, che arrivi dall'hook o da qui.
 *
 * EN: Solution: the daemon periodically checks the transcripts that Claude Code writes to disk
 * (~/.claude/projects/<project>/<session>.jsonl) and queues the NEW PART of those started in an enabled
 * folder. The pipeline only processes the lines not yet processed (session_progress), so each part is
 * distilled only once, whether it comes from the hook or from here.
 *
 * Quando una parte nuova è "matura" per essere distillata:
 * - la sessione è in PAUSA da almeno `idleMinutes` (nessuna scrittura recente): di solito vuol
 *   dire che un problema è stato chiuso, e si evita di distillare un tentativo a metà;
 * - e c'è abbastanza contenuto nuovo (`minUserTurns` messaggi o `minChars` caratteri);
 * - oppure la sessione è ferma da molte ore (`staleHours`): allora basta qualunque contenuto non
 *   banale, per non lasciare per sempre indietro la coda di una sessione abbandonata.
 *
 * EN: When a new part is "ripe" for distillation:
 * - the session has been PAUSED for at least `idleMinutes` (no recent writes): it usually means a
 *   problem was closed, and we avoid distilling a half-done attempt;
 * - and there is enough new content (`minUserTurns` messages or `minChars` characters);
 * - or the session has been idle for many hours (`staleHours`): then any non-trivial content is enough,
 *   so the tail of an abandoned session is not left behind forever.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isInsideWatched } from '../node/config'
import type { PrivateStore } from '../store/private-store'
import { extractTranscript } from './transcript'

export interface ScanOptions {
  /** Cartella delle trascrizioni di Claude Code. / EN: Folder of the Claude Code transcripts. */
  projectsDir: string
  /** Cartelle abilitate alla raccolta (D7). / EN: Folders enabled for collection (D7). */
  watched: string[]
  idleMinutes: number
  minUserTurns: number
  minChars: number
  staleHours: number
  now?: number
}

export interface SessionCandidate { sessionId: string, transcriptPath: string, cwd: string }

/** Cartella delle trascrizioni di Claude Code (rispetta CLAUDE_CONFIG_DIR). / EN: Folder of the Claude Code transcripts (honors CLAUDE_CONFIG_DIR). */
export function claudeProjectsDir (): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
}

/** Contenuto minimo perché una parte valga una distillazione anche se "vecchia". / EN: Minimum content for a part to be worth a distillation even if "old". */
const MIN_STALE_CHARS = 400

/**
 * Cartella di lavoro di una sessione, letta dalle prime righe della trascrizione (ogni messaggio
 * riporta `cwd`). Legge al massimo 256 KB: non serve caricare file di molti MB.
 *
 * EN: Working folder of a session, read from the first lines of the transcript (every message carries
 * `cwd`). Reads at most 256 KB: no need to load files of many MB.
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
        // EN: incomplete line (end of the buffer) or not JSON: move on to the next one
      }
    }
    return null
  } finally {
    fs.closeSync(fd)
  }
}

export class SessionScanner {
  /** Cache percorso → cartella di lavoro: la cwd di una trascrizione non cambia. / EN: Cache path → working folder: a transcript's cwd does not change. */
  private readonly cwdCache = new Map<string, string | null>()
  /** Ultima dimensione vista per file: un file invariato non va riletto. / EN: Last size seen per file: an unchanged file does not need to be read again. */
  private readonly sizeSeen = new Map<string, number>()

  constructor (private readonly store: PrivateStore) {}

  /**
   * Trova le sessioni con una parte nuova pronta da distillare.
   * Non accoda nulla: lo fa il chiamante (MicelioNode), che conosce la pipeline.
   *
   * EN: Finds the sessions with a new part ready to distill. It queues nothing: the caller (MicelioNode)
   * does, since it knows the pipeline.
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
        // EN: 1) Session still active (written recently): we wait for a pause.
        const idleMs = now - st.mtimeMs
        if (idleMs < o.idleMinutes * 60_000) continue
        // 2) File invariato dall'ultimo controllo: niente di nuovo.
        // EN: 2) File unchanged since the last check: nothing new.
        if (this.sizeSeen.get(file) === st.size) continue
        // 3) Solo le sessioni avviate in una cartella abilitata.
        // EN: 3) Only sessions started in an enabled folder.
        if (!this.cwdCache.has(file)) this.cwdCache.set(file, transcriptCwd(file))
        const cwd = this.cwdCache.get(file)
        if (!cwd || !isInsideWatched(cwd, o.watched)) { this.sizeSeen.set(file, st.size); continue }
        // 4) Parte nuova abbastanza "matura"?
        // EN: 4) Is the new part "ripe" enough?
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
