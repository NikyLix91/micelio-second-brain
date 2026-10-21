/**
 * @file Creare un team o entrarci con un invito. Due usi:
 * - primo avvio: il PC non fa ancora parte di nessun team (al posto di tutta l'app);
 * - "Aggiungi un team" (B3, rotta /team/nuovo): un altro team accanto a quelli che ci sono già,
 *   con sapere separato. Il tuo nome è già noto (identità personale): si può cambiare solo per
 *   il nuovo team.
 * Tre strade, come in CLI: creare un team (`micelio init`), entrarci con un invito (`micelio join`)
 * o ripristinarne uno da un backup (B7, `micelio backup restore --new-team`).
 *
 * EN: Create a team or join one with an invite. Two uses:
 * - first start: the PC is not part of any team yet (instead of the whole app);
 * - "Add a team" (B3, route /team/nuovo): another team next to the existing ones,
 *   with separate knowledge. Your name is already known (personal identity): you can change it
 *   only for the new team.
 * Three ways, as in the CLI: create a team (`micelio init`), join with an invite (`micelio join`)
 * or restore one from a backup (B7, `micelio backup restore --new-team`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { setCurrentTeam } from '../api/team'
import { RestoreBackup } from '../components/Backup'
import { Card, ErrorBox, PageHeader } from '../components/ui'
import { HelpButton } from '../help'
import { defineStrings, LangSwitch, useStrings } from '../i18n'

const S = defineStrings({
  it: {
    welcome: 'Benvenuto in Micelio',
    notInTeam: 'Questo nodo non fa ancora parte di un team.',
    addTitle: 'Aggiungi un team',
    addSubtitle: 'Il nuovo team avrà un sapere tutto suo, separato da quello degli altri team di questo PC: chiavi, log, ricerca e cartelle diversi.',
    haveInvite: 'Ho un invito',
    createTeam: 'Crea un nuovo team',
    fromBackup: 'Ripristina da un backup',
    teamName: 'Nome del team',
    inviteCode: "Codice d'invito",
    invitePlaceholder: 'incolla il codice ricevuto',
    pcName: 'Il tuo nome (visibile ai colleghi)',
    pcNameKnown: (n: string) => `Il tuo nome nel nuovo team (vuoto = «${n}», come negli altri team)`,
    waiting: 'In attesa che un membro del team accolga la richiesta (fino a 2 minuti)…',
    create: 'Crea il team',
    join: 'Entra nel team',
    solo: 'Solo per me, senza rete',
    soloHint: 'Il PC non si collega a nessuno finché non scegli una rete (Impostazioni → Rete). Puoi invitare colleghi più avanti.'
  },
  en: {
    welcome: 'Welcome to Micelio',
    notInTeam: 'This node is not part of a team yet.',
    addTitle: 'Add a team',
    addSubtitle: 'The new team will have knowledge of its own, separate from the other teams on this PC: different keys, log, search and folders.',
    haveInvite: 'I have an invite',
    createTeam: 'Create a new team',
    fromBackup: 'Restore from a backup',
    teamName: 'Team name',
    inviteCode: 'Invite code',
    invitePlaceholder: 'paste the code you received',
    pcName: 'Your name (visible to your colleagues)',
    pcNameKnown: (n: string) => `Your name in the new team (empty = "${n}", as in the other teams)`,
    waiting: 'Waiting for a team member to accept the request (up to 2 minutes)…',
    create: 'Create the team',
    join: 'Join the team',
    solo: 'Just for me, no network',
    soloHint: 'The PC connects to nobody until you choose a network (Settings → Network). You can invite colleagues later.'
  }
})

/**
 * @param adding true = "Aggiungi un team" dentro l'app; false = primo avvio
 *        EN: true = "Add a team" inside the app; false = first start
 * @param onDone chiamata dopo l'ingresso nel nuovo team (es. per tornare alla home)
 *        EN: called after joining the new team (e.g. to go back to the home)
 */
