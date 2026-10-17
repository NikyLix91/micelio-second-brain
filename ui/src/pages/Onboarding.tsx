/**
 * @file Primo avvio: il nodo non appartiene ancora a nessun team.
 * Due strade, come in CLI: creare un team (`micelio init`) o entrarci con un invito (`micelio join`).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { Card, ErrorBox } from '../components/ui'

export function Onboarding () {
  const client = useQueryClient()
  const [mode, setMode] = useState<'join' | 'init'>('join')
  const [team, setTeam] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const done = () => void client.invalidateQueries()
  const init = useMutation({ mutationFn: () => api.init(team.trim(), name.trim()), onSuccess: done })
  const join = useMutation({ mutationFn: () => api.join(code.trim(), name.trim()), onSuccess: done })
  const busy = init.isPending || join.isPending

  return (
    <div className='centered'>
      <h1>Benvenuto in Micelio</h1>
      <p className='muted'>Questo nodo non fa ancora parte di un team.</p>
      <Card>
        <div className='row' style={{ marginBottom: 14 }}>
          <button className={`btn ${mode === 'join' ? 'primary' : ''}`} onClick={() => setMode('join')}>Ho un invito</button>
          <button className={`btn ${mode === 'init' ? 'primary' : ''}`} onClick={() => setMode('init')}>Crea un nuovo team</button>
        </div>
        <div className='stack'>
          {mode === 'init'
            ? <div><label>Nome del team</label><input value={team} onChange={(e) => setTeam(e.target.value)} placeholder='Team Dev' /></div>
            : <div><label>Codice d'invito</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder='incolla il codice ricevuto' /></div>}
          <div><label>Nome di questo PC (visibile ai colleghi)</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder='pc-mario' /></div>
          <ErrorBox error={init.error ?? join.error} />
          {join.isPending && <div className='notice small'>In attesa che un membro del team accolga la richiesta (fino a 2 minuti)…</div>}
          <div>
            {mode === 'init'
              ? <button className='btn primary' disabled={busy || !team.trim() || !name.trim()} onClick={() => init.mutate()}>Crea il team</button>
              : <button className='btn primary' disabled={busy || code.trim().length < 10 || !name.trim()} onClick={() => join.mutate()}>Entra nel team</button>}
          </div>
        </div>
      </Card>
    </div>
  )
}
