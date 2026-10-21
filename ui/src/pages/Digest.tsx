/**
 * @file Riepilogo (B4): cosa ha imparato il team negli ultimi giorni e cosa ancora non sa.
 *
 * EN: Digest (B4): what the team learned in the last few days and what it still doesn't know.
 *
 * - **La settimana del team**: ricordi nuovi per tipo e autore, Radici nuove e da rivedere, più
 *   usati, sogni, ricordi con il codice cambiato (src/insight/digest.ts). Il lunedì l'app desktop
 *   lo segnala con una notifica.
 * - **Lacune del team**: domande segnalate a cui la memoria non sa rispondere; chi scrive il
 *   ricordo che le colma le chiude (src/insight/gaps.ts).
 * - **Le tue ricerche senza risposta**: solo su questo PC; si segnalano al team o si ignorano.
 *
 * EN:
 * - **The team's week**: new memories by kind and author, new Roots and Roots to review, most
 *   used, dreams, memories whose code changed (src/insight/digest.ts). On Mondays the desktop app
 *   announces it with a notification.
 * - **Team knowledge gaps**: reported questions the memory can't answer; whoever writes the
 *   memory that fills one closes it (src/insight/gaps.ts).
 * - **Your searches with no answer**: only on this PC; you report them to the team or ignore them.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type Digest as DigestData, type GapView, type MyGap } from '../api/client'
import { Card, Empty, ErrorBox, PageHeader } from '../components/ui'
import { dateTime, KIND_LABEL, ROOT_CATEGORY_LABEL } from '../format'
import { defineStrings, useStrings } from '../i18n'

const S = defineStrings({
  it: {
    title: 'Riepilogo',
    subtitle: 'Cosa ha imparato il team negli ultimi giorni e cosa ancora non sa.',
    days: (n: number) => `Ultimi ${n} giorni`,
    week: 'La settimana del team',
    period: (from: string, to: string) => `Dal ${from} al ${to}`,
    added: (n: number) => (n === 1 ? '1 ricordo nuovo' : `${n} ricordi nuovi`),
    by: 'da',
    latest: 'Gli ultimi arrivati',
    newRoots: 'Nuove Radici',
    toReview: 'Radici da rivedere',
    mostUsed: 'I più usati',
    uses: (n: string) => `${n} usi`,
    other: (misses: number, dreams: number, stale: number) => `Tue ricerche senza risposta: ${misses} · sogni: ${dreams} · ricordi con codice cambiato: ${stale}`,
    lastDream: 'Ultimo sogno:',
    nothing: 'Nessuna novità in questo periodo.',
    teamGaps: 'Lacune del team',
    teamGapsIntro: 'Domande a cui la memoria del team non sa rispondere. Se conosci la risposta, scrivi il ricordo (Memoria → Nuovo ricordo) e chiudi la lacuna.',
    noTeamGaps: 'Nessuna lacuna segnalata.',
    askers: (names: string) => `chiesto da ${names}`,
    maybe: 'Forse colmata da:',
    closeWith: 'Chiudi con questo ricordo',
    close: 'Chiudi',
    closed: 'chiusa',
    ask: 'Segnala una domanda al team',
    askPlaceholder: 'es. Come si fa il rollback del database ordini?',
    send: 'Segnala',
    mine: 'Le tue ricerche senza risposta',
    mineIntro: 'Solo su questo PC: le ricerche (tue o dei tuoi agenti) che non hanno trovato nulla. Segnalale al team se pensi che qualcuno sappia la risposta.',
    noMine: 'Nessuna ricerca senza risposta.',
    times: (n: number) => (n === 1 ? '1 volta' : `${n} volte`),
    report: 'Segnala al team',
    dismiss: 'Ignora'
  },
  en: {
    title: 'Digest',
    subtitle: 'What the team learned in the last days, and what it does not know yet.',
    days: (n: number) => `Last ${n} days`,
    week: 'The team\'s week',
    period: (from: string, to: string) => `From ${from} to ${to}`,
    added: (n: number) => (n === 1 ? '1 new memory' : `${n} new memories`),
    by: 'by',
    latest: 'Latest arrivals',
    newRoots: 'New Roots',
    toReview: 'Roots to review',
    mostUsed: 'Most used',
    uses: (n: string) => `${n} uses`,
    other: (misses: number, dreams: number, stale: number) => `Your searches with no answer: ${misses} · dreams: ${dreams} · memories with changed code: ${stale}`,
    lastDream: 'Last dream:',
    nothing: 'Nothing new in this period.',
    teamGaps: 'Team gaps',
    teamGapsIntro: 'Questions the team memory cannot answer. If you know the answer, write the memory (Memory → New memory) and close the gap.',
    noTeamGaps: 'No gap reported.',
    askers: (names: string) => `asked by ${names}`,
    maybe: 'Maybe filled by:',
    closeWith: 'Close with this memory',
    close: 'Close',
    closed: 'closed',
    ask: 'Report a question to the team',
    askPlaceholder: 'e.g. How do we roll back the orders database?',
    send: 'Report',
    mine: 'Your searches with no answer',
    mineIntro: 'Only on this PC: the searches (yours or your agents\') that found nothing. Report them to the team if you think someone knows the answer.',
    noMine: 'No search without an answer.',
    times: (n: number) => (n === 1 ? 'once' : `${n} times`),
    report: 'Report to the team',
    dismiss: 'Ignore'
  }
})

export function Digest () {
  const s = useStrings(S)
  return (
    <>
      <PageHeader help='digest' title={s.title} subtitle={s.subtitle} />
      <div className='stack'>
        <WeekCard />
        <TeamGapsCard />
        <MyGapsCard />
      </div>
    </>
  )
}

/** Voci compatte del riepilogo. / EN: Compact digest entries. */
function Items ({ items, detail }: { items: { id: string, title: string, detail?: string }[], detail?: (d: string) => string }) {
  return (
    <ul style={{ margin: '4px 0 10px', paddingLeft: 18 }}>
      {items.map((i) => <li key={i.id}>{i.title}{i.detail ? <span className='muted small'> · {detail ? detail(i.detail) : i.detail}</span> : null}</li>)}
    </ul>
  )
}

