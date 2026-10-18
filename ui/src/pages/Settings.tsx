/**
 * @file Impostazioni locali (attività 3.9): rete P2P (DHT pubblica o privata), cartelle abilitate
 * alla raccolta, modelli e budget LLM, configurazione di Claude Code. Sono impostazioni di QUESTO nodo (config.json), non del team.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { Card, ConfirmButton, Empty, ErrorBox, PageHeader } from '../components/ui'

export function Settings () {
  return (
    <>
      <PageHeader title='Impostazioni' subtitle='Impostazioni di questo PC. Quelle condivise dal team sono nella schermata Team.' />
      <div className='stack'>
        <NetworkCard />
        <WatchCard />
        <DocumentsCard />
        <LlmCard />
        <ClaudeCodeCard />
      </div>
    </>
  )
}

/**
 * Rete P2P: DHT pubblica di Holepunch o DHT privata del team (server/README.md).
 * - "Verifica" prova la scelta IN BOZZA senza cambiare nulla (ingresso, IP pubblico, NAT);
 * - "Applica" salva e ricollega subito il nodo, dopo una conferma: tutti i membri del team
 *   devono usare la stessa DHT, altrimenti non si trovano più.
 * I server privati restano salvati anche passando alla DHT pubblica.
 */
export function NetworkCard () {
  const client = useQueryClient()
  const net = useQuery({ queryKey: ['network'], queryFn: api.network })
  // Bozza: null = nessuna modifica rispetto a quanto salvato
  const [mode, setMode] = useState<'public' | 'private' | null>(null)
  const [text, setText] = useState<string | null>(null)
  const check = useMutation({ mutationFn: () => api.checkNetwork(draftMode, draftList) })
  const apply = useMutation({
    mutationFn: () => api.setNetwork(draftMode, draftMode === 'private' ? draftList : undefined),
    onSuccess: () => { setMode(null); setText(null); check.reset(); void client.invalidateQueries({ queryKey: ['network'] }); void client.invalidateQueries({ queryKey: ['status'] }) }
  })
  const n = net.data
  if (!n) return <Card title='Rete'><ErrorBox error={net.error} /></Card>

  const draftMode = mode ?? n.mode
  // Un nodo per riga (accetta anche virgole e spazi come separatori)
  const draftList = (text ?? n.bootstrap.join('\n')).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
  const changed = draftMode !== n.mode || (draftMode === 'private' && draftList.join(',') !== n.bootstrap.join(','))
  const inUse = n.active.length ? `DHT privata: ${n.active.join(', ')}` : 'DHT pubblica di Holepunch'

  if (n.fixedByEnv) {
    return (
      <Card title='Rete'>
        <div className='notice warn'>In uso: <span className='mono'>{n.fixedByEnv}</span>, fissata dalla variabile <code>MICELIO_DHT_BOOTSTRAP</code> (demo, container o test): da qui non si può cambiare.</div>
      </Card>
    )
  }

  return (
    <Card title='Rete'>
      <p className='muted' style={{ marginTop: 0 }}>
        Dove i nodi del team si incontrano su internet. I contenuti viaggiano sempre cifrati e direttamente fra i PC: la DHT serve solo a trovarsi.
        In uso adesso: <strong>{inUse}</strong>.
      </p>
      <div className='stack'>
        <label className={`choice ${draftMode === 'public' ? 'selected' : ''}`}>
          <input type='radio' name='dht' checked={draftMode === 'public'} onChange={() => { setMode('public'); check.reset() }} />
          <span>
            <strong>DHT pubblica</strong> (Holepunch)<br />
            <span className='muted small'>Nessun server da gestire. L'impronta del team e gli IP dei membri sono visibili nella DHT pubblica, i contenuti mai.</span>
          </span>
        </label>
        <label className={`choice ${draftMode === 'private' ? 'selected' : ''}`}>
          <input type='radio' name='dht' checked={draftMode === 'private'} onChange={() => { setMode('private'); check.reset() }} />
          <span>
            <strong>DHT privata del team</strong> (server del team)<br />
            <span className='muted small'>Nessuna dipendenza da terzi; impronta e IP restano sul vostro server. Si installa a parte: vedi server/README.md.</span>
          </span>
        </label>
        {draftMode === 'private' && (
          <div>
            <label>Nodi di avvio (uno per riga, host:porta)</label>
            <textarea rows={2} className='mono' value={text ?? n.bootstrap.join('\n')} onChange={(e) => { setText(e.target.value); check.reset() }} placeholder='203.0.113.10:49737' />
          </div>
        )}
      </div>

      {check.data && (
        <div className={`notice ${check.data.reachable ? (check.data.randomizedPort ? 'warn' : 'ok') : 'error'}`} style={{ marginTop: 10 }}>
          {check.data.reachable
            ? <>Raggiungibile: {check.data.nodes} nodi in {check.data.ms} ms · IP pubblico {check.data.publicHost ?? 'non determinato'} · NAT simmetrico: {check.data.randomizedPort === null ? 'non determinabile' : check.data.randomizedPort ? 'SÌ (la connessione diretta può fallire con colleghi nella stessa situazione)' : 'no'}</>
            : <>Nessun nodo ha risposto: server spento, porta UDP chiusa sul server, oppure questa rete blocca l'UDP in uscita.</>}
        </div>
      )}
      <ErrorBox error={check.error ?? apply.error} />
      <div className='row' style={{ marginTop: 10 }}>
        <button className='btn' disabled={check.isPending || (draftMode === 'private' && draftList.length === 0)} onClick={() => check.mutate()}>
          {check.isPending ? 'Verifica in corso…' : 'Verifica'}
        </button>
        <ConfirmButton
          label='Applica'
          confirmLabel='Sì, cambia rete: tutti i membri devono usare la stessa'
          onConfirm={() => apply.mutate()}
          disabled={!changed || apply.isPending || (draftMode === 'private' && draftList.length === 0)}
        />
        {changed && <button className='btn' onClick={() => { setMode(null); setText(null); check.reset() }}>Annulla</button>}
        {apply.isPending && <span className='muted small'>Riconnessione…</span>}
      </div>
    </Card>
  )
}

/** Cartelle in cui le sessioni di Claude Code vengono raccolte (opt-in, D7). */
function WatchCard () {
  const client = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const [path, setPath] = useState('')
  const refresh = () => void client.invalidateQueries({ queryKey: ['settings'] })
  const add = useMutation({ mutationFn: (p: string) => api.watchAdd(p), onSuccess: () => { setPath(''); refresh() } })
  const remove = useMutation({ mutationFn: (p: string) => api.watchRemove(p), onSuccess: refresh })

  /** Nell'app desktop usiamo il selettore di cartelle del sistema; nel browser si scrive il percorso. */
  const pick = async () => {
    const chosen = await window.micelio?.pickFolder?.()
    if (chosen) add.mutate(chosen)
  }

  return (
    <Card title='Raccolta automatica dalle sessioni di Claude Code'>
      <p className='muted' style={{ marginTop: 0 }}>
        Solo le sessioni avviate in queste cartelle (e sottocartelle) vengono elaborate. Tutto passa comunque dal filtro privacy.
      </p>
      {settings.data?.watched.length === 0 && <Empty>Nessuna cartella abilitata.</Empty>}
      <div className='list'>
        {settings.data?.watched.map((w) => (
          <div key={w} className='list-item row'>
            <span className='mono small' style={{ overflowWrap: 'anywhere' }}>{w}</span>
            <span className='spacer' />
            <button className='btn small' onClick={() => remove.mutate(w)}>Rimuovi</button>
          </div>
        ))}
      </div>
      <div className='row' style={{ marginTop: 10 }}>
        {window.micelio?.pickFolder && <button className='btn' onClick={() => void pick()}>Scegli cartella…</button>}
        <input style={{ flex: 1 }} value={path} onChange={(e) => setPath(e.target.value)} placeholder='C:\progetti\ordini' />
        <button className='btn primary' disabled={!path.trim() || add.isPending} onClick={() => add.mutate(path.trim())}>Abilita</button>
      </div>
      <ErrorBox error={add.error ?? remove.error} />
    </Card>
  )
}

/** Cartelle di documenti sorvegliate (Fase 4). */
function DocumentsCard () {
  const client = useQueryClient()
  const docs = useQuery({ queryKey: ['documents'], queryFn: api.documents })
  const [path, setPath] = useState('')
  const [shareable, setShareable] = useState(false)
  const refresh = () => void client.invalidateQueries({ queryKey: ['documents'] })
  const add = useMutation({ mutationFn: (p: string) => api.documentsAdd(p, shareable), onSuccess: () => { setPath(''); refresh() } })
  const remove = useMutation({ mutationFn: (p: string) => api.documentsRemove(p), onSuccess: refresh })
  const pick = async () => {
    const chosen = await window.micelio?.pickFolder?.()
    if (chosen) add.mutate(chosen)
  }
  const stats = docs.data?.stats ?? {}

  return (
    <Card title='Cartelle di documenti'>
      <p className='muted' style={{ marginTop: 0 }}>
        PDF, Word, Excel, PowerPoint, OpenDocument e Markdown vengono distillati in ricordi (filtro privacy incluso; le cartelle come «HR» o «contratti» non vengono nemmeno lette).
        Al team arriva solo il distillato: l'originale resta qui e, se la cartella è <strong>condivisibile</strong>, i colleghi possono scaricarlo su richiesta.
      </p>
      {docs.data?.folders.length === 0 && <Empty>Nessuna cartella di documenti.</Empty>}
      <div className='list'>
        {docs.data?.folders.map((f) => (
          <div key={f.path} className='list-item row'>
            <span className='mono small' style={{ overflowWrap: 'anywhere' }}>{f.path}</span>
            <span className={`badge ${f.shareable ? 'accent' : ''}`}>{f.shareable ? 'originali scaricabili' : 'solo distillato'}</span>
            <span className='spacer' />
            <button className='btn small' onClick={() => remove.mutate(f.path)}>Rimuovi</button>
          </div>
        ))}
      </div>
      {Object.keys(stats).length > 0 && (
        <div className='row small' style={{ marginTop: 8 }}>
          {Object.entries(stats).map(([k, v]) => <span key={k} className='badge'>{({ done: 'elaborati', queued: 'in coda', blocked: 'bloccati', failed: 'illeggibili', removed: 'rimossi' } as Record<string, string>)[k] ?? k}: {v}</span>)}
        </div>
      )}
      <div className='row' style={{ marginTop: 10 }}>
        {window.micelio?.pickFolder && <button className='btn' onClick={() => void pick()}>Scegli cartella…</button>}
        <input style={{ flex: 1 }} value={path} onChange={(e) => setPath(e.target.value)} placeholder='C:\\documenti\\architettura' />
        <label className='row' style={{ margin: 0, color: 'var(--text)' }}>
          <input type='checkbox' style={{ width: 'auto' }} checked={shareable} onChange={(e) => setShareable(e.target.checked)} /> originali scaricabili
        </label>
        <button className='btn primary' disabled={!path.trim() || add.isPending} onClick={() => add.mutate(path.trim())}>Aggiungi</button>
      </div>
      <ErrorBox error={add.error ?? remove.error} />
    </Card>
  )
}

/** Modelli e budget giornaliero: hanno effetto subito, senza riavviare il daemon. */
function LlmCard () {
  const client = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const [draft, setDraft] = useState<{ classifyModel?: string, distillModel?: string, dailyBudget?: string }>({})
  const save = useMutation({
    mutationFn: () => api.updateLlm({
      classifyModel: draft.classifyModel,
      distillModel: draft.distillModel,
      dailyBudget: draft.dailyBudget !== undefined ? Number(draft.dailyBudget) : undefined
    }),
    onSuccess: () => { setDraft({}); void client.invalidateQueries({ queryKey: ['settings'] }) }
  })
  const llm = settings.data?.llm
  if (!llm) return null
  const changed = Object.keys(draft).length > 0

  return (
    <Card title='Intelligenza (LLM)'>
      <p className='muted' style={{ marginTop: 0 }}>
        Adapter: <strong>{llm.adapter}</strong> ({llm.command}). Usa il tuo abbonamento tramite la CLI, nessuna API key.
        Per cambiare adapter modifica <code>config.json</code> e riavvia il daemon.
      </p>
      <div className='row'>
        <div style={{ flex: 1 }}>
          <label>Modello per classificare (veloce)</label>
          <input value={draft.classifyModel ?? llm.classifyModel} onChange={(e) => setDraft({ ...draft, classifyModel: e.target.value })} />
        </div>
        <div style={{ flex: 1 }}>
          <label>Modello per distillare (più capace)</label>
          <input value={draft.distillModel ?? llm.distillModel} onChange={(e) => setDraft({ ...draft, distillModel: e.target.value })} />
        </div>
        <div style={{ width: 200 }}>
          <label>Chiamate massime al giorno</label>
          <input type='number' min={0} value={draft.dailyBudget ?? String(llm.dailyBudget)} onChange={(e) => setDraft({ ...draft, dailyBudget: e.target.value })} />
        </div>
      </div>
      <ErrorBox error={save.error} />
      <div className='row' style={{ marginTop: 10 }}>
        <button className='btn primary' disabled={!changed || save.isPending} onClick={() => save.mutate()}>Salva</button>
        {changed && <button className='btn' onClick={() => setDraft({})}>Annulla</button>}
      </div>
    </Card>
  )
}

/** Registra MCP e hook di fine sessione in Claude Code (come `micelio setup claude-code`). */
function ClaudeCodeCard () {
  const setup = useMutation({ mutationFn: (hook: boolean) => api.setupClaudeCode(hook) })
  return (
    <Card title='Claude Code'>
      <p className='muted' style={{ marginTop: 0 }}>
        Registra Micelio come server MCP di Claude Code e, se vuoi, l'hook che a fine sessione avvisa Micelio (raccolta automatica, solo nelle cartelle abilitate).
        Modifica la configurazione di Claude Code nel tuo profilo utente; viene salvata una copia di backup.
      </p>
      <div className='row'>
        <ConfirmButton label='Configura MCP + raccolta automatica' confirmLabel='Sì, modifica la configurazione' onConfirm={() => setup.mutate(true)} disabled={setup.isPending} />
        <ConfirmButton label='Solo MCP' confirmLabel='Sì, registra MCP' onConfirm={() => setup.mutate(false)} disabled={setup.isPending} />
      </div>
      <ErrorBox error={setup.error} />
      {setup.data && (
        <div className='notice ok' style={{ marginTop: 10 }}>
          Server MCP registrato su {setup.data.mcpUrl}.{setup.data.hookFile ? ` Hook installato in ${setup.data.hookFile}.` : ''}
        </div>
      )}
    </Card>
  )
}
