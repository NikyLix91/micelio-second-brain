/**
 * @file Primo avvio: il nodo non appartiene ancora a nessun team.
 * Due strade, come in CLI: creare un team (`micelio init`) o entrarci con un invito (`micelio join`).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { Card, ErrorBox } from '../components/ui'
import { defineStrings, LangSwitch, useStrings } from '../i18n'

const S = defineStrings({
  it: {
    welcome: 'Benvenuto in Micelio',
    notInTeam: 'Questo nodo non fa ancora parte di un team.',
    haveInvite: 'Ho un invito',
    createTeam: 'Crea un nuovo team',
    teamName: 'Nome del team',
    inviteCode: "Codice d'invito",
    invitePlaceholder: 'incolla il codice ricevuto',
    pcName: 'Nome di questo PC (visibile ai colleghi)',
    waiting: 'In attesa che un membro del team accolga la richiesta (fino a 2 minuti)…',
    create: 'Crea il team',
    join: 'Entra nel team'
  },
  en: {
    welcome: 'Welcome to Micelio',
    notInTeam: 'This node is not part of a team yet.',
    haveInvite: 'I have an invite',
    createTeam: 'Create a new team',
    teamName: 'Team name',
    inviteCode: 'Invite code',
    invitePlaceholder: 'paste the code you received',
    pcName: 'Name of this PC (visible to your colleagues)',
    waiting: 'Waiting for a team member to accept the request (up to 2 minutes)…',
    create: 'Create the team',
    join: 'Join the team'
  }
})

export function Onboarding () {
  const client = useQueryClient()
  const s = useStrings(S)
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
      <div className='row'><h1 style={{ margin: 0 }}>{s.welcome}</h1><span className='spacer' /><LangSwitch /></div>
      <p className='muted'>{s.notInTeam}</p>
      <Card>
        <div className='row' style={{ marginBottom: 14 }}>
          <button className={`btn ${mode === 'join' ? 'primary' : ''}`} onClick={() => setMode('join')}>{s.haveInvite}</button>
          <button className={`btn ${mode === 'init' ? 'primary' : ''}`} onClick={() => setMode('init')}>{s.createTeam}</button>
        </div>
        <div className='stack'>
          {mode === 'init'
            ? <div><label>{s.teamName}</label><input value={team} onChange={(e) => setTeam(e.target.value)} placeholder='Team Dev' /></div>
            : <div><label>{s.inviteCode}</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder={s.invitePlaceholder} /></div>}
          <div><label>{s.pcName}</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder='pc-mario' /></div>
          <ErrorBox error={init.error ?? join.error} />
          {join.isPending && <div className='notice small'>{s.waiting}</div>}
          <div>
            {mode === 'init'
              ? <button className='btn primary' disabled={busy || !team.trim() || !name.trim()} onClick={() => init.mutate()}>{s.create}</button>
              : <button className='btn primary' disabled={busy || code.trim().length < 10 || !name.trim()} onClick={() => join.mutate()}>{s.join}</button>}
          </div>
        </div>
      </Card>
    </div>
  )
}
