/**
 * @file Chiedi (B10): chat AI sulla memoria del team, con la mappa mentale del sapere.
 *
 * Tre colonne: conversazioni (cronologia, solo su questo PC) · conversazione · mappa mentale.
 * A ogni domanda partono due richieste insieme:
 * - /api/chat/map: la mappa (ricerca e collegamenti, senza LLM) → compare subito;
 * - /api/chat/ask: la risposta dell'LLM, scritta SOLO sui ricordi trovati, con i riferimenti [n]
 *   → arriva dopo qualche secondo, e dà ai temi della mappa un nome leggibile.
 * Sotto ogni risposta: «Salva come ricordo»; se la memoria non lo sa, «Segnala al team».
 * Un clic su [n] illumina il ricordo nella mappa; un clic su un ricordo lo apre.
 *
 * EN: Ask (B10): AI chat over the team memory, with the mind map of the knowledge.
 *
 * EN: Three columns: conversations (history, only on this PC) · conversation · mind map.
 * Each question fires two requests together:
 * - /api/chat/map: the map (search and links, no LLM) → shows up right away;
 * - /api/chat/ask: the LLM answer, written ONLY from the memories found, with [n] references
 *   → arrives after a few seconds, and gives the map's themes a readable name.
 * Below each answer: «Save as a memory»; if the memory doesn't know, «Report to the team».
 * A click on [n] highlights the memory in the map; a click on a memory opens it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { api, type ChatMap, type ChatMapLink, type ChatMapMemory, type ChatMessage } from '../api/client'
import { MemoryPanel } from '../components/MemoryPanel'
import { MindMap } from '../components/MindMap'
import { Empty, ErrorBox, PageHeader } from '../components/ui'
import { ago } from '../format'
import { defineStrings, useStrings } from '../i18n'

const S = defineStrings({
  it: {
    title: 'Chiedi',
    subtitle: 'Fai una domanda alla memoria del team: risposta con le fonti e mappa del sapere sull\'argomento.',
    newChat: '+ Nuova conversazione',
    history: 'Conversazioni',
    noHistory: 'Le conversazioni restano solo su questo PC.',
    questions: (n: number) => (n === 1 ? '1 domanda' : `${n} domande`),
    rename: 'Rinomina',
    del: 'Cancella',
    confirmDel: 'Cancellare questa conversazione? Resta solo su questo PC: non si può recuperare.',
    placeholder: 'es. Come gestiamo i retry verso le API esterne?',
    send: 'Chiedi',
    thinking: 'Sto leggendo i ricordi del team…',
    queued: 'L\'LLM è occupato con un\'altra elaborazione: la risposta arriva appena si libera.',
    welcome: 'Chiedi qualcosa su come lavora il tuo team: decisioni, procedure, problemi già risolti. La risposta usa solo la memoria del team e ti dice da quali ricordi viene.',
    examples: ['Cosa devo sapere prima di toccare il servizio ordini?', 'Come gestiamo i segreti e le chiavi?', 'Quali problemi abbiamo avuto con la CI?'],
    save: 'Salva come ricordo',
    saved: 'Salvato nella memoria del team',
    savedInbox: 'In Inbox: da confermare',
    savedPrivate: 'Non salvato: contenuto privato',
    unknown: 'La memoria del team non basta a rispondere.',
    report: 'Segnala al team come lacuna',
    reported: 'Segnalata al team',
    sources: 'Fonti',
    mapEmpty: 'La mappa del sapere compare qui alla prima domanda.',
    mapNone: 'Nessun ricordo pertinente: la mappa è vuota.'
  },
  en: {
    title: 'Ask',
    subtitle: 'Ask the team memory a question: an answer with its sources and a map of what the team knows on the topic.',
    newChat: '+ New conversation',
    history: 'Conversations',
    noHistory: 'Conversations stay on this PC only.',
    questions: (n: number) => (n === 1 ? '1 question' : `${n} questions`),
    rename: 'Rename',
    del: 'Delete',
    confirmDel: 'Delete this conversation? It only exists on this PC: it cannot be recovered.',
    placeholder: 'e.g. How do we handle retries to external APIs?',
    send: 'Ask',
    thinking: 'Reading the team memories…',
    queued: 'The LLM is busy with another job: the answer arrives as soon as it is free.',
    welcome: 'Ask something about how your team works: decisions, procedures, problems already solved. The answer only uses the team memory and tells you which memories it comes from.',
    examples: ['What should I know before touching the orders service?', 'How do we handle secrets and keys?', 'What problems did we have with CI?'],
    save: 'Save as a memory',
    saved: 'Saved in the team memory',
    savedInbox: 'In the Inbox: to be confirmed',
    savedPrivate: 'Not saved: private content',
    unknown: 'The team memory is not enough to answer.',
    report: 'Report to the team as a gap',
    reported: 'Reported to the team',
    sources: 'Sources',
    mapEmpty: 'The knowledge map shows up here with the first question.',
    mapNone: 'No relevant memory: the map is empty.'
  }
})

/** Una risposta come la mostra la pagina (dalla cronologia o appena arrivata). / EN: An answer as the page shows it (from history or just arrived). */
interface Answer { messageId: number, text: string, unknown: boolean, cited: string[], refs: { n: number, id: string, title: string }[], map: ChatMap, saved?: { outcome: string } }

