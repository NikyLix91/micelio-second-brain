/**
 * @file Team: membri (albero degli inviti), inviti, ruoli e impostazioni condivise (attività 3.7).
 *
 * Le azioni da admin (promuovi, espelli, impostazioni di team) sono mostrate solo agli admin;
 * il daemon le verifica comunque (e apply le verifica di nuovo su ogni nodo).
 *
 * Fase 10: l'admin sceglie quanti ricordi distillare al massimo per sessione (`distill.maxMemories`);
 * la scheda "Qualità della distillazione" (visibile a tutti) dà i dati per decidere.
 *
 * B3 (più team sullo stesso PC): la scheda "I tuoi team su questo PC" sceglie il predefinito e
 * toglie un team; accanto ai membri compare in quali ALTRI tuoi team c'è la stessa persona
 * (identità personale, vedi src/core/identity.ts).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type DistillQuality, type MemberRecord } from '../api/client'
import { currentTeam, setCurrentTeam } from '../api/team'
import { Card, ConfirmButton, ErrorBox, PageHeader } from '../components/ui'
import { dateTime, short } from '../format'
import { HelpButton } from '../help'
import { defineStrings, useStrings } from '../i18n'

type Advice = DistillQuality['advice']
const pct = (x: number) => `${Math.round(x * 100)}%`

const S = defineStrings({
  it: {
    title: 'Team',
    subtitle: (name: string, n: number) => `«${name}» · ${n} membri attivi`,
    members: 'Membri',
    treeIntro: 'Albero degli inviti: sotto ogni membro, chi è entrato con un suo invito.',
    you: 'tu',
    removed: 'espulso',
    since: (d: string) => `dal ${d}`,
    promote: 'Promuovi ad admin',
    promoteConfirm: 'Sì, promuovi',
    remove: 'Espelli',
    removeConfirm: 'Sì, espelli',
    invite: 'Invita un collega',
    creating: 'Creazione…',
    createInvite: 'Crea invito',
    copied: 'Copiato ✓',
    copy: 'Copia',
    inviteNote: (until: string) => `Monouso, valido fino al ${until}. Il collega esegue`,
    inviteSecret: 'È un segreto: mandalo solo a lui.',
    notReplicated: "Nessun altro membro online ha ancora ricevuto l'invito: resta online finché il collega non è entrato.",
    pendingInvites: (n: number) => `${n} inviti non ancora usati.`,
    anyoneInvites: 'Qualunque membro può invitare.',
    settings: 'Impostazioni del team (replicate a tutti i nodi)',
    memoryLanguage: 'Lingua dei ricordi distillati',
    italian: 'Italiano',
    english: 'Inglese',
    maxMemories: 'Ricordi massimi per distillazione (1–20)',
    maxMemoriesHint: 'Quanti ricordi al massimo Claude estrae da una sessione o da una parte di documento. Più ricordi = più sapere ma anche più rumore: decidi con i dati della scheda «Qualità della distillazione».',
    keywords: 'Parole che bloccano un contenuto (oltre a quelle di default, separate da virgola)',
    keywordsPlaceholder: 'es. progetto riservato, NDA',
    saveTeam: 'Salva per tutto il team',
    yourTeams: 'I tuoi team su questo PC',
    yourTeamsIntro: 'Ogni team ha un sapere tutto suo. Il predefinito (★) è quello che usano la riga di comando e gli agenti quando non indicano un team; il selettore nella barra laterale cambia solo questa finestra.',
    identity: (name: string, key: string) => `Tu: ${name} · identità ${key}, la stessa in tutti i tuoi team`,
    teamLine: (role: string, members: number, memories: number) => `${role} · ${members} membri · ${memories} ricordi`,
    makeDefault: 'Rendi predefinito',
    leave: 'Togli da questo PC',
    leaveConfirm: 'Sì, cancella i dati locali',
    leaveHint: 'Togliere un team cancella da questo PC il suo log, la ricerca, l\'inbox e le impostazioni. Il team resta sui PC dei colleghi: per rientrare serve un nuovo invito.',
    addTeam: '＋ Aggiungi un team',
    alsoIn: (teams: string) => `stessa persona anche in: ${teams}`,
    syncing: '(in sincronizzazione)',
    quality: 'Qualità della distillazione',
    qualityIntro: (max: number, total: number, at: number, batches: number, rate: string) =>
      `Limite in vigore: ${max} ricordi per distillazione · ${total} ricordi distillati con posizione nota · limite raggiunto in ${at} distillazioni su ${batches} (${rate}). Le percentuali contano i ricordi con più di 3 giorni (prima non hanno avuto il tempo di essere usati).`,
    cols: ['Posizione nel distillato', 'Ricordi', 'Utili', 'Votati inutili', 'Fusi o archiviati', 'Mai usati', 'Punteggio', 'Recenti'],
    bucket: (from: number, to: number) => (from > 10 ? 'oltre la 10ª' : from === to ? `${from}ª` : `${from}ª–${to}ª`),
    beyondLimit: ' (oltre il limite attuale)',
    scoreNote: 'Punteggio = utili − votati inutili − fusi o archiviati (da −1 a +1). Utile = votato positivamente o usato dagli agenti.',
    adviceLabel: { raise: 'Conviene alzare il limite', keep: 'Il limite attuale va bene', lower: 'Conviene abbassare il limite', unknown: 'Dati ancora insufficienti' } as Record<Advice['action'], string>,
    advice: (a: Advice): string => {
      const p = a.params
      const sc = (x?: number) => (x ?? 0).toFixed(2)
      switch (a.code) {
        case 'too-few': return `Servono almeno ${p.minSample} ricordi distillati da più di ${p.minAgeDays} giorni (ora ${p.mature}).`
        case 'tail-small': return `Pochi ricordi nelle ultime posizioni consentite (${p.tailN ?? 0}): servono almeno ${p.minTail} per confrontarle con le prime.`
        case 'lower': return `I ricordi nelle ultime posizioni valgono molto meno dei primi (punteggio ${sc(p.tailScore)} contro ${sc(p.headScore)}; ${pct(p.badShare ?? 0)} votati inutili o rimossi): il limite si può abbassare.`
        case 'raise': return `Le ultime posizioni valgono quasi quanto le prime (punteggio ${sc(p.tailScore)} contro ${sc(p.headScore)}) e il limite viene raggiunto nel ${pct(p.saturationRate)} delle distillazioni: alzarlo dovrebbe portare altro sapere utile.`
        case 'keep-unsaturated': return `Il limite viene raggiunto solo nel ${pct(p.saturationRate)} delle distillazioni: non sta tagliando sapere.`
        case 'keep-balanced': return `Le ultime posizioni valgono un po' meno delle prime (punteggio ${sc(p.tailScore)} contro ${sc(p.headScore)}): il limite attuale è equilibrato.`
        default: return a.reason
      }
    }
  },
  en: {
    title: 'Team',
    subtitle: (name: string, n: number) => `“${name}” · ${n} active members`,
    members: 'Members',
    treeIntro: 'Invitation tree: under each member, who joined with one of their invites.',
    you: 'you',
    removed: 'removed',
    since: (d: string) => `since ${d}`,
    promote: 'Promote to admin',
    promoteConfirm: 'Yes, promote',
    remove: 'Remove',
    removeConfirm: 'Yes, remove',
    invite: 'Invite a colleague',
    creating: 'Creating…',
    createInvite: 'Create invite',
    copied: 'Copied ✓',
    copy: 'Copy',
    inviteNote: (until: string) => `Single use, valid until ${until}. Your colleague runs`,
    inviteSecret: 'It is a secret: send it to them only.',
    notReplicated: 'No other online member has received the invite yet: stay online until your colleague has joined.',
    pendingInvites: (n: number) => `${n} invites not used yet.`,
    anyoneInvites: 'Any member can invite.',
    settings: 'Team settings (replicated to every node)',
    memoryLanguage: 'Language of distilled memories',
    italian: 'Italian',
    english: 'English',
    maxMemories: 'Maximum memories per distillation (1–20)',
    maxMemoriesHint: 'How many memories Claude extracts at most from a session or a part of a document. More memories = more knowledge but also more noise: decide with the data of the “Distillation quality” card.',
    keywords: 'Words that block a content (in addition to the default ones, comma separated)',
    keywordsPlaceholder: 'e.g. confidential project, NDA',
    saveTeam: 'Save for the whole team',
    yourTeams: 'Your teams on this PC',
    yourTeamsIntro: 'Each team has knowledge of its own. The default one (★) is used by the command line and the agents when they do not name a team; the switcher in the sidebar only changes this window.',
    identity: (name: string, key: string) => `You: ${name} · identity ${key}, the same in all your teams`,
    teamLine: (role: string, members: number, memories: number) => `${role} · ${members} members · ${memories} memories`,
    makeDefault: 'Make default',
    leave: 'Remove from this PC',
    leaveConfirm: 'Yes, delete the local data',
    leaveHint: 'Removing a team deletes its log, search index, inbox and settings from this PC. The team stays on your colleagues\' PCs: to come back you need a new invite.',
    addTeam: '＋ Add a team',
    alsoIn: (teams: string) => `same person also in: ${teams}`,
    syncing: '(syncing)',
    quality: 'Distillation quality',
    qualityIntro: (max: number, total: number, at: number, batches: number, rate: string) =>
      `Current limit: ${max} memories per distillation · ${total} distilled memories with a known position · limit reached in ${at} distillations out of ${batches} (${rate}). Percentages count memories older than 3 days (before that they have not had time to be used).`,
    cols: ['Position in the distillation', 'Memories', 'Useful', 'Voted useless', 'Merged or archived', 'Never used', 'Score', 'Recent'],
    bucket: (from: number, to: number) => {
      const ord = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`
      return from > 10 ? 'beyond the 10th' : from === to ? ord(from) : `${ord(from)}–${ord(to)}`
    },
    beyondLimit: ' (beyond the current limit)',
    scoreNote: 'Score = useful − voted useless − merged or archived (from −1 to +1). Useful = voted up or used by the agents.',
    adviceLabel: { raise: 'Raising the limit is worthwhile', keep: 'The current limit is fine', lower: 'Lowering the limit is worthwhile', unknown: 'Not enough data yet' } as Record<Advice['action'], string>,
    advice: (a: Advice): string => {
      const p = a.params
      const sc = (x?: number) => (x ?? 0).toFixed(2)
      switch (a.code) {
        case 'too-few': return `At least ${p.minSample} memories distilled more than ${p.minAgeDays} days ago are needed (now ${p.mature}).`
        case 'tail-small': return `Few memories in the last allowed positions (${p.tailN ?? 0}): at least ${p.minTail} are needed to compare them with the first ones.`
        case 'lower': return `Memories in the last positions are worth much less than the first ones (score ${sc(p.tailScore)} versus ${sc(p.headScore)}; ${pct(p.badShare ?? 0)} voted useless or removed): the limit can be lowered.`
        case 'raise': return `The last positions are worth almost as much as the first ones (score ${sc(p.tailScore)} versus ${sc(p.headScore)}) and the limit is reached in ${pct(p.saturationRate)} of distillations: raising it should bring more useful knowledge.`
        case 'keep-unsaturated': return `The limit is reached only in ${pct(p.saturationRate)} of distillations: it is not cutting knowledge.`
        case 'keep-balanced': return `The last positions are worth a little less than the first ones (score ${sc(p.tailScore)} versus ${sc(p.headScore)}): the current limit is balanced.`
        default: return a.reason
      }
    }
  }
})

export function Team () {
  const s = useStrings(S)
  const status = useQuery({ queryKey: ['status'], queryFn: api.status })
  const members = useQuery({ queryKey: ['members'], queryFn: api.members })
  const isAdmin = status.data?.role === 'admin'
  const others = usePersonTeams()

  return (
    <>
      <PageHeader help='team' title={s.title} subtitle={status.data?.team ? s.subtitle(status.data.team.name, status.data.members) : undefined} />
      <div className='stack'>
        <YourTeamsCard />
        <InviteCard />
        <Card help='team#members' title={s.members}>
          <p className='muted small' style={{ marginTop: 0 }}>{s.treeIntro}</p>
          <ErrorBox error={members.error} />
          {members.data && <MemberTree members={members.data} parent={null} me={status.data?.nodeKey ?? null} isAdmin={isAdmin} others={others} />}
        </Card>
        {isAdmin && <TeamSettings />}
        <DistillQualityCard />
      </div>
    </>
  )
}

/**
 * Team del PC diversi da quello mostrato, e dove compare ogni persona: chiave pubblica della
 * persona → nomi degli altri team in cui è membro attivo. Serve a riconoscere la stessa persona
 * in più team (e a distinguere due colleghi con lo stesso nome).
 */