function WeekCard () {
  const s = useStrings(S)
  const [days, setDays] = useState(7)
  const q = useQuery({ queryKey: ['digest', days], queryFn: () => api.digest(days) })
  const d: DigestData | undefined = q.data
  return (
    <Card help='digest#week' title={s.week} actions={
      <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 160 }}>
        {[7, 14, 30].map((n) => <option key={n} value={n}>{s.days(n)}</option>)}
      </select>
    }>
      <ErrorBox error={q.error} />
      {d && (
        <>
          <p className='muted small' style={{ marginTop: 0 }}>{s.period(dateTime(d.from), dateTime(d.to))}</p>
          {d.memories.added === 0 && !d.roots.toReview.length && !d.mostUsed.length && <Empty>{s.nothing}</Empty>}
          {d.memories.added > 0 && (
            <>
              <div className='row'>
                <strong>{s.added(d.memories.added)}</strong>
                {Object.entries(d.memories.byKind).map(([k, n]) => <span key={k} className='badge'>{KIND_LABEL[k] ?? k} {n}</span>)}
              </div>
              <p className='small'>{s.by} {d.memories.byAuthor.map((a) => `${a.name} (${a.count})`).join(', ')}</p>
              <h4 style={{ margin: '6px 0 0' }}>{s.latest}</h4>
              <Items items={d.memories.latest} detail={(k) => KIND_LABEL[k] ?? k} />
            </>
          )}
          {d.roots.added.length > 0 && <><h4 style={{ margin: '6px 0 0' }}>◆ {s.newRoots}</h4><Items items={d.roots.added} detail={(c) => ROOT_CATEGORY_LABEL[c] ?? c} /></>}
          {d.roots.toReview.length > 0 && <><h4 style={{ margin: '6px 0 0' }}>⚠ {s.toReview}</h4><Items items={d.roots.toReview} detail={(c) => ROOT_CATEGORY_LABEL[c] ?? c} /></>}
          {d.mostUsed.length > 0 && <><h4 style={{ margin: '6px 0 0' }}>{s.mostUsed}</h4><Items items={d.mostUsed} detail={s.uses} /></>}
          <p className='muted small' style={{ marginBottom: 0 }}>{s.other(d.myMisses, d.dreams.count, d.stale)}</p>
          {d.dreams.lastSummary && <p className='muted small' style={{ marginBottom: 0 }}>{s.lastDream} {d.dreams.lastSummary}</p>}
        </>
      )}
    </Card>
  )
}