export function Ask () {
  const s = useStrings(S)
  const client = useQueryClient()
  // `#/chiedi?chat=<id>` apre direttamente una conversazione
  // EN: `#/chiedi?chat=<id>` opens a conversation directly
  const [params] = useSearchParams()
  const [chatId, setChatId] = useState<number | null>(params.get('chat') ? Number(params.get('chat')) : null)
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [map, setMap] = useState<ChatMap | null>(null)
  const [extra, setExtra] = useState<Record<string, { memories: ChatMapMemory[], links: ChatMapLink[] }>>({})
  const [focus, setFocus] = useState<string | null>(null)
  const [open, setOpen] = useState<ChatMapMemory | null>(null)
  const [slow, setSlow] = useState(false)
  const [reported, setReported] = useState<Set<number>>(new Set())
  const chats = useQuery({ queryKey: ['chats'], queryFn: api.chats })
  const messages = useQuery({ queryKey: ['chats', chatId], queryFn: () => api.chatMessages(chatId!), enabled: chatId !== null })
  const endRef = useRef<HTMLDivElement>(null)

  // Domanda/risposta in coppie, dalla cronologia
  // EN: Question/answer pairs, from the history
  const turns = pairUp(messages.data ?? [])
  const last = turns.at(-1)?.answer
  // Aprendo una conversazione si torna alla mappa della sua ultima risposta
  // EN: Opening a conversation goes back to the map of its last answer
  useEffect(() => { if (!pending && last) { setMap(last.map); setExtra({}) } }, [last?.messageId])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns.length, pending])

  const ask = useMutation({
    mutationFn: async (q: string) => {
      setPending(q)
      setSlow(false)
      const timer = setTimeout(() => setSlow(true), 15_000)
      // La mappa arriva subito (senza LLM), la risposta dopo
      // EN: The map arrives right away (no LLM), the answer later
      api.chatMap(q).then((m) => { setMap(m); setExtra({}); setFocus(null) }).catch(() => {})
      try { return await api.chatAsk(q, chatId ?? undefined) } finally { clearTimeout(timer) }
    },
    onSuccess: (r) => {
      setMap(r.map)
      setChatId(r.chatId)
      setQuestion('')
      void client.invalidateQueries({ queryKey: ['chats'] })
    },
    onSettled: () => setPending(null)
  })
  const save = useMutation({ mutationFn: (messageId: number) => api.chatSave(messageId), onSuccess: () => void client.invalidateQueries({ queryKey: ['chats', chatId] }) })
  const send = () => { const q = question.trim(); if (q.length >= 3 && !pending) ask.mutate(q) }
  const newChat = () => { setChatId(null); setMap(null); setExtra({}); setFocus(null) }
  const expand = async (id: string) => { const e = await api.chatExpand(id); setExtra((x) => ({ ...x, [id]: e })) }
  const cited = new Set(last?.cited ?? [])

  return (
    <>
      <PageHeader help='ask' title={s.title} subtitle={s.subtitle} />
      <div className='ask'>
        {/* ── Cronologia ── / EN: ── History ── */}
        <aside className='ask-history'>
          <button className='btn primary' onClick={newChat}>{s.newChat}</button>
          <div className='muted small' style={{ margin: '12px 0 6px' }}>{s.history}</div>
          {(chats.data ?? []).length === 0 && <div className='muted small'>{s.noHistory}</div>}
          {(chats.data ?? []).map((c) => (
            <div key={c.id} className={`ask-chat ${c.id === chatId ? 'on' : ''}`} onClick={() => { setChatId(c.id); setExtra({}) }}>
              <div className='ask-chat-title'>{c.title}</div>
              <div className='muted small'>{s.questions(c.questions)} · {ago(c.updated)}</div>
              {c.id === chatId && (
                <div className='row small' style={{ marginTop: 4 }}>
                  <button className='link' onClick={(e) => { e.stopPropagation(); const t = prompt(s.rename, c.title); if (t) void api.renameChat(c.id, t).then(() => client.invalidateQueries({ queryKey: ['chats'] })) }}>{s.rename}</button>
                  <button className='link' onClick={(e) => { e.stopPropagation(); if (confirm(s.confirmDel)) void api.deleteChat(c.id).then(() => { newChat(); void client.invalidateQueries({ queryKey: ['chats'] }) }) }}>{s.del}</button>
                </div>
              )}
            </div>
          ))}
        </aside>

        {/* ── Conversazione ── / EN: ── Conversation ── */}
        <section className='ask-thread'>
          <div className='ask-messages'>
            {turns.length === 0 && !pending && (
              <div className='ask-welcome'>
                <p>{s.welcome}</p>
                {s.examples.map((e) => <button key={e} className='btn small' onClick={() => setQuestion(e)}>{e}</button>)}
              </div>
            )}
            {turns.map((t) => (
              <div key={t.question.id}>
                <div className='ask-q'>{t.question.text}</div>
                {t.answer && <AnswerView a={t.answer} onRef={(id) => setFocus(id)} onSave={() => save.mutate(t.answer!.messageId)} saving={save.isPending}
                  reported={reported.has(t.answer.messageId)} onReport={() => void api.reportGap('chat', t.question.text).then(() => setReported((r) => new Set(r).add(t.answer!.messageId)))} />}
              </div>
            ))}
            {pending && (
              <div>
                <div className='ask-q'>{pending}</div>
                <div className='ask-a muted'><span className='spinner' /> {slow ? s.queued : s.thinking}</div>
              </div>
            )}
            <ErrorBox error={ask.error ?? save.error} />
            <div ref={endRef} />
          </div>
          <div className='ask-input'>
            <textarea value={question} placeholder={s.placeholder} rows={2} onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
            <button className='btn primary' disabled={!!pending || question.trim().length < 3} onClick={send}>{s.send}</button>
          </div>
        </section>

        {/* ── Mappa mentale ── / EN: ── Mind map ── */}
        <section className='ask-map'>
          {!map
            ? <Empty>{s.mapEmpty}</Empty>
            : map.memories.length === 0
              ? <Empty>{s.mapNone}</Empty>
              : <MindMap map={map} extra={extra} cited={cited} focus={focus} onOpen={setOpen} onExpand={(id) => void expand(id)} />}
          {open && (
            <div className='map-detail'>
              <MemoryPanel node={{ id: open.id, title: open.title } as any} onClose={() => setOpen(null)} />
            </div>
          )}
        </section>
      </div>
    </>
  )
}