function usePersonTeams (): Map<string, string[]> {
  const teams = useQuery({ queryKey: ['teams'], queryFn: api.teams })
  const list = teams.data?.teams ?? []
  const shownId = (list.find((t) => t.id === currentTeam()) ?? list.find((t) => t.isDefault))?.id
  const others = list.filter((t) => t.id !== shownId)
  const q = useQuery({
    queryKey: ['members', 'otherTeams', others.map((t) => t.id).join(',')],
    enabled: others.length > 0,
    queryFn: async () => {
      const map = new Map<string, string[]>()
      for (const t of others) {
        for (const m of await api.membersOf(t.id).catch(() => [])) {
          if (!m.person || m.removed) continue
          map.set(m.person, [...(map.get(m.person) ?? []), t.name ?? t.id])
        }
      }
      return map
    }
  })
  return q.data ?? new Map()
}

/** I team di questo PC: predefinito, uscita, identità personale (B3). */
function YourTeamsCard () {
  const s = useStrings(S)
  const client = useQueryClient()
  const teams = useQuery({ queryKey: ['teams'], queryFn: api.teams })
  const refresh = () => { void client.invalidateQueries({ queryKey: ['teams'] }) }
  const makeDefault = useMutation({ mutationFn: (id: string) => api.setDefaultTeam(id), onSuccess: refresh })
  const leave = useMutation({
    mutationFn: (id: string) => api.leaveTeam(id),
    onSuccess: (_r, id) => {
      // Se era il team mostrato, l'interfaccia torna al predefinito
      if (currentTeam() === id) setCurrentTeam(null)
      void client.resetQueries()
    }
  })
  const d = teams.data
  if (!d) return <Card title={s.yourTeams}><ErrorBox error={teams.error} /></Card>
  return (
    <Card help='teams' title={s.yourTeams} actions={<Link className='btn' to='/team/nuovo'>{s.addTeam}</Link>}>
      <p className='muted small' style={{ marginTop: 0 }}>{s.yourTeamsIntro}</p>
      <div className='team-list'>
        {d.teams.map((t) => (
          <div key={t.id} className='team-row'>
            <span title={t.isDefault ? 'default' : undefined}>{t.isDefault ? '★' : '☆'}</span>
            <strong>{t.name ?? s.syncing}</strong>
            <span className='mono muted small'>{t.id}</span>
            <span className='muted small'>{s.teamLine(t.role ?? '-', t.members, t.memories)}</span>
            <span className='spacer' />
            {!t.isDefault && <button className='btn small' disabled={makeDefault.isPending} onClick={() => makeDefault.mutate(t.id)}>{s.makeDefault}</button>}
            <ConfirmButton label={s.leave} confirmLabel={s.leaveConfirm} danger onConfirm={() => leave.mutate(t.id)} />
          </div>
        ))}
      </div>
      <p className='muted small'>{s.leaveHint}</p>
      {d.identity && <p className='small' style={{ marginBottom: 0 }}>{s.identity(d.identity.name, short(d.identity.publicKey))} <HelpButton topic='teams#identity' /></p>}
      <ErrorBox error={makeDefault.error ?? leave.error} />
    </Card>
  )
}

