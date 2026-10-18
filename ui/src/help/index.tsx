/**
 * @file Guida in linea (B2): cosa fa ogni schermata e funzione di Micelio E COME FUNZIONA DIETRO
 * (dove finiscono i dati, in che formato, come arrivano agli altri nodi).
 *
 * CONTENUTI. Un file Markdown per argomento e per lingua:
 *   ui/src/help/content/it/<argomento>.md
 *   ui/src/help/content/en/<argomento>.md
 * Struttura di un file:
 *   # Titolo dell'argomento
 *   Introduzione…
 *   ## Titolo di sezione {#ancora}
 *   Testo…
 * Le ANCORE sono uguali nelle due lingue: i pulsanti «?» puntano a `argomento#ancora`. Un test
 * (help.test.ts) verifica che ogni argomento esista in entrambe le lingue con le stesse ancore.
 *
 * DOVE SI VEDE.
 * - Pulsante «?» (HelpButton) accanto ai titoli di pagine e schede: apre il pannello laterale
 *   (HelpDrawer) sulla sezione giusta;
 * - pagina «Guida» (pages/Guide.tsx): indice di tutti gli argomenti e ricerca nel testo;
 * - F1: apre la guida sull'argomento della pagina corrente (vedi App.tsx).
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Markdown } from '../components/ui'
import { defineStrings, type Lang, useLang, useStrings } from '../i18n'

/** Ordine degli argomenti nell'indice della guida. */
export const TOPIC_ORDER = [
  'overview', 'data', 'p2p', 'ingestion', 'privacy', 'memory', 'priority', 'roots', 'inbox',
  'dreams', 'team', 'teams', 'quality', 'status', 'private', 'security', 'settings', 'documents',
  'views', 'agents', 'cli', 'language'
] as const
export type TopicId = typeof TOPIC_ORDER[number]

export interface HelpSection { id: string, heading: string, body: string }
export interface HelpTopic { id: string, title: string, intro: string, sections: HelpSection[] }

// Tutti i file .md della guida, come testo (Vite li include nel pacchetto della UI).
const FILES = import.meta.glob('./content/*/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/**
 * Converte un file della guida in un argomento: titolo (#), introduzione, sezioni (## … {#ancora}).
 * Esportata per i test.
 */
export function parseTopic (id: string, md: string): HelpTopic {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let title = id
  const intro: string[] = []
  const sections: HelpSection[] = []
  let cur: HelpSection | null = null
  for (const line of lines) {
    const h1 = line.match(/^# (.+)$/)
    const h2 = line.match(/^## (.+?)\s*\{#([a-z0-9-]+)\}\s*$/)
    if (h1 && !cur && title === id) { title = h1[1].trim(); continue }
    if (h2) {
      cur = { id: h2[2], heading: h2[1].trim(), body: '' }
      sections.push(cur)
      continue
    }
    if (cur) cur.body += line + '\n'
    else intro.push(line)
  }
  return { id, title, intro: intro.join('\n').trim(), sections: sections.map((s) => ({ ...s, body: s.body.trim() })) }
}

/** Tutti gli argomenti di una lingua, nell'ordine dell'indice. */
export function topics (lang: Lang): HelpTopic[] {
  return TOPIC_ORDER
    .map((id) => FILES[`./content/${lang}/${id}.md`])
    .map((md, i) => (md ? parseTopic(TOPIC_ORDER[i], md) : null))
    .filter((t): t is HelpTopic => t !== null)
}

/** Un argomento in una lingua (null se manca). */
export function topic (lang: Lang, id: string): HelpTopic | null {
  const md = FILES[`./content/${lang}/${id}.md`]
  return md ? parseTopic(id, md) : null
}

const S = defineStrings({
  it: { help: 'Guida', open: 'Apri la guida', close: 'Chiudi la guida', full: 'Guida completa →', missing: 'Argomento non trovato.' },
  en: { help: 'Guide', open: 'Open the guide', close: 'Close the guide', full: 'Full guide →', missing: 'Topic not found.' }
})

interface HelpState {
  /** Riferimento aperto nel pannello ("argomento" o "argomento#ancora"), null = chiuso. */
  current: string | null
  open: (ref: string) => void
  close: () => void
}
const HelpContext = createContext<HelpState>({ current: null, open: () => {}, close: () => {} })
export const useHelp = (): HelpState => useContext(HelpContext)

/** Stato del pannello della guida: va messo sopra le schermate (App.tsx). */
export function HelpProvider ({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<string | null>(null)
  const open = useCallback((ref: string) => setCurrent(ref), [])
  const close = useCallback(() => setCurrent(null), [])
  return (
    <HelpContext.Provider value={{ current, open, close }}>
      {children}
      {current && <HelpDrawer refId={current} onClose={close} />}
    </HelpContext.Provider>
  )
}

/** Pulsante «?»: apre la guida sull'argomento (e sezione) indicato, es. "roots#review". */
export function HelpButton ({ topic: ref, label }: { topic: string, label?: string }) {
  const s = useStrings(S)
  const { open } = useHelp()
  return (
    <button type='button' className='help-btn' aria-label={label ?? s.open} title={label ?? s.open} onClick={(e) => { e.stopPropagation(); open(ref) }}>?</button>
  )
}

/** Il contenuto di un argomento, con la sezione indicata messa in evidenza e portata in vista. */
export function TopicView ({ topic: t, anchor }: { topic: HelpTopic, anchor?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!anchor) return
    const el = ref.current?.querySelector(`[data-anchor="${anchor}"]`)
    el?.scrollIntoView?.({ block: 'start' })
  }, [anchor, t.id])
  return (
    <div ref={ref} className='help-topic'>
      <h2 style={{ marginTop: 0 }}>{t.title}</h2>
      {t.intro && <Markdown text={t.intro} />}
      {t.sections.map((sec) => (
        <section key={sec.id} data-anchor={sec.id} className={`help-section ${sec.id === anchor ? 'focus' : ''}`}>
          <h3>{sec.heading}</h3>
          <Markdown text={sec.body} />
        </section>
      ))}
    </div>
  )
}

/** Pannello laterale con un argomento della guida. */
function HelpDrawer ({ refId, onClose }: { refId: string, onClose: () => void }) {
  const s = useStrings(S)
  const { lang } = useLang()
  const [id, anchor] = refId.split('#')
  const t = topic(lang, id)
  // Esc chiude il pannello
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <aside className='help-drawer' role='dialog' aria-label={s.help}>
      <div className='row' style={{ marginBottom: 8 }}>
        <strong>{s.help}</strong>
        <span className='spacer' />
        <a href={`#/guida?t=${encodeURIComponent(refId)}`} onClick={onClose}>{s.full}</a>
        <button className='btn small' onClick={onClose} aria-label={s.close}>✕</button>
      </div>
      {t ? <TopicView topic={t} anchor={anchor} /> : <p className='muted'>{s.missing}</p>}
    </aside>
  )
}
