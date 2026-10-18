/**
 * @file Sicurezza (Fase 9): come Micelio tiene fuori password, token, file `.env` e simili.
 *
 * - BANCO DI PROVA: incolli un testo (o scrivi un nome di file) e vedi cosa toglierebbe il filtro,
 *   con le regole del team in vigore. Non salva nulla.
 * - REGOLE: cosa viene riconosciuto sempre, quali file sono sensibili per default, e le regole del
 *   TEAM (pattern di segreti, eccezioni per i falsi positivi, file sensibili aggiuntivi). Le regole
 *   del team valgono per tutti e le modifica solo un admin.
 * - RICORDI DA RIPULIRE: scansione dei ricordi già pubblicati con le regole attuali; un admin può
 *   "ripulire" (versione redatta pubblicata, originale rimosso).
 * - REGISTRO: cosa il filtro ha tolto su QUESTO PC, da dove e di che tipo. Mai i valori.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type SecurityRules } from '../api/client'
import { Card, ConfirmButton, Empty, ErrorBox, PageHeader } from '../components/ui'
import { dateTime } from '../format'

/** "github-token ×2, email" da un conteggio per tipo. */
export function kindsText (k: Record<string, number>): string {
  return Object.entries(k).map(([t, n]) => `${t.replace('secret:', '')}${n > 1 ? ` ×${n}` : ''}`).join(', ')
}

export function Security () {
  const status = useQuery({ queryKey: ['status'], queryFn: api.status })
  const isAdmin = status.data?.role === 'admin'
  return (
    <>
      <PageHeader title='Sicurezza' subtitle='Password, token, chiavi e file come .env non entrano mai nel sapere del team: vengono tolti prima di qualunque AI.' />
      <div className='stack'>
        <TestBench />
        <RulesCard isAdmin={isAdmin} />
        <ScanCard isAdmin={isAdmin} />
        <LogCard />
      </div>
    </>
  )
}