/** Albero ricorsivo: i figli di un membro sono quelli entrati con un suo invito. */
function MemberTree ({ members, parent, me, isAdmin, others }: { members: MemberRecord[], parent: string | null, me: string | null, isAdmin: boolean, others: Map<string, string[]> }) {
  const children = members.filter((m) => m.invitedBy === parent).sort((a, b) => a.joinedAt - b.joinedAt)
  if (children.length === 0) return null
  return (
    <ul className={`tree ${parent === null ? 'root' : ''}`}>
      {children.map((m) => (
        <li key={m.key}>
          <MemberRow member={m} me={me} isAdmin={isAdmin} alsoIn={m.person ? others.get(m.person) : undefined} />
          <MemberTree members={members} parent={m.key} me={me} isAdmin={isAdmin} others={others} />
        </li>
      ))}
    </ul>
  )
}

function MemberRow ({ member: m, me, isAdmin, alsoIn }: { member: MemberRecord, me: string | null, isAdmin: boolean, alsoIn?: string[] }) {
  const s = useStrings(S)
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
        {m.key === me && <span className='badge'>{s.you}</span>}
        {m.removed && <span className='badge danger'>{s.removed}</span>}
        {alsoIn?.length ? <span className='person-chip'>{s.alsoIn(alsoIn.join(', '))}</span> : null}
        <span className='muted small'>{s.since(dateTime(m.joinedAt))}</span>
        <span className='spacer' />
        {canAct && m.role !== 'admin' && <ConfirmButton label={s.promote} confirmLabel={s.promoteConfirm} onConfirm={() => promote.mutate()} />}
        {canAct && <ConfirmButton label={s.remove} confirmLabel={s.removeConfirm} danger onConfirm={() => remove.mutate()} />}
      </div>
      <ErrorBox error={promote.error ?? remove.error} />
    </div>
  )
}