export function Onboarding ({ adding = false, onDone }: { adding?: boolean, onDone?: () => void }) {
  const client = useQueryClient()
  const s = useStrings(S)
  // Identità personale: dal secondo team il nome è già noto
  // EN: Personal identity: from the second team on, the name is already known
  const teams = useQuery({ queryKey: ['teams'], queryFn: api.teams })
  const known = teams.data?.identity?.name ?? null
  const [mode, setMode] = useState<'join' | 'init' | 'restore'>('join')
  const [team, setTeam] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  // B4: team solo per sé, senza rete (modalità solo locale)
  // EN: B4: a team just for yourself, with no network (local-only mode)
  const [solo, setSolo] = useState(false)
  const done = (r: { teamId: string }) => {
    // L'interfaccia passa subito al nuovo team
    // EN: The interface switches to the new team right away
    setCurrentTeam(r.teamId)
    void client.resetQueries()
    onDone?.()
  }
  const init = useMutation({ mutationFn: () => api.init(team.trim(), name.trim(), solo ? 'local' : undefined), onSuccess: done })
  const join = useMutation({ mutationFn: () => api.join(code.trim(), name.trim()), onSuccess: done })
  const busy = init.isPending || join.isPending
  const nameOk = !!name.trim() || !!known

  const form = (
    <Card help='teams#add'>
      <div className='row' style={{ marginBottom: 14 }}>
        <button className={`btn ${mode === 'join' ? 'primary' : ''}`} onClick={() => setMode('join')}>{s.haveInvite}</button>
        <button className={`btn ${mode === 'init' ? 'primary' : ''}`} onClick={() => setMode('init')}>{s.createTeam}</button>
        <button className={`btn ${mode === 'restore' ? 'primary' : ''}`} onClick={() => setMode('restore')}>{s.fromBackup}</button>
      </div>
      <div className='stack'>
        {mode === 'restore'
          ? null
          : mode === 'init'
          ? <div><label>{s.teamName}</label><input value={team} onChange={(e) => setTeam(e.target.value)} placeholder='Team Dev' /></div>
          : <div><label>{s.inviteCode}</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder={s.invitePlaceholder} /></div>}
        <div>
          <label>{known ? s.pcNameKnown(known) : s.pcName}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={known ?? 'pc-mario'} />
        </div>
        {mode !== 'join' && (
          <div>
            <label className='row' style={{ margin: 0 }}>
              <input type='checkbox' checked={solo} onChange={(e) => setSolo(e.target.checked)} /> {s.solo} <HelpButton topic='solo#local' />
            </label>
            <div className='muted small'>{s.soloHint}</div>
          </div>
        )}
        {/* Ripristino (B7): nome e rete scelti qui sopra; si entra nel team appena è pronto / EN: Restore (B7): name and network chosen above; you enter the team as soon as it is ready */}
        {mode === 'restore' && (nameOk
          ? <RestoreBackup newTeamOnly nodeName={name} network={solo ? 'local' : undefined} onNewTeam={(id) => done({ teamId: id })} />
          : <div className='muted small'>{known ? s.pcNameKnown(known) : s.pcName}</div>)}
        <ErrorBox error={init.error ?? join.error} />
        {join.isPending && <div className='notice small'>{s.waiting}</div>}
        <div>
          {mode === 'restore'
            ? null
            : mode === 'init'
            ? <button className='btn primary' disabled={busy || !team.trim() || !nameOk} onClick={() => init.mutate()}>{s.create}</button>
            : <button className='btn primary' disabled={busy || code.trim().length < 10 || !nameOk} onClick={() => join.mutate()}>{s.join}</button>}
        </div>
      </div>
    </Card>
  )

  if (adding) {
    return (
      <>
        <PageHeader title={s.addTitle} subtitle={s.addSubtitle} help='teams' />
        <div style={{ maxWidth: 560 }}>{form}</div>
      </>
    )
  }
  return (
    <div className='centered'>
      <div className='row'><h1 style={{ margin: 0 }}>{s.welcome}</h1><span className='spacer' /><LangSwitch /></div>
      <p className='muted'>{s.notInTeam}</p>
      {form}
    </div>
  )
}
