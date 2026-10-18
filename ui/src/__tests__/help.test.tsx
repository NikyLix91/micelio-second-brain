/**
 * Guida in linea (B2): contenuti completi e allineati nelle due lingue, ogni «?» della UI punta
 * a un argomento e a una sezione che esistono, pannello laterale e pagina Guida funzionanti.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { PAGE_TOPIC } from '../App'
import { HelpButton, HelpProvider, parseTopic, topic, TOPIC_ORDER, topics } from '../help'
import { I18nProvider } from '../i18n'
import { Guide } from '../pages/Guide'

// Sorgenti delle schermate come testo: servono a trovare tutti i riferimenti help='…' / topic='…'
const SOURCES = import.meta.glob(['../**/*.tsx', '!../__tests__/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Verifica che "argomento#ancora" esista in entrambe le lingue. */
function resolves (ref: string): boolean {
  const [id, anchor] = ref.split('#')
  return (['it', 'en'] as const).every((lang) => {
    const t = topic(lang, id)
    return t !== null && (!anchor || t.sections.some((s) => s.id === anchor))
  })
}

describe('guida in linea', () => {
  afterEach(() => { cleanup(); localStorage.clear() })

  it('ogni argomento esiste in italiano e in inglese, con le stesse sezioni', () => {
    for (const lang of ['it', 'en'] as const) expect(topics(lang).map((t) => t.id)).toEqual([...TOPIC_ORDER])
    for (const id of TOPIC_ORDER) {
      const it = topic('it', id)!
      const en = topic('en', id)!
      // stesse ancore nello stesso ordine: i «?» funzionano in tutte e due le lingue
      expect(en.sections.map((s) => s.id), id).toEqual(it.sections.map((s) => s.id))
      for (const t of [it, en]) {
        expect(t.title, id).not.toBe(id) // il titolo # c'è
        expect(t.intro.length, id).toBeGreaterThan(20)
        expect(t.sections.length, id).toBeGreaterThan(0)
        for (const s of t.sections) expect(s.body.length, `${id}#${s.id}`).toBeGreaterThan(20)
      }
    }
  })

  it('ogni «?» e ogni F1 puntano a un argomento e a una sezione esistenti', () => {
    const refs = new Set<string>(Object.values(PAGE_TOPIC))
    for (const src of Object.values(SOURCES)) {
      for (const m of src.matchAll(/\b(?:help|topic)=['"]([a-z0-9#-]+)['"]/g)) refs.add(m[1])
    }
    expect(refs.size).toBeGreaterThan(30) // le schermate sono coperte davvero
    for (const ref of refs) expect(resolves(ref), ref).toBe(true)
  })

  it('parseTopic: titolo, introduzione, sezioni con ancora; CRLF accettato', () => {
    const t = parseTopic('x', '# Titolo\r\n\r\nIntro.\r\n\r\n## Prima {#uno}\r\nTesto 1.\r\n\r\n## Seconda {#due}\r\nTesto 2.\r\n')
    expect(t).toEqual({
      id: 'x',
      title: 'Titolo',
      intro: 'Intro.',
      sections: [{ id: 'uno', heading: 'Prima', body: 'Testo 1.' }, { id: 'due', heading: 'Seconda', body: 'Testo 2.' }]
    })
  })

  it('il «?» apre il pannello sulla sezione giusta, nella lingua scelta; Esc lo chiude', () => {
    render(
      <I18nProvider initial='en'>
        <MemoryRouter><HelpProvider><HelpButton topic='roots#review' /></HelpProvider></MemoryRouter>
      </I18nProvider>
    )
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Open the guide' })) })
    const drawer = screen.getByRole('dialog', { name: 'Guide' })
    expect(drawer.querySelector('.help-section.focus')?.getAttribute('data-anchor')).toBe('review')
    expect(drawer.textContent).toContain('Roots')
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('pagina Guida: indice, ricerca, argomento da indirizzo', () => {
    render(
      <I18nProvider initial='it'>
        <MemoryRouter initialEntries={['/guida?t=p2p%23discovery']}><HelpProvider><Guide /></HelpProvider></MemoryRouter>
      </I18nProvider>
    )
    expect(document.querySelector('.help-section.focus')?.getAttribute('data-anchor')).toBe('discovery')
    expect(document.querySelectorAll('.list-item').length).toBe(TOPIC_ORDER.length)
    act(() => { fireEvent.change(screen.getByPlaceholderText(/Cerca nella guida/), { target: { value: 'hyperbee' } }) })
    const found = document.querySelectorAll('.list-item').length
    expect(found).toBeGreaterThan(0)
    expect(found).toBeLessThan(TOPIC_ORDER.length)
    act(() => { fireEvent.change(screen.getByPlaceholderText(/Cerca nella guida/), { target: { value: 'zzzqqq' } }) })
    expect(screen.getByText('Nessun argomento contiene queste parole.')).toBeTruthy()
  })
})
