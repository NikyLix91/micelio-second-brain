/**
 * @file Efficacia (B11): quando gli agenti interrogano Micelio e se ricevono dati utili.
 *
 * - **Consultazioni**, in tempo reale: ogni richiesta di Claude Code a Micelio (tool MCP o contesto
 *   automatico), con cosa ha ricevuto e quanto ci ha messo il daemon a rispondere;
 * - **Esiti**, a sessione finita: per ogni ricordo fornito, se l'agente l'ha usato. Prima
 *   l'euristica ("probabilmente utile", con la prova), poi il giudizio dell'LLM alla distillazione
 *   ("utile" confermato → pollice in su automatico; "sbagliato" → da rivedere);
 * - ricordi più utili, rumore (restituiti spesso, mai utili), sbagliati, domande senza risposta.
 *
 * Tutto resta su questo PC; al team arrivano solo il pollice in su e quante volte un ricordo è
 * stato utile (src/node/micelio-node.ts, efficacyReport).
 *
 * EN: Efficacy (B11): when agents query Micelio and whether they get useful data.
 *
 * - **Queries**, live: every request from Claude Code to Micelio (MCP tool or automatic
 *   context), with what it received and how long the daemon took to answer;
 * - **Outcomes**, once the session is over: for each memory delivered, whether the agent used it. First
 *   the heuristic ("probably useful", with the evidence), then the LLM's judgement at distillation
 *   ("useful" confirmed → automatic thumbs up; "wrong" → to review);
 * - most useful memories, noise (returned often, never useful), wrong ones, unanswered questions.
 *
 * Everything stays on this PC; the team only gets the thumbs up and how many times a memory was
 * useful (src/node/micelio-node.ts, efficacyReport).
 */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type EfficacyReport } from '../api/client'
import { MemoryPanel } from '../components/MemoryPanel'
import { Card, Empty, ErrorBox, PageHeader } from '../components/ui'
import { dateTime, percent } from '../format'
import { HelpButton } from '../help'
import { defineStrings, useStrings } from '../i18n'

type Verdict = EfficacyReport['outcomes'][number]['verdict']

