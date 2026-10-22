/**
 * @file Sicurezza (Fase 9): come Micelio tiene fuori password, token, file `.env` e simili.
 *
 * EN: Security (Phase 9): how Micelio keeps out passwords, tokens, `.env` files and the like.
 *
 * - BANCO DI PROVA: incolli un testo (o scrivi un nome di file) e vedi cosa toglierebbe il filtro,
 *   con le regole del team in vigore. Non salva nulla.
 * - REGOLE: cosa viene riconosciuto sempre, quali file sono sensibili per default, e le regole del
 *   TEAM (pattern di segreti, eccezioni per i falsi positivi, file sensibili aggiuntivi). Le regole
 *   del team valgono per tutti e le modifica solo un admin.
 * - RICORDI DA RIPULIRE: scansione dei ricordi già pubblicati con le regole attuali; un admin può
 *   "ripulire" (versione redatta pubblicata, originale rimosso).
 * - REGISTRO: cosa il filtro ha tolto su QUESTO PC, da dove e di che tipo. Mai i valori.
 * - REDAZIONI (B12): ricordi tolti da un admin, con le conferme di ogni PC e la ricevuta da esportare.
 *
 * EN:
 * - TEST BENCH: paste a text (or type a file name) and see what the filter would remove,
 *   with the team rules in force. It saves nothing.
 * - RULES: what is always detected, which files are sensitive by default, and the TEAM rules
 *   (secret patterns, exceptions for false positives, additional sensitive files). Team rules
 *   apply to everyone and only an admin can change them.
 * - MEMORIES TO CLEAN: scan of the already published memories with the current rules; an admin can
 *   "clean" them (redacted version published, original removed).
 * - LOG: what the filter removed on THIS PC, from where and of what kind. Never the values.
 * - REDACTIONS (B12): memories removed by an admin, with every PC's confirmation and the receipt to export.
 *
 * Le descrizioni dei riconoscitori fissi arrivano dal daemon in italiano: in inglese si mostra il
 * loro tipo tecnico (es. "github-token"), che è già comprensibile.
 *
 * EN: The descriptions of the built-in detectors come from the daemon in Italian: in English we
 * show their technical type (e.g. "github-token"), which is already understandable.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type RedactionView, type SecurityRules } from '../api/client'
import { Card, ConfirmButton, Empty, ErrorBox, PageHeader } from '../components/ui'
import { dateTime } from '../format'
import { defineStrings, useLang, useStrings } from '../i18n'

/** "github-token ×2, email" da un conteggio per tipo. / EN: "github-token ×2, email" from a per-kind count. */
export function kindsText (k: Record<string, number>): string {
  return Object.entries(k).map(([t, n]) => `${t.replace('secret:', '')}${n > 1 ? ` ×${n}` : ''}`).join(', ')
}

