/**
 * @file Inbox: i ricordi su cui il filtro privacy non ha potuto decidere da solo (D9, attività 3.6).
 *
 * Per ogni elemento: motivo, scadenza, anteprima. Si può approvare così com'è, correggere
 * titolo e corpo prima di approvare (es. per togliere un dettaglio sensibile), o rifiutare.
 * Approvare significa pubblicare a TUTTO il team: il pulsante lo dice esplicitamente.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type InboxItem } from '../api/client'
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
    keepTitle: 'Non va al team: diventa un ricordo personale, solo su questo PC'
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
    keepTitle: 'It does not go to the team: it becomes a personal memory, only on this PC'
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

/** Un elemento dell'inbox, con modalità di modifica. */
export function InboxCard ({ item }: { item: InboxItem }) {
  const client = useQueryClient()
  const s = useStrings(S)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.memory.title)
  const [body, setBody] = useState(item.memory.body)

  // Dopo una decisione ricarichiamo inbox e memoria (gli eventi SSE lo farebbero comunque,
  // ma così la UI reagisce subito anche se lo stream è momentaneamente disconnesso).
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
  const keep = useMutation({ mutationFn: () => api.keepPersonal(item.id), onSuccess: refresh })
  const busy = approve.isPending || reject.isPending || keep.isPending

  return (
    <Card>
      <div className='row' style={{ marginBottom: 8 }}>
        <span className='badge warn'>{item.reason}</span>
        <span className='spacer' />
        <span className='muted small'>{s.meta(item.source.type, dateTime(item.expires))}</span>
      </div>
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
      <ErrorBox error={approve.error ?? reject.error ?? keep.error} />
      <div className='row' style={{ marginTop: 12 }}>
        <button className='btn primary' disabled={busy} onClick={() => approve.mutate()}>
          {editing ? s.publishEdited : s.publish}
        </button>
        <button className='btn' disabled={busy} onClick={() => setEditing(!editing)}>{editing ? s.cancelEdit : s.edit}</button>
        <span className='spacer' />
        <button className='btn' disabled={busy} title={s.keepTitle} onClick={() => keep.mutate()}>🔒 {s.keep}</button>
        <button className='btn danger' disabled={busy} onClick={() => reject.mutate()}>{s.reject}</button>
      </div>
    </Card>
  )
}