const S = defineStrings({
  it: {
    title: 'Efficacia',
    subtitle: 'Quando gli agenti interrogano Micelio e se ricevono dati utili.',
    days: (n: number) => (n === 1 ? 'Ultime 24 ore' : `Ultimi ${n} giorni`),
    allProjects: 'Tutti i progetti',
    consultations: 'Consultazioni',
    withResults: (p: string) => `${p} con risultati`,
    delivered: 'Ricordi forniti',
    deliveredHint: 'nelle sessioni già valutate',
    useful: 'Utili',
    usefulHint: (confirmed: number) => `${confirmed} confermati dall'LLM`,
    thumbs: 'Pollici in su',
    thumbsHint: 'dati in automatico',
    wrong: 'Sbagliati',
    wrongHint: 'da rivedere',
    speed: 'Tempo di risposta',
    speedHint: (p95: number, slow: number) => `95% entro ${p95} ms · ${slow} oltre 1 s`,
    live: 'Consultazioni in tempo reale',
    liveIntro: 'Ogni richiesta di un agente a Micelio, appena arriva.',
    noLive: 'Nessuna consultazione in questo periodo. Gli agenti la fanno con i tool MCP o con il contesto automatico (Impostazioni → Contesto automatico).',
    results: (n: number) => (n === 0 ? 'nessun risultato' : n === 1 ? '1 ricordo' : `${n} ricordi`),
    outcomes: 'Esiti',
    outcomesIntro: 'Per ogni ricordo fornito, se l\'agente l\'ha usato. Arrivano a sessione finita (dopo qualche minuto di inattività).',
    noOutcomes: 'Ancora nessun esito: le sessioni si valutano quando Micelio le raccoglie.',
    verdict: { used: '✓ utile', likely: '≈ probabilmente utile', ignored: '· non usato', none: '· nessuna traccia d\'uso', wrong: '✗ sbagliato' } as Record<Verdict, string>,
    judge: { llm: 'giudizio dell\'LLM', heuristic: 'euristica' } as Record<string, string>,
    voted: '👍',
    top: 'I più utili',
    topRow: (here: number, team: number) => `utile ${here} ${here === 1 ? 'volta' : 'volte'} qui · ${team} nel team`,
    noTop: 'Ancora nessun ricordo utile in questo periodo.',
    noisy: 'Rumore',
    noisyIntro: 'Restituiti spesso, mai utili: forse vanno riscritti, accorpati o archiviati. Intanto Micelio li propone meno (abituazione).',
    noisyRow: (returned: number) => `restituito ${returned} volte, mai usato`,
    noisyFactor: (pct: number) => ` · ora pesa il ${pct}%`,
    noNoisy: 'Nessun ricordo rumoroso.',
    wrongTitle: 'Sbagliati o superati',
    wrongIntro: 'L\'LLM li ha trovati contraddetti da ciò che è emerso nella sessione. Aprili e decidi: correggi, vota giù o archivia (per una Radice: segnala da rivedere).',
    noWrong: 'Nessun ricordo segnalato come sbagliato.',
    unanswered: 'Domande senza risposta',
    unansweredIntro: 'Ricerche degli agenti che non hanno trovato nulla: lacune di conoscenza (vedi Riepilogo).',
    noUnanswered: 'Nessuna.',
    times: (n: number) => (n === 1 ? '1 volta' : `${n} volte`),
    channel: { recall: 'ricerca', architecture: 'Radici', get: 'lettura', fetch_source: 'documento', 'session-start': 'inizio sessione', prompt: 'contesto alla richiesta' } as Record<string, string>
  },
  en: {
    title: 'Efficacy',
    subtitle: 'When agents query Micelio and whether they get useful data.',
    days: (n: number) => (n === 1 ? 'Last 24 hours' : `Last ${n} days`),
    allProjects: 'All projects',
    consultations: 'Queries',
    withResults: (p: string) => `${p} with results`,
    delivered: 'Memories delivered',
    deliveredHint: 'in sessions already evaluated',
    useful: 'Useful',
    usefulHint: (confirmed: number) => `${confirmed} confirmed by the LLM`,
    thumbs: 'Thumbs up',
    thumbsHint: 'given automatically',
    wrong: 'Wrong',
    wrongHint: 'to review',
    speed: 'Response time',
    speedHint: (p95: number, slow: number) => `95% within ${p95} ms · ${slow} over 1 s`,
    live: 'Live queries',
    liveIntro: 'Every request from an agent to Micelio, as soon as it arrives.',
    noLive: 'No queries in this period. Agents query Micelio with the MCP tools or the automatic context (Settings → Automatic context).',
    results: (n: number) => (n === 0 ? 'no results' : n === 1 ? '1 memory' : `${n} memories`),
    outcomes: 'Outcomes',
    outcomesIntro: 'For each memory delivered, whether the agent used it. They arrive when the session is over (after a few minutes of inactivity).',
    noOutcomes: 'No outcomes yet: sessions are evaluated when Micelio collects them.',
    verdict: { used: '✓ useful', likely: '≈ probably useful', ignored: '· not used', none: '· no trace of use', wrong: '✗ wrong' } as Record<Verdict, string>,
    judge: { llm: 'LLM judgement', heuristic: 'heuristic' } as Record<string, string>,
    voted: '👍',
    top: 'Most useful',
    topRow: (here: number, team: number) => `useful ${here} ${here === 1 ? 'time' : 'times'} here · ${team} in the team`,
    noTop: 'No useful memory in this period yet.',
    noisy: 'Noise',
    noisyIntro: 'Returned often, never useful: they may need rewriting, merging or archiving. Meanwhile Micelio offers them less (habituation).',
    noisyRow: (returned: number) => `returned ${returned} times, never used`,
    noisyFactor: (pct: number) => ` · now weighs ${pct}%`,
    noNoisy: 'No noisy memory.',
    wrongTitle: 'Wrong or outdated',
    wrongIntro: 'The LLM found them contradicted by what came out in the session. Open them and decide: fix, vote down or archive (for a Root: flag for review).',
    noWrong: 'No memory flagged as wrong.',
    unanswered: 'Unanswered questions',
    unansweredIntro: 'Agent searches that found nothing: knowledge gaps (see Digest).',
    noUnanswered: 'None.',
    times: (n: number) => (n === 1 ? 'once' : `${n} times`),
    channel: { recall: 'search', architecture: 'Roots', get: 'read', fetch_source: 'document', 'session-start': 'session start', prompt: 'context on request' } as Record<string, string>
  }
})