/** Creazione di un invito: mostra il codice da copiare e l'avviso se non è ancora replicato. */
function InviteCard () {
  const s = useStrings(S)
  const invites = useQuery({ queryKey: ['invites'], queryFn: api.invites })
  const create = useMutation({ mutationFn: api.invite })
  const [copied, setCopied] = useState(false)
  const r = create.data

  return (
    <Card help='team#invites'
      title={s.invite}
      actions={<button className='btn primary' disabled={create.isPending} onClick={() => { setCopied(false); create.mutate() }}>{create.isPending ? s.creating : s.createInvite}</button>}
    >
      <ErrorBox error={create.error} />
      {r
        ? (
          <div className='stack'>
            <div className='row'>
              <code className='mono' style={{ overflowWrap: 'anywhere', flex: 1 }}>{r.code}</code>
              <button className='btn small' onClick={() => { void navigator.clipboard.writeText(r.code); setCopied(true) }}>{copied ? s.copied : s.copy}</button>
            </div>
            <div className='muted small'>
              {s.inviteNote(dateTime(r.expires))} <code>micelio join &lt;code&gt; --name &lt;pc-name&gt;</code>. {s.inviteSecret}
            </div>
            {!r.replicated && <div className='notice warn small'>{s.notReplicated}</div>}
          </div>
          )
        : <p className='muted' style={{ margin: 0 }}>{invites.data?.length ? s.pendingInvites(invites.data.length) : s.anyoneInvites}</p>}
    </Card>
  )
}

