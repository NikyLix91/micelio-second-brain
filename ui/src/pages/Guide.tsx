/**
 * @file Guida completa (B2): indice di tutti gli argomenti, ricerca nel testo, lettura.
 * Si apre dal menu («Guida»), con F1, o dal link «Guida completa» del pannello laterale.
 * `#/guida?t=argomento#ancora` apre direttamente un argomento su una sezione.
 *
 * EN: Full guide (B2): index of all topics, full-text search, reading.
 * It opens from the menu («Guide»), with F1, or from the «Full guide» link in the side panel.
 * `#/guida?t=argomento#ancora` opens a topic directly at a section.
 */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Empty, PageHeader } from '../components/ui'
import { TopicView, topics } from '../help'
import { defineStrings, useLang, useStrings } from '../i18n'

const S = defineStrings({
  it: {
    title: 'Guida',
    subtitle: 'Cosa fa ogni parte di Micelio e come funziona dietro: dove finiscono i dati, in che formato, come arrivano agli altri. F1 apre la guida sulla pagina in cui ti trovi.',
    search: 'Cerca nella guida: es. dove sono i ricordi, DHT, Radici…',
    noMatch: 'Nessun argomento contiene queste parole.',
    matches: (n: number) => `${n} sezioni`
  },
  en: {
    title: 'Guide',
    subtitle: 'What every part of Micelio does and how it works underneath: where data ends up, in which format, how it reaches the others. F1 opens the guide on the page you are on.',
    search: 'Search the guide: e.g. where memories are stored, DHT, Roots…',
    noMatch: 'No topic contains these words.',
    matches: (n: number) => `${n} sections`
  }
})

/** Testo normalizzato per la ricerca (minuscolo, senza accenti). / EN: Text normalized for search (lowercase, no accents). */
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

export function Guide () {
  const s = useStrings(S)
  const { lang } = useLang()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const all = useMemo(() => topics(lang), [lang])
  const [selId, anchor] = (params.get('t') ?? 'overview').split('#')

  // Ricerca: tutte le parole devono comparire nel titolo, nell'introduzione o in una sezione
  // EN: Search: all words must appear in the title, the introduction or a section
  const words = norm(query).split(/\s+/).filter((w) => w.length > 1)
  const hits = (text: string) => words.every((w) => norm(text).includes(w))
  const list = words.length
    ? all.map((t) => ({ t, n: t.sections.filter((x) => hits(`${t.title} ${x.heading} ${x.body}`)).length + (hits(`${t.title} ${t.intro}`) ? 1 : 0) })).filter((x) => x.n > 0)
    : all.map((t) => ({ t, n: 0 }))
  const selected = all.find((t) => t.id === selId) ?? all[0]

  return (
    <>
      <PageHeader title={s.title} subtitle={s.subtitle} />
      <div className='split guide'>
        <div className='stack'>
          <input placeholder={s.search} value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className='card' style={{ padding: 6 }}>
            {list.length === 0 && <Empty>{s.noMatch}</Empty>}
            <div className='list'>
              {list.map(({ t, n }) => (
                <div key={t.id} className={`list-item clickable ${selected?.id === t.id ? 'selected' : ''}`} onClick={() => setParams({ t: t.id })}>
                  <div style={{ fontWeight: 600 }}>{t.title}</div>
                  {words.length > 0 && <div className='small muted'>{s.matches(n)}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className='card'>
          {selected && <TopicView topic={selected} anchor={selected.id === selId ? anchor : undefined} />}
        </div>
      </div>
    </>
  )
}