const VERDICT_CLASS: Record<Verdict, string> = { used: 'ok', likely: 'accent', ignored: '', none: '', wrong: 'warn' }

export function Efficacy () {
  const s = useStrings(S)
  const [days, setDays] = useState(7)
  const [project, setProject] = useState('')
  const q = useQuery({ queryKey: ['efficacy', days, project], queryFn: () => api.efficacy(days, project || undefined) })
  /** Ricordo aperto nel pannello di dettaglio. / EN: Memory open in the detail panel. */
  const [open, setOpen] = useState<{ id: string, title: string } | null>(null)
  const r = q.data
  // Progetti visti nel periodo, per il filtro (anche quello scelto, se non compare più)
  // EN: Projects seen in the period, for the filter (including the chosen one, if it no longer appears)
  const projects = [...new Set([...(r?.consultations ?? []).map((c) => c.project), ...(r?.outcomes ?? []).map((o) => o.project), project || null].filter((p): p is string => !!p))].sort()
  const link = (m: { id: string, title: string }) => <button className='link' onClick={() => setOpen(m)}>{m.title}</button>

  return (
    <>
      <PageHeader help='efficacy' title={s.title} subtitle={s.subtitle} actions={
        <div className='row'>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value=''>{s.allProjects}</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 7, 30, 90].map((d) => <option key={d} value={d}>{s.days(d)}</option>)}
          </select>
        </div>
      } />
      <ErrorBox error={q.error} />
      {r && (
        <div className='stack'>
          <div className='grid'>
            <Tile label={s.consultations} value={r.summary.consultations} hint={s.withResults(percent(r.summary.consultations ? r.summary.withResults / r.summary.consultations : 0))} />
            <Tile label={s.delivered} value={r.summary.delivered} hint={s.deliveredHint} />
            <Tile label={s.useful} value={r.summary.delivered ? percent(r.summary.useful / r.summary.delivered) : '–'} hint={s.usefulHint(r.summary.confirmed)} />
            <Tile label={s.thumbs} value={r.summary.thumbsUp} hint={s.thumbsHint} />
            <Tile label={s.wrong} value={r.summary.wrong} hint={s.wrongHint} warn={r.summary.wrong > 0} />
            <Tile label={s.speed} value={`${r.summary.msMedian} ms`} hint={s.speedHint(r.summary.msP95, r.summary.slow)} warn={r.summary.slow > 0} />
          </div>

          <Card help='efficacy#consultations' title={s.live}>
            <p className='muted small' style={{ marginTop: 0 }}>{s.liveIntro}</p>
            {r.consultations.length === 0
              ? <Empty>{s.noLive}</Empty>
              : (
                <table className='table'>
                  <tbody>
                    {r.consultations.slice(0, 40).map((c) => (
                      <tr key={c.id}>
                        <td className='muted small' style={{ whiteSpace: 'nowrap' }}>{dateTime(c.ts)}</td>
                        <td><span className='badge'>{s.channel[c.channel] ?? c.channel}</span>{c.project ? <span className='muted small'> · {c.project}</span> : null}</td>
                        <td>
                          {c.query && <div className='small'>«{c.query.slice(0, 140)}»</div>}
                          <div className='small'>
                            <span className={c.ids.length ? '' : 'muted'}>{s.results(c.ids.length)}</span>
                            {c.memories.length > 0 && <> · {c.memories.map((m, i) => <span key={m.id}>{i > 0 && ', '}{link(m)}</span>)}</>}
                          </div>
                        </td>
                        <td className={`small ${c.ms > 1000 ? 'warn' : 'muted'}`} style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{c.ms} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
          </Card>

          <Card help='efficacy#outcomes' title={s.outcomes}>
            <p className='muted small' style={{ marginTop: 0 }}>{s.outcomesIntro}</p>
            {r.outcomes.length === 0
              ? <Empty>{s.noOutcomes}</Empty>
              : (
                <table className='table'>
                  <tbody>
                    {r.outcomes.slice(0, 40).map((o) => (
                      <tr key={`${o.session}/${o.memory.id}`}>
                        <td className='muted small' style={{ whiteSpace: 'nowrap' }}>{dateTime(o.ts)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}><span className={`badge ${VERDICT_CLASS[o.verdict]}`}>{s.verdict[o.verdict]}</span>{o.voted && <span title={s.thumbsHint}> {s.voted}</span>}</td>
                        <td>
                          <div>{link(o.memory)}</div>
                          {o.evidence && <div className='muted small'>{o.judge === 'heuristic' ? <code>{o.evidence}</code> : o.evidence}</div>}
                        </td>
                        <td className='muted small' style={{ whiteSpace: 'nowrap' }}>{s.judge[o.judge]}{o.project ? ` · ${o.project}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
          </Card>

          <div className='grid'>
            <Card help='efficacy#top' title={s.top}>
              {r.topUseful.length === 0
                ? <Empty>{s.noTop}</Empty>
                : <ul className='plain'>{r.topUseful.map((m) => <li key={m.id}>{link(m)} <span className='muted small'>· {s.topRow(m.useful, m.teamUseful)}</span></li>)}</ul>}
            </Card>
            <Card help='efficacy#noise' title={s.noisy}>
              <p className='muted small' style={{ marginTop: 0 }}>{s.noisyIntro}</p>
              {r.noisy.length === 0
                ? <Empty>{s.noNoisy}</Empty>
                : <ul className='plain'>{r.noisy.map((m) => <li key={m.id}>{link(m)} <span className='muted small'>· {s.noisyRow(m.returned)}{m.factor < 1 ? s.noisyFactor(Math.round(m.factor * 100)) : ''}</span></li>)}</ul>}
            </Card>
            <Card help='efficacy#wrong' title={s.wrongTitle}>
              <p className='muted small' style={{ marginTop: 0 }}>{s.wrongIntro}</p>
              {r.wrong.length === 0
                ? <Empty>{s.noWrong}</Empty>
                : <ul className='plain'>{r.wrong.map((m) => <li key={`${m.session}/${m.id}`}>{link(m)}{m.reason && <div className='muted small'>{m.reason}</div>}</li>)}</ul>}
            </Card>
            <Card help='efficacy#unanswered' title={s.unanswered}>
              <p className='muted small' style={{ marginTop: 0 }}>{s.unansweredIntro}</p>
              {r.unanswered.length === 0
                ? <Empty>{s.noUnanswered}</Empty>
                : <ul className='plain'>{r.unanswered.map((u) => <li key={u.query}>«{u.query}» <span className='muted small'>· {s.times(u.count)}</span></li>)}</ul>}
            </Card>
          </div>
        </div>
      )}
      {open && (
        <div className='map-detail' style={{ position: 'fixed' }}>
          <MemoryPanel node={{ id: open.id, title: open.title } as any} onClose={() => setOpen(null)} />
        </div>
      )}
    </>
  )
}

/** Un numero con etichetta e nota, in cima alla pagina. / EN: A number with label and note, at the top of the page. */
function Tile ({ label, value, hint, warn = false }: { label: string, value: number | string, hint: string, warn?: boolean }) {
  return (
    <div className='card'>
      <div className='muted small'>{label}</div>
      <div className={`stat ${warn ? 'warn' : ''}`}>{value}</div>
      <div className='muted small'>{hint}</div>
    </div>
  )
}
