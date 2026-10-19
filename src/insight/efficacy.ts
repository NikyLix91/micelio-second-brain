/**
 * @file Efficacia di Micelio per gli agenti (B11): cosa Micelio ha fornito in una sessione di
 * Claude Code e se l'agente l'ha usato. Funzioni pure sulle righe della trascrizione JSONL.
 *
 * COSA HA FORNITO. Due canali, entrambi riconoscibili nella trascrizione:
 * - tool MCP di Micelio (`mcp__micelio…__recall`, `architecture`, `get`…): il blocco `tool_use`
 *   dell'assistente e il suo `tool_result`, che riporta per ogni ricordo `id:<12 caratteri>`;
 * - contesto automatico degli hook (inizio sessione, ogni richiesta): righe `attachment` di tipo
 *   `hook_additional_context`, con `(id:<12 caratteri>)` per ogni ricordo.
 *
 * SE L'HA USATO (euristica, senza LLM). Dopo la consegna si guardano i messaggi e i comandi
 * dell'assistente (testo e input degli strumenti: comandi lanciati, file aperti o modificati).
 * Se vi compare un elemento DISTINTIVO del ricordo (un percorso, un comando fra backtick, un nome
 * di classe o di funzione, un URL, un file citato nei riferimenti al codice) l'esito è
 * "probabilmente utile", con quell'elemento come prova. Le parole comuni non contano: "kafka" o
 * "retry" si ripetono comunque, una riga di comando copiata no.
 * Il giudizio dell'LLM (alla distillazione, vedi src/ingest/pipeline.ts) conferma o smentisce.
 */

/** Ricordi forniti da Micelio in un punto della trascrizione. */
export interface Delivery {
  /** Indice della riga (nella porzione letta) in cui sono arrivati all'agente. */
  index: number
  /** recall | architecture | get | … per i tool MCP; session-start | prompt per gli hook. */
  channel: string
  /** Id abbreviati (12 caratteri), come li mostra Micelio. */
  ids: string[]
}

const ID_RE = /\bid:([0-9a-f]{12})\b/g
/** Nome dei tool MCP di Micelio: il server può chiamarsi `micelio` o `micelio-<qualcosa>`. */
const MICELIO_TOOL_RE = /^mcp__micelio[\w-]*__(\w+)$/

/** Testo di un contenuto (stringa, blocco o array annidato). */
function textOf (c: any): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map(textOf).join('\n')
  if (c && typeof c === 'object') return textOf(c.text ?? c.content ?? '')
  return ''
}

function idsIn (text: string): string[] {
  return [...new Set([...text.matchAll(ID_RE)].map((m) => m[1]))]
}

/** Righe JSON della trascrizione (quelle malformate si saltano). */
export function parseLines (raw: string[]): any[] {
  const out: any[] = []
  for (const l of raw) {
    if (!l.trim()) continue
    try { out.push(JSON.parse(l)) } catch { out.push(null) }
  }
  return out
}

/** Dove e cosa ha fornito Micelio nella porzione di trascrizione. */
export function findDeliveries (rows: any[]): Delivery[] {
  const out: Delivery[] = []
  const pending = new Map<string, string>() // id del tool_use → canale
  rows.forEach((r, index) => {
    if (!r || r.isSidechain) return
    const content = r.message?.content
    if (r.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        const m = b?.type === 'tool_use' && typeof b.name === 'string' ? b.name.match(MICELIO_TOOL_RE) : null
        if (m) pending.set(b.id, m[1])
      }
    } else if (r.type === 'user' && Array.isArray(content)) {
      for (const b of content) {
        if (b?.type !== 'tool_result' || !pending.has(b.tool_use_id)) continue
        const ids = idsIn(textOf(b.content))
        if (ids.length) out.push({ index, channel: pending.get(b.tool_use_id)!, ids })
      }
    } else if (r.type === 'attachment' && r.attachment?.type === 'hook_additional_context') {
      const text = textOf(r.attachment.content)
      if (!text.includes('Micelio')) return
      const ids = idsIn(text)
      if (ids.length) out.push({ index, channel: r.attachment.hookEvent === 'SessionStart' ? 'session-start' : 'prompt', ids })
    }
  })
  return out
}

/**
 * Cosa ha fatto l'assistente DOPO la riga `from`: testo dei messaggi e input degli strumenti
 * (comandi, file letti o modificati). Esclusi i tool di Micelio stessi, che ripeterebbero la domanda.
 */