/** Impostazioni condivise del team (solo admin): lingua dei ricordi, limite di distillazione, parole chiave. */
function TeamSettings () {
  const s = useStrings(S)
  const cfg = useQuery({ queryKey: ['teamConfig'], queryFn: api.teamConfig })
  const [language, setLanguage] = useState<string | null>(null)
  const [keywords, setKeywords] = useState<string | null>(null)
  const [maxMemories, setMaxMemories] = useState<string | null>(null)
  const client = useQueryClient()
  const save = useMutation({
    mutationFn: async () => {
      if (language !== null) await api.setTeamConfig('memory.language', language)
      if (keywords !== null) await api.setTeamConfig('filter.blockKeywords', keywords.split(',').map((k) => k.trim()).filter(Boolean))
      if (maxMemories !== null) await api.setTeamConfig('distill.maxMemories', Number(maxMemories))
    },
    onSuccess: () => {
      setLanguage(null); setKeywords(null); setMaxMemories(null)
      void client.invalidateQueries({ queryKey: ['teamConfig'] })
      void client.invalidateQueries({ queryKey: ['distillQuality'] })
    }
  })
  if (!cfg.data) return null

  return (
    <Card help='team#shared-settings' title={s.settings}>
      <div className='stack'>
        <div style={{ maxWidth: 240 }}>
          <label>{s.memoryLanguage}</label>
          <select value={language ?? cfg.data.language} onChange={(e) => setLanguage(e.target.value)}>
            <option value='it'>{s.italian}</option>
            <option value='en'>{s.english}</option>
          </select>
        </div>
        <div style={{ maxWidth: 420 }}>
          <label>{s.maxMemories}</label>
          <input type='number' min={1} max={20} value={maxMemories ?? String(cfg.data.maxMemories)} onChange={(e) => setMaxMemories(e.target.value)} />
          <div className='muted small'>{s.maxMemoriesHint}</div>
        </div>
        <div>
          <label>{s.keywords}</label>
          <input value={keywords ?? cfg.data.blockKeywords.join(', ')} onChange={(e) => setKeywords(e.target.value)} placeholder={s.keywordsPlaceholder} />
        </div>
        <ErrorBox error={save.error} />
        <div><button className='btn primary' disabled={save.isPending || (language === null && keywords === null && maxMemories === null)} onClick={() => save.mutate()}>{s.saveTeam}</button></div>
      </div>
    </Card>
  )
}