const S = defineStrings({
  it: {
    title: 'Sicurezza',
    subtitle: 'Password, token, chiavi e file come .env non entrano mai nel sapere del team: vengono tolti prima di qualunque AI.',
    bench: 'Banco di prova',
    benchIntro: 'Incolla un testo (un log, una configurazione, un pezzo di conversazione) o scrivi un nome di file: vedi cosa toglierebbe Micelio, con le regole del team in vigore. Non viene salvato nulla.',
    filePlaceholder: 'Nome di file (facoltativo): es. config/.env.production',
    test: 'Prova',
    blocked: (kw: string) => `Bloccato: resterebbe privato (argomenti HR/personali: ${kw}).`,
    noSecrets: 'nessun segreto trovato',
    sensitive1: (f: string) => `«${f}» è un`,
    sensitiveWord: 'file sensibile',
    sensitive2: '(regola',
    sensitive3: '): il suo contenuto non entra mai in Micelio.',
    notSensitive: (f: string) => `«${f}» non è considerato sensibile.`,
    rules: 'Regole',
    builtin: (n: number) => `Riconosciuti sempre: ${n} tipi di segreto e dato personale`,
    defaultFiles: (n: number) => `File sensibili di default: ${n} regole (.env, chiavi, credenziali, kubeconfig…)`,
    teamRules: 'Regole del team',
    teamRulesNote: 'Valgono per tutti i nodi; le modifica solo un admin.',
    patterns: 'Pattern di segreti aggiuntivi (espressioni regolari)',
    none: 'Nessuno.',
    patternName: 'Nome (es. Codice cliente)',
    removePattern: 'Rimuovi',
    addPattern: '+ Aggiungi pattern',
    allow: 'Eccezioni (falsi positivi da non togliere): testo, oppure /regex/; una per riga',
    files: 'File sensibili aggiuntivi (glob); uno per riga',
    saveTeam: 'Salva per tutto il team',
    cancel: 'Annulla',
    scan: 'Ricordi da ripulire',
    scanIntro: "Controlla i ricordi già pubblicati con le regole attuali (per esempio dopo aver aggiunto un pattern). «Ripulisci» pubblica la versione redatta e rimuove l'originale dalla vista di tutti; una Radice resta Radice.",
    scanning: 'Scansione…',
    scanRun: 'Scansiona i ricordi',
    scanClean: 'Nessun ricordo con segreti o dati personali.',
    root: 'Radice',
    clean: 'Ripulisci',
    cleanConfirm: 'Sì, ripulisci per tutti',
    log: 'Registro di questo PC',
    logIntro: 'Cosa il filtro ha tolto e da dove. Si registrano solo i tipi e i nomi dei file, mai i valori. Il registro non lascia questo PC.',
    logEmpty: 'Ancora nulla da registrare.',
    cols: ['Quando', 'Da', 'Contenuto', 'Tolto'],
    omitted: 'file omessi:',
    source: { 'claude-code': 'sessione', document: 'documento', clean: 'ripulitura', cli: 'CLI', mcp: 'agente', api: 'app' } as Record<string, string>,
    redactions: 'Redazioni',
    redactionsIntro: "Ricordi tolti da un admin per tutto il team. Ogni PC, appena riceve la redazione, toglie il ricordo anche da chat, Inbox e copie personali e lo conferma con una firma. La ricevuta si può esportare per chi deve sapere che il dato è stato tolto.",
    noRedactions: 'Nessuna redazione nel team.',
    progress: (c: number, t: number) => `${c} su ${t} PC confermati`,
    unknownDate: 'data non registrata',
    by: (name: string) => `da ${name}`,
    confirmedAt: (when: string) => `confermato il ${when}`,
    pending: 'in attesa (PC spento o versione precedente)',
    left: 'uscito dal team senza confermare',
    cleaned: (chat: number, inbox: number, personal: number) => `ripuliti: ${chat} risposte della chat, ${inbox} proposte in Inbox, ${personal} copie personali`,
    backups: (n: number) => `${n} backup precedenti restano nella cartella dei backup`,
    signed: 'firmato',
    unsigned: 'non firmato',
    exportText: 'Esporta ricevuta (testo)',
    exportJson: 'Esporta ricevuta (JSON firmato)'
  },
  en: {
    title: 'Security',
    subtitle: 'Passwords, tokens, keys and files such as .env never enter the team knowledge: they are removed before any AI sees them.',
    bench: 'Test bench',
    benchIntro: 'Paste a text (a log, a configuration, a piece of conversation) or type a file name: see what Micelio would remove, with the team rules in force. Nothing is saved.',
    filePlaceholder: 'File name (optional): e.g. config/.env.production',
    test: 'Test',
    blocked: (kw: string) => `Blocked: it would stay private (HR/personal topics: ${kw}).`,
    noSecrets: 'no secret found',
    sensitive1: (f: string) => `“${f}” is a`,
    sensitiveWord: 'sensitive file',
    sensitive2: '(rule',
    sensitive3: '): its content never enters Micelio.',
    notSensitive: (f: string) => `“${f}” is not considered sensitive.`,
    rules: 'Rules',
    builtin: (n: number) => `Always detected: ${n} kinds of secrets and personal data`,
    defaultFiles: (n: number) => `Default sensitive files: ${n} rules (.env, keys, credentials, kubeconfig…)`,
    teamRules: 'Team rules',
    teamRulesNote: 'They apply to every node; only an admin can change them.',
    patterns: 'Additional secret patterns (regular expressions)',
    none: 'None.',
    patternName: 'Name (e.g. Customer code)',
    removePattern: 'Remove',
    addPattern: '+ Add pattern',
    allow: 'Exceptions (false positives to keep): text, or /regex/; one per line',
    files: 'Additional sensitive files (glob); one per line',
    saveTeam: 'Save for the whole team',
    cancel: 'Cancel',
    scan: 'Memories to clean',
    scanIntro: 'Checks the memories already published with the current rules (for example after adding a pattern). “Clean” publishes the redacted version and removes the original from everyone’s view; a Root stays a Root.',
    scanning: 'Scanning…',
    scanRun: 'Scan the memories',
    scanClean: 'No memory with secrets or personal data.',
    root: 'Root',
    clean: 'Clean',
    cleanConfirm: 'Yes, clean it for everyone',
    log: 'Log of this PC',
    logIntro: 'What the filter removed and from where. Only kinds and file names are recorded, never the values. The log never leaves this PC.',
    logEmpty: 'Nothing recorded yet.',
    cols: ['When', 'From', 'Content', 'Removed'],
    omitted: 'files omitted:',
    source: { 'claude-code': 'session', document: 'document', clean: 'cleaning', cli: 'CLI', mcp: 'agent', api: 'app' } as Record<string, string>,
    redactions: 'Redactions',
    redactionsIntro: 'Memories removed by an admin for the whole team. As soon as it receives the redaction, every PC also removes the memory from chat, Inbox and personal copies and confirms with a signature. The receipt can be exported for whoever must know the data was removed.',
    noRedactions: 'No redaction in the team.',
    progress: (c: number, t: number) => `${c} of ${t} PCs confirmed`,
    unknownDate: 'date not recorded',
    by: (name: string) => `by ${name}`,
    confirmedAt: (when: string) => `confirmed on ${when}`,
    pending: 'pending (PC off or older version)',
    left: 'left the team without confirming',
    cleaned: (chat: number, inbox: number, personal: number) => `cleaned: ${chat} chat answers, ${inbox} Inbox proposals, ${personal} personal copies`,
    backups: (n: number) => `${n} earlier backups remain in the backup folder`,
    signed: 'signed',
    unsigned: 'not signed',
    exportText: 'Export receipt (text)',
    exportJson: 'Export receipt (signed JSON)'
  }
})