function TeamGapsCard () {
  const s = useStrings(S)
  const client = useQueryClient()
  const gaps = useQuery({ queryKey: ['gaps', 'team'], queryFn: api.teamGaps })
  const [question, setQuestion] = useState('')
  const refresh = () => { void client.invalidateQueries({ queryKey: ['gaps'] }); void client.invalidateQueries({ queryKey: ['digest'] }) }
  const close = useMutation({ mutationFn: (o: { id: string, memory?: string }) => api.closeGap(o.id, o.memory), onSuccess: refresh })
  const ask = useMutation({ mutationFn: () => api.reportGap('', question.trim()), onSuccess: () => { setQuestion(''); refresh() } })
  return (
    <Card help='digest#team-gaps' title={s.teamGaps}>
      <p className='muted' style={{ marginTop: 0 }}>{s.teamGapsIntro}</p>
      {gaps.data?.length === 0 && <Empty>{s.noTeamGaps}</Empty>}
      <div className='list'>
        {gaps.data?.map((g: GapView) => (
          <div key={g.id} className='list-item'>
            <div className='row'>
              <strong style={{ textDecoration: g.status === 'closed' ? 'line-through' : undefined }}>{g.question}</strong>
              {g.status === 'closed' && <span className='badge'>{s.closed}</span>}
              <span className='muted small'>{s.askers(g.askerNames.join(', '))}</span>
              <span className='spacer' />
              {g.status === 'open' && <button className='btn small' disabled={close.isPending} onClick={() => close.mutate({ id: g.id })}>{s.close}</button>}
            </div>
            {g.answer && (
              <div className='row small' style={{ marginTop: 4 }}>
                <span className='muted'>{s.maybe}</span> <span>{g.answer.title}</span>
                <button className='btn small' disabled={close.isPending} onClick={() => close.mutate({ id: g.id, memory: g.answer!.id })}>{s.closeWith}</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className='row' style={{ marginTop: 10 }}>
        <input style={{ flex: 1 }} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={s.askPlaceholder} aria-label={s.ask} />
        <button className='btn primary' disabled={question.trim().length < 3 || ask.isPending} onClick={() => ask.mutate()}>{s.send}</button>
      </div>
      <ErrorBox error={close.error ?? ask.error} />
    </Card>
  )
}

function MyGapsCard () {
  const s = useStrings(S)
  const client = useQueryClient()
  const mine = useQuery({ queryKey: ['gaps', 'mine'], queryFn: api.myGaps })
  const refresh = () => { void client.invalidateQueries({ queryKey: ['gaps'] }); void client.invalidateQueries({ queryKey: ['digest'] }) }
  const report = useMutation({ mutationFn: (key: string) => api.reportGap(key), onSuccess: refresh })
  const dismiss = useMutation({ mutationFn: (key: string) => api.dismissGap(key), onSuccess: refresh })
  return (
    <Card help='digest#mine' title={s.mine}>
      <p className='muted' style={{ marginTop: 0 }}>{s.mineIntro}</p>
      {mine.data?.length === 0 && <Empty>{s.noMine}</Empty>}
      <div className='list'>
        {mine.data?.map((m: MyGap) => (
          <div key={m.key} className='list-item'>
            <div className='row'>
              <span>{m.query}</span>
              <span className='muted small'>{s.times(m.count)} · {dateTime(m.last)}</span>
              <span className='spacer' />
              <button className='btn small' disabled={report.isPending} onClick={() => report.mutate(m.key)}>{s.report}</button>
              <button className='btn small' disabled={dismiss.isPending} onClick={() => dismiss.mutate(m.key)}>{s.dismiss}</button>
            </div>
            {m.answer && <div className='small' style={{ marginTop: 4 }}><span className='muted'>{s.maybe}</span> {m.answer.title}</div>}
          </div>
        ))}
      </div>
      <ErrorBox error={report.error ?? dismiss.error} />
    </Card>
  )
}
