/**
 * @file Team: membri (albero degli inviti), inviti, ruoli e impostazioni condivise (attività 3.7).
 *
 * Le azioni da admin (promuovi, espelli, impostazioni di team) sono mostrate solo agli admin;
 * il daemon le verifica comunque (e apply le verifica di nuovo su ogni nodo).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type MemberRecord } from '../api/client'
import { Card, ConfirmButton, ErrorBox, PageHeader } from '../components/ui'
import { dateTime, short } from '../format'

export function Team () {
  const status = useQuery({ queryKey: ['status'], queryFn: api.status })
  const members = useQuery({ queryKey: ['members'], queryFn: api.members })
  const isAdmin = status.data?.role === 'admin'

  return (
    <>
      <PageHeader title='Team' subtitle={status.data?.team ? `«${status.data.team.name}» · ${status.data.members} membri attivi` : undefined} />
      <div className='stack'>
        <InviteCard />
        <Card title='Membri'>
          <p className='muted small' style={{ marginTop: 0 }}>Albero degli inviti: sotto ogni membro, chi è entrato con un suo invito.</p>
          <ErrorBox error={members.error} />
          {members.data && <MemberTree members={members.data} parent={null} me={status.data?.nodeKey ?? null} isAdmin={isAdmin} />}
        </Card>
        {isAdmin && <TeamSettings />}
      </div>
    </>
  )
}

/** Albero ricorsivo: i figli di un membro sono quelli entrati con un suo invito. */
function MemberTree ({ members, parent, me, isAdmin }: { members: MemberRecord[], parent: string | null, me: string | null, isAdmin: boolean }) {
  const children = members.filter((m) => m.invitedBy === parent).sort((a, b) => a.joinedAt - b.joinedAt)
  if (children.length === 0) return null
  return (
    <ul className={`tree ${parent === null ? 'root' : ''}`}>
      {children.map((m) => (
        <li key={m.key}>
          <MemberRow member={m} me={me} isAdmin={isAdmin} />
          <MemberTree members={members} parent={m.key} me={me} isAdmin={isAdmin} />
        </li>
      ))}
    </ul>
  )
}

function MemberRow ({ member: m, me, isAdmin }: { member: MemberRecord, me: string | null, isAdmin: boolean }) {
  const client = useQueryClient()
  const done = () => { void client.invalidateQueries({ queryKey: ['members'] }); void client.invalidateQueries({ queryKey: ['status'] }) }
  const promote = useMutation({ mutationFn: () => api.promoteMember(m.key), onSuccess: done })
  const remove = useMutation({ mutationFn: () => api.removeMember(m.key), onSuccess: done })
  const canAct = isAdmin && !m.removed && m.key !== me

  return (
    <div>
      <div className='row'>
        <strong style={{ textDecoration: m.removed ? 'line-through' : undefined }}>{m.name}</strong>
        <span className='mono muted small'>{short(m.key)}</span>
        {m.role === 'admin' && <span className='badge accent'>admin</span>}
        {m.key === me && <span className='badge'>tu</span>}
        {m.removed && <span className='badge danger'>espulso</span>}
        <span className='muted small'>dal {dateTime(m.joinedAt)}</span>
        <span className='spacer' />
        {canAct && m.role !== 'admin' && <ConfirmButton label='Promuovi ad admin' confirmLabel='Sì, promuovi' onConfirm={() => promote.mutate()} />}
        {canAct && <ConfirmButton label='Espelli' confirmLabel='Sì, espelli' danger onConfirm={() => remove.mutate()} />}
      </div>
      <ErrorBox error={promote.error ?? remove.error} />
    </div>
  )
}

/** Creazione di un invito: mostra il codice da copiare e l'avviso se non è ancora replicato. */
function InviteCard () {
  const invites = useQuery({ queryKey: ['invites'], queryFn: api.invites })
  const create = useMutation({ mutationFn: api.invite })
  const [copied, setCopied] = useState(false)
  const r = create.data

  return (
    <Card
      title='Invita un collega'
      actions={<button className='btn primary' disabled={create.isPending} onClick={() => { setCopied(false); create.mutate() }}>{create.isPending ? 'Creazione…' : 'Crea invito'}</button>}
    >
      <ErrorBox error={create.error} />
      {r
        ? (
          <div className='stack'>
            <div className='row'>
              <code className='mono' style={{ overflowWrap: 'anywhere', flex: 1 }}>{r.code}</code>
              <button className='btn small' onClick={() => { void navigator.clipboard.writeText(r.code); setCopied(true) }}>{copied ? 'Copiato ✓' : 'Copia'}</button>
            </div>
            <div className='muted small'>
              Monouso, valido fino al {dateTime(r.expires)}. Il collega esegue <code>micelio join &lt;codice&gt; --name &lt;nome-pc&gt;</code>. È un segreto: mandalo solo a lui.
            </div>
            {!r.replicated && <div className='notice warn small'>Nessun altro membro online ha ancora ricevuto l'invito: resta online finché il collega non è entrato.</div>}
          </div>
          )
        : <p className='muted' style={{ margin: 0 }}>{invites.data?.length ? `${invites.data.length} inviti non ancora usati.` : 'Qualunque membro può invitare.'}</p>}
    </Card>
  )
}

/** Impostazioni condivise del team (solo admin): lingua dei ricordi e parole chiave del filtro. */
function TeamSettings () {
  const cfg = useQuery({ queryKey: ['teamConfig'], queryFn: api.teamConfig })
  const [language, setLanguage] = useState<string | null>(null)
  const [keywords, setKeywords] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: async () => {
      if (language !== null) await api.setTeamConfig('memory.language', language)
      if (keywords !== null) await api.setTeamConfig('filter.blockKeywords', keywords.split(',').map((k) => k.trim()).filter(Boolean))
    },
    onSuccess: () => { setLanguage(null); setKeywords(null) }
  })
  if (!cfg.data) return null

  return (
    <Card title='Impostazioni del team (replicate a tutti i nodi)'>
      <div className='stack'>
        <div style={{ maxWidth: 240 }}>
          <label>Lingua dei ricordi distillati</label>
          <select value={language ?? cfg.data.language} onChange={(e) => setLanguage(e.target.value)}>
            <option value='it'>Italiano</option>
            <option value='en'>Inglese</option>
          </select>
        </div>
        <div>
          <label>Parole che bloccano un contenuto (oltre a quelle di default, separate da virgola)</label>
          <input value={keywords ?? cfg.data.blockKeywords.join(', ')} onChange={(e) => setKeywords(e.target.value)} placeholder='es. progetto riservato, NDA' />
        </div>
        <ErrorBox error={save.error} />
        <div><button className='btn primary' disabled={save.isPending || (language === null && keywords === null)} onClick={() => save.mutate()}>Salva per tutto il team</button></div>
      </div>
    </Card>
  )
}
