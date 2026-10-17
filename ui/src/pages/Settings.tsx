/**
 * @file Impostazioni locali (attività 3.9): cartelle abilitate alla raccolta, modelli e budget
 * LLM, configurazione di Claude Code. Sono impostazioni di QUESTO nodo (config.json), non del team.
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
        <WatchCard />
        <LlmCard />
        <ClaudeCodeCard />
      </div>
    </>
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