/** Banco di prova: testo e/o nome di file → cosa farebbe il filtro. */
function TestBench () {
  const [text, setText] = useState('')
  const [file, setFile] = useState('')
  const test = useMutation({ mutationFn: () => api.securityTest(text, file.trim() || undefined) })
  const r = test.data
  return (
    <Card title='Banco di prova'>
      <p className='muted' style={{ marginTop: 0 }}>Incolla un testo (un log, una configurazione, un pezzo di conversazione) o scrivi un nome di file: vedi cosa toglierebbe Micelio, con le regole del team in vigore. Non viene salvato nulla.</p>
      <textarea rows={5} className='mono' value={text} onChange={(e) => setText(e.target.value)} placeholder={'DATABASE_URL=postgres://app:Segreta123@db:5432/app\nAuthorization: Bearer eyJ…'} />
      <div className='row' style={{ marginTop: 8 }}>
        <input style={{ flex: 1 }} value={file} onChange={(e) => setFile(e.target.value)} placeholder='Nome di file (facoltativo): es. config/.env.production' />
        <button className='btn primary' disabled={test.isPending || (!text.trim() && !file.trim())} onClick={() => test.mutate()}>Prova</button>
      </div>
      <ErrorBox error={test.error} />
      {r && (
        <div className='stack' style={{ marginTop: 10 }}>
          {r.blockedBy.length > 0 && <div className='notice warn'>Bloccato: resterebbe privato (argomenti HR/personali: {r.blockedBy.join(', ')}).</div>}
          {text.trim() && (
            <>
              <div className='row small'>
                {Object.keys(r.redactions).length
                  ? Object.entries(r.redactions).map(([k, n]) => <span key={k} className='badge danger'>{k.replace('secret:', '')}{n > 1 ? ` ×${n}` : ''}</span>)
                  : <span className='badge accent'>nessun segreto trovato</span>}
              </div>
              <pre className='mono small' style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.text}</pre>
            </>
          )}
          {file.trim() && (
            <div className={`notice ${r.sensitiveFile ? 'warn' : 'ok'}`}>
              {r.sensitiveFile
                ? <>«{file}» è un <strong>file sensibile</strong> (regola <span className='mono'>{r.sensitiveFile}</span>): il suo contenuto non entra mai in Micelio.</>
                : <>«{file}» non è considerato sensibile.</>}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/** Elenco "una voce per riga" ↔ array. */
const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)

/** Regole: fisse (sola lettura) e del team (modificabili dall'admin). */
function RulesCard ({ isAdmin }: { isAdmin: boolean }) {
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
  if (!r) return <Card title='Regole'><ErrorBox error={rules.error} /></Card>
  const patterns = draft?.patterns ?? r.team.secretPatterns
  const setPatterns = (p: SecurityRules['team']['secretPatterns']) => setDraft({ ...draft, patterns: p })

  return (
    <Card title='Regole'>
      <details>
        <summary className='small'>Riconosciuti sempre: {r.builtin.length} tipi di segreto e dato personale</summary>
        <ul className='small' style={{ columns: 2, margin: '6px 0 0' }}>{r.builtin.map((b) => <li key={b.type}>{b.label}</li>)}</ul>
      </details>
      <details style={{ marginTop: 6 }}>
        <summary className='small'>File sensibili di default: {r.defaultSensitiveFiles.length} regole (.env, chiavi, credenziali, kubeconfig…)</summary>
        <div className='row small' style={{ marginTop: 6 }}>{r.defaultSensitiveFiles.map((f) => <span key={f} className='badge mono'>{f}</span>)}</div>
      </details>

      <h4 style={{ margin: '14px 0 4px' }}>Regole del team</h4>
      {!isAdmin && <p className='muted small' style={{ marginTop: 0 }}>Valgono per tutti i nodi; le modifica solo un admin.</p>}

      <label>Pattern di segreti aggiuntivi (espressioni regolari)</label>
      <div className='stack' style={{ gap: 6 }}>
        {patterns.length === 0 && <span className='muted small'>Nessuno.</span>}
        {patterns.map((p, i) => (
          <div key={i} className='row'>
            <input style={{ width: 200 }} value={p.name} disabled={!isAdmin} placeholder='Nome (es. Codice cliente)' onChange={(e) => setPatterns(patterns.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input style={{ flex: 1 }} className='mono' value={p.regex} disabled={!isAdmin} placeholder='CLI-\d{6}' onChange={(e) => setPatterns(patterns.map((x, j) => (j === i ? { ...x, regex: e.target.value } : x)))} />
            {isAdmin && <button className='btn small' onClick={() => setPatterns(patterns.filter((_, j) => j !== i))}>Rimuovi</button>}
          </div>
        ))}
        {isAdmin && <div><button className='btn small' onClick={() => setPatterns([...patterns, { name: '', regex: '' }])}>+ Aggiungi pattern</button></div>}
      </div>

      <div className='row' style={{ alignItems: 'flex-start', marginTop: 10 }}>
        <div style={{ flex: 1 }}>
          <label>Eccezioni (falsi positivi da non togliere): testo, oppure /regex/; una per riga</label>
          <textarea rows={3} className='mono' disabled={!isAdmin} value={draft?.allow ?? r.team.allow.join('\n')} onChange={(e) => setDraft({ ...draft, allow: e.target.value })} placeholder='demo-key-pubblica' />
        </div>
        <div style={{ flex: 1 }}>
          <label>File sensibili aggiuntivi (glob); uno per riga</label>
          <textarea rows={3} className='mono' disabled={!isAdmin} value={draft?.files ?? r.team.sensitiveFiles.join('\n')} onChange={(e) => setDraft({ ...draft, files: e.target.value })} placeholder='**/*.conf' />
        </div>
      </div>
      <ErrorBox error={save.error} />
      {isAdmin && (
        <div className='row' style={{ marginTop: 10 }}>
          <button className='btn primary' disabled={!draft || save.isPending} onClick={() => save.mutate()}>Salva per tutto il team</button>
          {draft && <button className='btn' onClick={() => setDraft(null)}>Annulla</button>}
        </div>
      )}
    </Card>
  )
}

/** Scansione dei ricordi pubblicati e pulizia (admin). */
function ScanCard ({ isAdmin }: { isAdmin: boolean }) {
  const client = useQueryClient()
  const [run, setRun] = useState(false)
  const scan = useQuery({ queryKey: ['security', 'scan'], queryFn: api.securityScan, enabled: run })
  const clean = useMutation({ mutationFn: (id: string) => api.securityClean(id), onSuccess: () => void client.invalidateQueries({ queryKey: ['security'] }) })
  return (
    <Card title='Ricordi da ripulire'>
      <p className='muted' style={{ marginTop: 0 }}>Controlla i ricordi già pubblicati con le regole attuali (per esempio dopo aver aggiunto un pattern). «Ripulisci» pubblica la versione redatta e rimuove l'originale dalla vista di tutti; una Radice resta Radice.</p>
      <button className='btn' disabled={scan.isFetching} onClick={() => { setRun(true); void scan.refetch() }}>{scan.isFetching ? 'Scansione…' : 'Scansiona i ricordi'}</button>
      <ErrorBox error={scan.error ?? clean.error} />
      {scan.data && scan.data.length === 0 && <div className='notice ok' style={{ marginTop: 10 }}>Nessun ricordo con segreti o dati personali.</div>}
      {scan.data && scan.data.length > 0 && (
        <div className='list' style={{ marginTop: 10 }}>
          {scan.data.map((f) => (
            <div key={f.id} className='list-item row'>
              <span style={{ flex: 1 }}>{f.root && <span className='root-mark' title='Radice'>◆ </span>}{f.title} <span className='muted small'>· {f.authorName ?? f.author.slice(0, 8)}</span></span>
              <span className='badge danger'>{kindsText(f.kinds)}</span>
              {isAdmin && <ConfirmButton label='Ripulisci' confirmLabel='Sì, ripulisci per tutti' onConfirm={() => clean.mutate(f.id)} disabled={clean.isPending} />}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/** Registro locale: cosa è stato tolto, da dove, di che tipo. */
function LogCard () {
  const log = useQuery({ queryKey: ['security', 'log'], queryFn: () => api.securityLog(100) })
  const SOURCE: Record<string, string> = { 'claude-code': 'sessione', document: 'documento', clean: 'ripulitura', cli: 'CLI', mcp: 'agente', api: 'app' }
  return (
    <Card title='Registro di questo PC'>
      <p className='muted' style={{ marginTop: 0 }}>Cosa il filtro ha tolto e da dove. Si registrano solo i tipi e i nomi dei file, mai i valori. Il registro non lascia questo PC.</p>
      <ErrorBox error={log.error} />
      {log.data?.length === 0 && <Empty>Ancora nulla da registrare.</Empty>}
      {!!log.data?.length && (
        <table className='small'>
          <thead><tr><th>Quando</th><th>Da</th><th>Contenuto</th><th>Tolto</th></tr></thead>
          <tbody>
            {log.data.map((e) => (
              <tr key={e.id}>
                <td>{dateTime(e.ts)}</td>
                <td>{SOURCE[e.source.type] ?? e.source.type}</td>
                <td>{e.label}</td>
                <td>
                  {kindsText(e.kinds)}
                  {e.omitted.length > 0 && <div className='muted'>file omessi: <span className='mono'>{e.omitted.join(', ')}</span></div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