/** Una risposta: testo con i riferimenti [n] cliccabili, fonti, azioni. / EN: An answer: text with clickable [n] references, sources, actions. */
function AnswerView ({ a, onRef, onSave, saving, reported, onReport }: { a: Answer, onRef: (id: string) => void, onSave: () => void, saving: boolean, reported: boolean, onReport: () => void }) {
  const s = useStrings(S)
  const idOf = (n: number) => a.refs.find((r) => r.n === n)?.id
  // [n] → link interno, poi reso come pulsante che illumina il ricordo nella mappa
  // EN: [n] → internal link, then rendered as a button that highlights the memory in the map
  const text = a.text.replace(/\[(\d+)\]/g, (m, n) => (idOf(Number(n)) ? `[${n}](#ref-${n})` : m))
  const used = a.refs.filter((r) => a.cited.includes(r.id))
  return (
    <div className='ask-a'>
      <div className='markdown'>
        <ReactMarkdown components={{
          a: ({ href, children }) => {
            const n = href?.startsWith('#ref-') ? Number(href.slice(5)) : null
            return n !== null
              ? <button className='ref' onClick={() => { const id = idOf(n); if (id) onRef(id) }}>{children}</button>
              : <a href={href} target='_blank' rel='noreferrer noopener'>{children}</a>
          }
        }}>{text}</ReactMarkdown>
      </div>
      {used.length > 0 && (
        <div className='ask-sources small'>
          <span className='muted'>{s.sources}:</span> {used.map((r) => <button key={r.n} className='link' onClick={() => onRef(r.id)}>[{r.n}] {r.title}</button>)}
        </div>
      )}
      <div className='row small' style={{ marginTop: 8 }}>
        {a.unknown
          ? <>
            <span className='muted'>{s.unknown}</span>
            <button className='btn small' disabled={reported} onClick={onReport}>{reported ? s.reported : s.report}</button>
          </>
          : a.saved
            ? <span className='badge accent'>{a.saved.outcome === 'team' ? s.saved : a.saved.outcome === 'inbox' ? s.savedInbox : s.savedPrivate}</span>
            : used.length > 0 && <button className='btn small' disabled={saving} onClick={onSave}>{s.save}</button>}
      </div>
    </div>
  )
}

/** Messaggi in coppie domanda → risposta. / EN: Messages as question → answer pairs. */
function pairUp (msgs: ChatMessage[]): { question: ChatMessage, answer: Answer | null }[] {
  const out: { question: ChatMessage, answer: Answer | null }[] = []
  for (const m of msgs) {
    if (m.role === 'user') out.push({ question: m, answer: null })
    else if (out.length) {
      out[out.length - 1].answer = { messageId: m.id, text: m.text, unknown: !!m.data?.unknown, cited: m.data?.cited ?? [], refs: m.data?.refs ?? [], map: m.data?.map ?? { question: '', themes: [], memories: [], links: [] }, ...(m.data?.saved ? { saved: m.data.saved } : {}) }
    }
  }
  return out
}