/** Stile dell'indicazione sul limite. */
const ADVICE_CLASS: Record<Advice['action'], string> = { raise: 'ok', keep: '', lower: 'warn', unknown: '' }

/**
 * Qualità della distillazione (Fase 10): per ogni fascia di posizione nel distillato, quanti
 * ricordi si sono rivelati utili, inutili, fusi/archiviati o mai usati; quanto spesso il limite
 * viene raggiunto; e un'indicazione per l'admin. Gli stessi dati su ogni PC del team.
 */
export function DistillQualityCard () {
  const s = useStrings(S)
  const q = useQuery({ queryKey: ['distillQuality'], queryFn: api.distillQuality })
  const d = q.data
  if (!d) return <Card help='quality' title={s.quality}><ErrorBox error={q.error} /></Card>
  return (
    <Card help='quality#metrics' title={s.quality}>
      <p className='muted small' style={{ marginTop: 0 }}>{s.qualityIntro(d.maxMemories, d.total, d.saturation.atLimit, d.saturation.batches, pct(d.saturation.rate))}</p>
      <table className='small'>
        <thead>
          <tr>{s.cols.map((c, i) => <th key={c} className={i > 0 ? 'num' : undefined}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {d.buckets.map((b) => (
            <tr key={b.from} className={b.from > d.maxMemories ? 'muted' : ''}>
              <td>{s.bucket(b.from, b.to)}{b.from > d.maxMemories ? s.beyondLimit : ''}</td>
              <td className='num'>{b.n}</td>
              <td className='num'>{b.n ? pct(b.useful) : '–'}</td>
              <td className='num'>{b.n ? pct(b.notUseful) : '–'}</td>
              <td className='num'>{b.n ? pct(b.removed) : '–'}</td>
              <td className='num'>{b.n ? pct(b.unused) : '–'}</td>
              <td className='num'><strong>{b.n ? b.score.toFixed(2) : '–'}</strong></td>
              <td className='num muted'>{b.young}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={`notice ${ADVICE_CLASS[d.advice.action]}`} style={{ marginTop: 10 }}>
        <strong>{s.adviceLabel[d.advice.action]}.</strong> {s.advice(d.advice)}
      </div>
      <p className='muted small' style={{ marginBottom: 0 }}>{s.scoreNote}</p>
    </Card>
  )
}