export function Security () {
  const s = useStrings(S)
  const status = useQuery({ queryKey: ['status'], queryFn: api.status })
  const isAdmin = status.data?.role === 'admin'
  return (
    <>
      <PageHeader help='security' title={s.title} subtitle={s.subtitle} />
      <div className='stack'>
        <TestBench />
        <RulesCard isAdmin={isAdmin} />
        <ScanCard isAdmin={isAdmin} />
        <RedactionsCard />
        <LogCard />
      </div>
    </>
  )
}

/** Banco di prova: testo e/o nome di file → cosa farebbe il filtro. / EN: Test bench: text and/or file name → what the filter would do. */
function TestBench () {
  const s = useStrings(S)
  const [text, setText] = useState('')
  const [file, setFile] = useState('')
  const test = useMutation({ mutationFn: () => api.securityTest(text, file.trim() || undefined) })
  const r = test.data
  return (
    <Card help='security#bench' title={s.bench}>
      <p className='muted' style={{ marginTop: 0 }}>{s.benchIntro}</p>
      <textarea rows={5} className='mono' value={text} onChange={(e) => setText(e.target.value)} placeholder={'DATABASE_URL=postgres://app:Segreta123@db:5432/app\nAuthorization: Bearer eyJ…'} />
      <div className='row' style={{ marginTop: 8 }}>
        <input style={{ flex: 1 }} value={file} onChange={(e) => setFile(e.target.value)} placeholder={s.filePlaceholder} />
        <button className='btn primary' disabled={test.isPending || (!text.trim() && !file.trim())} onClick={() => test.mutate()}>{s.test}</button>
      </div>
      <ErrorBox error={test.error} />
      {r && (
        <div className='stack' style={{ marginTop: 10 }}>
          {r.blockedBy.length > 0 && <div className='notice warn'>{s.blocked(r.blockedBy.join(', '))}</div>}
          {text.trim() && (
            <>
              <div className='row small'>
                {Object.keys(r.redactions).length
                  ? Object.entries(r.redactions).map(([k, n]) => <span key={k} className='badge danger'>{k.replace('secret:', '')}{n > 1 ? ` ×${n}` : ''}</span>)
                  : <span className='badge accent'>{s.noSecrets}</span>}
              </div>
              <pre className='mono small' style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.text}</pre>
            </>
          )}
          {file.trim() && (
            <div className={`notice ${r.sensitiveFile ? 'warn' : 'ok'}`}>
              {r.sensitiveFile
                ? <>{s.sensitive1(file)} <strong>{s.sensitiveWord}</strong> {s.sensitive2} <span className='mono'>{r.sensitiveFile}</span>{s.sensitive3}</>
                : <>{s.notSensitive(file)}</>}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/** Elenco "una voce per riga" ↔ array. / EN: "One entry per line" list ↔ array. */
const lines = (x: string) => x.split('\n').map((l) => l.trim()).filter(Boolean)

/** Regole: fisse (sola lettura) e del team (modificabili dall'admin). / EN: Rules: built-in (read-only) and team ones (editable by the admin). */
function RulesCard ({ isAdmin }: { isAdmin: boolean }) {
  const s = useStrings(S)
  const { lang } = useLang()
  const client = useQueryClient()
  const rules = useQuery({ queryKey: ['security', 'rules'], queryFn: api.securityRules })
  const [draft, setDraft] = useState<{ patterns?: SecurityRules['team']['secretPatterns'], allow?: string, files?: string } | null>(null)
  const save = useMutation({
    mutationFn: () => api.setSecurityRules({
      secretPatterns: draft?.patterns,
      allow: draft?.allow !== undefined ? lines(draft.allow) : undefined,
      sensitiveFiles: draft?.files !== undefined ? lines(draft.files) : undefined
    }),
    onSuccess: () => { setDraft(null); void client.invalidateQueries({ queryKey: ['security'] }) }
  })
  const r = rules.data
  if (!r) return <Card help='security#team-rules' title={s.rules}><ErrorBox error={rules.error} /></Card>
  const patterns = draft?.patterns ?? r.team.secretPatterns
  const setPatterns = (p: SecurityRules['team']['secretPatterns']) => setDraft({ ...draft, patterns: p })

  return (
    <Card help='security#team-rules' title={s.rules}>
      <details>
        <summary className='small'>{s.builtin(r.builtin.length)}</summary>
        <ul className='small' style={{ columns: 2, margin: '6px 0 0' }}>{r.builtin.map((b) => <li key={b.type}>{lang === 'it' ? b.label : b.type.replace('secret:', '')}</li>)}</ul>
      </details>
      <details style={{ marginTop: 6 }}>
        <summary className='small'>{s.defaultFiles(r.defaultSensitiveFiles.length)}</summary>
        <div className='row small' style={{ marginTop: 6 }}>{r.defaultSensitiveFiles.map((f) => <span key={f} className='badge mono'>{f}</span>)}</div>
      </details>

      <h4 style={{ margin: '14px 0 4px' }}>{s.teamRules}</h4>
      {!isAdmin && <p className='muted small' style={{ marginTop: 0 }}>{s.teamRulesNote}</p>}

      <label>{s.patterns}</label>
      <div className='stack' style={{ gap: 6 }}>
        {patterns.length === 0 && <span className='muted small'>{s.none}</span>}
        {patterns.map((p, i) => (
          <div key={i} className='row'>
            <input style={{ width: 200 }} value={p.name} disabled={!isAdmin} placeholder={s.patternName} onChange={(e) => setPatterns(patterns.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input style={{ flex: 1 }} className='mono' value={p.regex} disabled={!isAdmin} placeholder='CLI-\d{6}' onChange={(e) => setPatterns(patterns.map((x, j) => (j === i ? { ...x, regex: e.target.value } : x)))} />
            {isAdmin && <button className='btn small' onClick={() => setPatterns(patterns.filter((_, j) => j !== i))}>{s.removePattern}</button>}
          </div>
        ))}
        {isAdmin && <div><button className='btn small' onClick={() => setPatterns([...patterns, { name: '', regex: '' }])}>{s.addPattern}</button></div>}
      </div>

      <div className='row' style={{ alignItems: 'flex-start', marginTop: 10 }}>
        <div style={{ flex: 1 }}>
          <label>{s.allow}</label>
          <textarea rows={3} className='mono' disabled={!isAdmin} value={draft?.allow ?? r.team.allow.join('\n')} onChange={(e) => setDraft({ ...draft, allow: e.target.value })} placeholder='demo-key-pubblica' />
        </div>
        <div style={{ flex: 1 }}>
          <label>{s.files}</label>
          <textarea rows={3} className='mono' disabled={!isAdmin} value={draft?.files ?? r.team.sensitiveFiles.join('\n')} onChange={(e) => setDraft({ ...draft, files: e.target.value })} placeholder='**/*.conf' />
        </div>
      </div>
      <ErrorBox error={save.error} />
      {isAdmin && (
        <div className='row' style={{ marginTop: 10 }}>
          <button className='btn primary' disabled={!draft || save.isPending} onClick={() => save.mutate()}>{s.saveTeam}</button>
          {draft && <button className='btn' onClick={() => setDraft(null)}>{s.cancel}</button>}
        </div>
      )}
    </Card>
  )
}

/** Scansione dei ricordi pubblicati e pulizia (admin). / EN: Scan of published memories and cleaning (admin). */
function ScanCard ({ isAdmin }: { isAdmin: boolean }) {
  const s = useStrings(S)
  const client = useQueryClient()
  const [run, setRun] = useState(false)
  const scan = useQuery({ queryKey: ['security', 'scan'], queryFn: api.securityScan, enabled: run })
  const clean = useMutation({ mutationFn: (id: string) => api.securityClean(id), onSuccess: () => void client.invalidateQueries({ queryKey: ['security'] }) })
  return (
    <Card help='security#scan-clean' title={s.scan}>
      <p className='muted' style={{ marginTop: 0 }}>{s.scanIntro}</p>
      <button className='btn' disabled={scan.isFetching} onClick={() => { setRun(true); void scan.refetch() }}>{scan.isFetching ? s.scanning : s.scanRun}</button>
      <ErrorBox error={scan.error ?? clean.error} />
      {scan.data && scan.data.length === 0 && <div className='notice ok' style={{ marginTop: 10 }}>{s.scanClean}</div>}
      {scan.data && scan.data.length > 0 && (
        <div className='list' style={{ marginTop: 10 }}>
          {scan.data.map((f) => (
            <div key={f.id} className='list-item row'>
              <span style={{ flex: 1 }}>{f.root && <span className='root-mark' title={s.root}>◆ </span>}{f.title} <span className='muted small'>· {f.authorName ?? f.author.slice(0, 8)}</span></span>
              <span className='badge danger'>{kindsText(f.kinds)}</span>
              {isAdmin && <ConfirmButton label={s.clean} confirmLabel={s.cleanConfirm} onConfirm={() => clean.mutate(f.id)} disabled={clean.isPending} />}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/** Scarica un testo come file (ricevuta). / EN: Downloads a text as a file (receipt). */
function download (name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Redazioni del team con le conferme di ogni PC (B12) e la ricevuta da esportare. Visibile a tutti:
 * sapere che un dato è stato tolto davvero interessa l'intero team, non solo l'admin.
 *
 * EN: The team's redactions with every PC's confirmation (B12) and the receipt to export. Visible
 * to everyone: knowing that some data was really removed matters to the whole team, not just the admin.
 */
function RedactionsCard () {
  const s = useStrings(S)
  const { lang } = useLang()
  const list = useQuery({ queryKey: ['security', 'redactions'], queryFn: api.redactions })
  const [open, setOpen] = useState<string | null>(null)
  const exportReceipt = useMutation({
    mutationFn: async ({ id, json }: { id: string, json: boolean }) => {
      const r = await api.redactionReceipt(id, lang)
      if (json) download(`${r.name}.json`, JSON.stringify(r.json, null, 2), 'application/json')
      else download(`${r.name}.txt`, r.text, 'text/plain')
    }
  })
  const row = (m: RedactionView['members'][number]) => (
    <li key={m.key}>
      <b>{m.name}</b>{' '}
      {m.ack
        ? <span className='muted small'>· {s.confirmedAt(dateTime(m.ack.ts))} · {m.ack.sig ? s.signed : s.unsigned}<div>{s.cleaned(m.ack.cleaned.chat, m.ack.cleaned.inbox, m.ack.cleaned.personal)}{m.ack.backups ? ` · ${s.backups(m.ack.backups)}` : ''}</div></span>
        : <span className='muted small'>· {m.status === 'left' ? s.left : s.pending}</span>}
    </li>
  )
  return (
    <Card help='security#redactions' title={s.redactions}>
      <p className='muted' style={{ marginTop: 0 }}>{s.redactionsIntro}</p>
      <ErrorBox error={list.error ?? exportReceipt.error} />
      {list.data?.length === 0 && <Empty>{s.noRedactions}</Empty>}
      <div className='list'>
        {list.data?.map((r) => (
          <div key={r.id} className='list-item'>
            <div className='row clickable' onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span className='mono small'>{r.id.slice(0, 12)}</span>
              <span className='small'>{r.at ? dateTime(r.at) : s.unknownDate}{r.by ? ` · ${s.by(r.by.name)}` : ''}</span>
              <span className='spacer' />
              <span className={`badge ${r.confirmed === r.total ? 'ok' : 'warn'}`}>{s.progress(r.confirmed, r.total)}</span>
            </div>
            {r.reason && <div className='muted small'>{r.reason}</div>}
            {open === r.id && (
              <>
                <ul className='plain small'>{r.members.map(row)}</ul>
                <div className='row'>
                  <button className='btn small' disabled={exportReceipt.isPending} onClick={() => exportReceipt.mutate({ id: r.id, json: false })}>{s.exportText}</button>
                  <button className='btn small' disabled={exportReceipt.isPending} onClick={() => exportReceipt.mutate({ id: r.id, json: true })}>{s.exportJson}</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

/** Registro locale: cosa è stato tolto, da dove, di che tipo. / EN: Local log: what was removed, from where, of what kind. */
function LogCard () {
  const s = useStrings(S)
  const log = useQuery({ queryKey: ['security', 'log'], queryFn: () => api.securityLog(100) })
  return (
    <Card help='security#log' title={s.log}>
      <p className='muted' style={{ marginTop: 0 }}>{s.logIntro}</p>
      <ErrorBox error={log.error} />
      {log.data?.length === 0 && <Empty>{s.logEmpty}</Empty>}
      {!!log.data?.length && (
        <table className='small'>
          <thead><tr>{s.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {log.data.map((e) => (
              <tr key={e.id}>
                <td>{dateTime(e.ts)}</td>
                <td>{s.source[e.source.type] ?? e.source.type}</td>
                <td>{e.label}</td>
                <td>
                  {kindsText(e.kinds)}
                  {e.omitted.length > 0 && <div className='muted'>{s.omitted} <span className='mono'>{e.omitted.join(', ')}</span></div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