export function actionsAfter (rows: any[], from: number): string {
  const parts: string[] = []
  for (let i = from + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.isSidechain || r.type !== 'assistant' || !Array.isArray(r.message?.content)) continue
    for (const b of r.message.content) {
      if (b?.type === 'text' && b.text) parts.push(b.text)
      else if (b?.type === 'tool_use' && !(typeof b.name === 'string' && MICELIO_TOOL_RE.test(b.name))) parts.push(JSON.stringify(b.input ?? {}))
    }
  }
  return parts.join('\n')
}

/** Un ricordo, per quanto serve all'euristica. */
export interface MemoryForJudge {
  title: string
  body: string
  source?: { code?: { files?: string[], symbols?: string[] } }
}

/** Parole che compaiono fra backtick ma non distinguono nulla (comandi e valori generici). */
const GENERIC = new Set(['true', 'false', 'null', 'undefined', 'npm', 'npm install', 'npm test', 'git', 'node', 'yes', 'no', 'main', 'master', 'src', 'test', 'tests', 'docs', 'build', 'dist', 'index.ts', 'index.js', 'package.json', 'readme.md'])

/**
 * Elementi distintivi di un ricordo: ciò che, ritrovato nelle azioni dell'agente, indica che il
 * ricordo è stato usato davvero. In ordine di forza (i primi sono le prove migliori).
 */
export function distinctiveTokens (m: MemoryForJudge): string[] {
  const out: string[] = []
  const add = (t: string) => {
    const v = t.trim().replace(/[.,;:)]+$/, '')
    if (v.length < 5 || v.length > 160 || GENERIC.has(v.toLowerCase())) return
    if (!out.includes(v)) out.push(v)
  }
  const text = `${m.title}\n${m.body}`
  // 1. file e simboli dei riferimenti al codice
  for (const f of m.source?.code?.files ?? []) add(f)
  for (const s of m.source?.code?.symbols ?? []) add(s.replace(/^(class|function|interface|const|POST|GET|PUT|DELETE|PATCH)\s+/, ''))
  // 2. testo fra backtick (comandi, nomi, valori di configurazione); dei comandi anche la prima parte
  for (const mm of text.matchAll(/`([^`\n]{3,200})`/g)) {
    add(mm[1])
    const head = mm[1].split(/\s+/).slice(0, 3).join(' ')
    if (head !== mm[1] && head.includes(' ')) add(head)
  }
  // 3. percorsi di file e file con estensione
  for (const mm of text.matchAll(/(?:[\w.-]+[\\/])+[\w.-]+\.\w{1,8}\b/g)) add(mm[0])
  for (const mm of text.matchAll(/\b[\w-]+\.(?:ts|tsx|js|jsx|json|ya?ml|py|cs|java|sql|xml|toml|sh|ps1|env|properties|gradle|csproj|config)\b/g)) add(mm[0])
  // 4. URL
  for (const mm of text.matchAll(/https?:\/\/[^\s)>\]]+/g)) add(mm[0])
  // 5. identificatori: CamelCase con almeno due "gobbe", snake_case, nomi con punti (Foo.bar)
  for (const mm of text.matchAll(/\b(?:[A-Z][a-z0-9]+){2,}[A-Za-z0-9]*\b|\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b|\b[A-Za-z_]\w*\.[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\b/g)) add(mm[0])
  return out
}

/** Per confrontare percorsi scritti con barre diverse e maiuscole diverse (Windows). */
function normPath (s: string): string {
  return s.replace(/\\\\/g, '/').replace(/\\/g, '/').toLowerCase()
}

/**
 * Euristica: il ricordo ha lasciato tracce nelle azioni successive?
 * @returns 'likely' con la prova (l'elemento ritrovato), o 'none'
 */
export function judgeUse (m: MemoryForJudge, after: string): { verdict: 'likely' | 'none', evidence: string | null } {
  if (!after) return { verdict: 'none', evidence: null }
  const afterNorm = normPath(after)
  for (const t of distinctiveTokens(m)) {
    const isPath = /[\\/]/.test(t) || /\.\w{1,8}$/.test(t)
    if (isPath ? afterNorm.includes(normPath(t)) : after.includes(t)) return { verdict: 'likely', evidence: t }
  }
  return { verdict: 'none', evidence: null }
}
