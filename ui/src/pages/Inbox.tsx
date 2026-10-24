/**
 * @file Inbox: i ricordi su cui il filtro privacy non ha potuto decidere da solo (D9, attività 3.6).
 *
 * Per ogni elemento: motivo, scadenza, anteprima. Si può approvare così com'è, correggere
 * titolo e corpo prima di approvare (es. per togliere un dettaglio sensibile), o rifiutare.
 * Approvare significa pubblicare a TUTTO il team: il pulsante lo dice esplicitamente.
 *
 * EN: Inbox: the memories the privacy filter could not decide on by itself (D9, activity 3.6).
 *
 * EN: For each item: reason, expiry, preview. It can be approved as is, title and body can be
 * corrected before approving (e.g. to remove a sensitive detail), or it can be rejected.
 * Approving means publishing to the WHOLE team: the button says so explicitly.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type InboxItem } from '../api/client'
import { currentTeam } from '../api/team'
import { Card, Empty, ErrorBox, Markdown, PageHeader } from '../components/ui'
import { dateTime } from '../format'
import { defineStrings, useStrings } from '../i18n'

const S = defineStrings({
  it: {
    title: 'Inbox',
    subtitle: 'Ricordi in attesa di una tua decisione: solo i casi dubbi. Restano sul tuo PC e scadono dopo 14 giorni.',
    empty: 'Nessun ricordo in attesa. 🎉',
    meta: (source: string, expires: string) => `fonte: ${source} · scade il ${expires}`,
    titleLabel: 'Titolo',
    body: 'Contenuto',
    publishEdited: 'Pubblica la versione corretta',
    publish: 'Pubblica nel team',
    cancelEdit: 'Annulla modifiche',
    edit: 'Correggi',
    reject: 'Scarta',
    keep: 'Tienilo per me',
    keepTitle: 'Non va al team: diventa un ricordo personale, solo su questo PC',
    // 0.6.1: salvataggio trattenuto dal controllo del team / EN: save held by the team check
    held: 'Trattenuto: la cartella della sessione non è di questo team',
    problem: {
      'other-team': (cwd: string, folder: string, session: string) => `La sessione di Claude Code in ${cwd} salvava nel team «${session}», ma quella cartella è abilitata nel team «${folder}». Il ricordo è qui, nel team della cartella, e non è stato pubblicato.`,
      'not-enabled': (cwd: string, _f: string, session: string) => `La sessione di Claude Code in ${cwd} salvava nel team «${session}», ma quella cartella non è abilitata in nessun team. Il ricordo non è stato pubblicato.`,
      'no-folder': (_c: string, _f: string, session: string) => `Una sessione di Claude Code salvava nel team «${session}» senza dire da quale cartella: usa la registrazione MCP vecchia. Il ricordo non è stato pubblicato.`
    },
    solution: {
      'other-team': 'Soluzione: se è il team giusto, pubblicalo qui. Per i prossimi salvataggi, Impostazioni → Claude Code → «Configura», poi chiudi e riapri le sessioni di Claude Code (anche con /resume).',
      'not-enabled': 'Soluzione: abilita la cartella nel team giusto (Impostazioni → Raccolta automatica), poi pubblicalo nel team giusto qui sotto.',
      'no-folder': 'Soluzione: Impostazioni → Claude Code → «Configura», poi chiudi e riapri le sessioni di Claude Code (anche con /resume). Questo ricordo pubblicalo nel team giusto qui sotto.'
    },
    publishTo: 'Pubblica in…',
    publishIn: (team: string) => `Pubblica in «${team}»`
  },
  en: {
    title: 'Inbox',
    subtitle: 'Memories waiting for your decision: only the doubtful cases. They stay on your PC and expire after 14 days.',
    empty: 'Nothing waiting. 🎉',
    meta: (source: string, expires: string) => `source: ${source} · expires on ${expires}`,
    titleLabel: 'Title',
    body: 'Content',
    publishEdited: 'Publish the corrected version',
    publish: 'Publish to the team',
    cancelEdit: 'Discard changes',
    edit: 'Edit',
    reject: 'Discard',
    keep: 'Keep it for me',
    keepTitle: 'It does not go to the team: it becomes a personal memory, only on this PC',
    held: "Held: the session's folder doesn't belong to this team",
    problem: {
      'other-team': (cwd: string, folder: string, session: string) => `The Claude Code session in ${cwd} was saving to the team "${session}", but that folder is enabled in the team "${folder}". The memory is here, in the folder's team, and was not published.`,
      'not-enabled': (cwd: string, _f: string, session: string) => `The Claude Code session in ${cwd} was saving to the team "${session}", but that folder isn't enabled in any team. The memory was not published.`,
      'no-folder': (_c: string, _f: string, session: string) => `A Claude Code session was saving to the team "${session}" without saying which folder it was in: it uses the old MCP registration. The memory was not published.`
    },
    solution: {
      'other-team': 'Fix: if this is the right team, publish it here. For the next saves, Settings → Claude Code → "Configure", then close and reopen your Claude Code sessions (/resume works too).',
      'not-enabled': 'Fix: enable the folder in the right team (Settings → Automatic collection), then publish it to the right team below.',
      'no-folder': 'Fix: Settings → Claude Code → "Configure", then close and reopen your Claude Code sessions (/resume works too). Publish this memory to the right team below.'
    },
    publishTo: 'Publish to…',
    publishIn: (team: string) => `Publish to "${team}"`
  }
})

export function Inbox () {
  const s = useStrings(S)
  const inbox = useQuery({ queryKey: ['inbox'], queryFn: api.inbox })
  return (
    <>
      <PageHeader help='inbox' title={s.title} subtitle={s.subtitle} />
      <ErrorBox error={inbox.error} />
      {inbox.data?.length === 0 && <Card><Empty>{s.empty}</Empty></Card>}
      <div className='stack'>
        {inbox.data?.map((item) => <InboxCard key={item.id} item={item} />)}
      </div>
    </>
  )
}

/** Un elemento dell'inbox, con modalità di modifica. / EN: An Inbox item, with edit mode. */
export function InboxCard ({ item }: { item: InboxItem }) {
  const client = useQueryClient()
  const s = useStrings(S)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.memory.title)
  const [body, setBody] = useState(item.memory.body)

  // Dopo una decisione ricarichiamo inbox e memoria (gli eventi SSE lo farebbero comunque,
  // ma così la UI reagisce subito anche se lo stream è momentaneamente disconnesso).
  // EN: After a decision we reload the Inbox and the memories (SSE events would do it anyway,
  //     but this way the UI reacts right away even if the stream is briefly disconnected).
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['inbox'] })
    void client.invalidateQueries({ queryKey: ['memories'] })
  }
  const approve = useMutation({
    mutationFn: () => api.approve(item.id, editing ? { title, body } : {}),
    onSuccess: refresh
  })
  const reject = useMutation({ mutationFn: () => api.reject(item.id), onSuccess: refresh })
  // B4: né al team né scartato, resta come ricordo personale
  // EN: B4: neither to the team nor discarded, it stays as a personal memory
  const keep = useMutation({ mutationFn: () => api.keepPersonal(item.id), onSuccess: refresh })
  // 0.6.1: «Pubblica in…» un altro team, per i salvataggi trattenuti dal controllo del team
  // EN: 0.6.1: «Pubblica in…» (Publish to…) another team, for saves held by the team check
  const move = useMutation({ mutationFn: (team: string) => api.moveInbox(item.id, team), onSuccess: refresh })
  const check = item.teamCheck
  const teams = useQuery({ queryKey: ['teams'], queryFn: api.teams, enabled: !!check })
  const here = currentTeam() ?? teams.data?.teams.find((t) => t.isDefault)?.id
  const others = (teams.data?.teams ?? []).filter((t) => t.id !== here && t.role)
  const hereName = teams.data?.teams.find((t) => t.id === here)?.name
  const busy = approve.isPending || reject.isPending || keep.isPending || move.isPending

  return (
    <Card>
      <div className='row' style={{ marginBottom: 8 }}>
        <span className='badge warn'>{item.reason}</span>
        <span className='spacer' />
        <span className='muted small'>{s.meta(item.source.type, dateTime(item.expires))}</span>
      </div>
      {check && (
        <div className='notice warn' style={{ marginBottom: 10 }}>
          <strong>{s.held}</strong>
          <p style={{ margin: '6px 0' }}>{s.problem[check.problem](check.cwd ?? '', check.folder?.name ?? '', check.session.name)}</p>
          <p style={{ margin: 0 }}>{s.solution[check.problem]}</p>
        </div>
      )}
      {editing
        ? (
          <div className='stack'>
            <div><label>{s.titleLabel}</label><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div><label>{s.body}</label><textarea value={body} onChange={(e) => setBody(e.target.value)} /></div>
          </div>
          )
        : (
          <>
            <h2>{item.memory.title}</h2>
            <Markdown text={item.memory.body} />
          </>
          )}
      <ErrorBox error={approve.error ?? reject.error ?? keep.error ?? move.error} />
      <div className='row' style={{ marginTop: 12 }}>
        <button className='btn primary' disabled={busy} onClick={() => approve.mutate()}>
          {editing ? s.publishEdited : check && hereName ? s.publishIn(hereName) : s.publish}
        </button>
        {check && others.length > 0 && (
          <select aria-label={s.publishTo} value='' disabled={busy} onChange={(e) => { if (e.target.value) move.mutate(e.target.value) }} style={{ width: 'auto' }}>
            <option value=''>{s.publishTo}</option>
            {others.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.id}</option>)}
          </select>
        )}
        <button className='btn' disabled={busy} onClick={() => setEditing(!editing)}>{editing ? s.cancelEdit : s.edit}</button>
        <span className='spacer' />
        <button className='btn' disabled={busy} title={s.keepTitle} onClick={() => keep.mutate()}>🔒 {s.keep}</button>
        <button className='btn danger' disabled={busy} onClick={() => reject.mutate()}>{s.reject}</button>
      </div>
    </Card>
  )
}
