/**
 * Lingua dell'interfaccia (B1): selettore IT/EN, scelta ricordata, testi e formattazione che
 * seguono la lingua, tabelle di etichette, didascalia del tour.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTokenForTests } from '../api/auth'
import { bytes, KIND_LABEL } from '../format'
import { defineStrings, detectLang, I18nProvider, LangSwitch, useStrings } from '../i18n'
import { caption } from '../pages/nucleus/tour'
import { Private } from '../pages/Private'

const S = defineStrings({ it: { hello: (n: string) => `Ciao ${n}` }, en: { hello: (n: string) => `Hello ${n}` } })
function Hello () { return <p>{useStrings(S).hello('Ada')}</p> }

describe('lingua', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

  it('il selettore cambia i testi, la formattazione e le etichette; la scelta si ricorda', () => {
    render(<I18nProvider initial='it'><LangSwitch /><Hello /></I18nProvider>)
    expect(screen.getByText('Ciao Ada')).toBeTruthy()
    expect(bytes(4.4 * 1024 * 1024)).toBe('4,4 MB')
    expect(KIND_LABEL.howto).toBe('procedura')

    act(() => { fireEvent.click(screen.getByText('EN')) })
    expect(screen.getByText('Hello Ada')).toBeTruthy()
    expect(bytes(4.4 * 1024 * 1024)).toBe('4.4 MB')
    expect(KIND_LABEL.howto).toBe('how-to')
    expect(Object.keys(KIND_LABEL)).toContain('gotcha')
    expect(localStorage.getItem('micelio.lang')).toBe('en')
    expect(detectLang()).toBe('en')
    act(() => { fireEvent.click(screen.getByText('IT')) }) // ripristina per gli altri test
  })

  it('una schermata intera in inglese', async () => {
    setTokenForTests('tok')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('[]'))
    render(
      <I18nProvider initial='en'>
        <QueryClientProvider client={new QueryClient()}><MemoryRouter><Private /></MemoryRouter></QueryClientProvider>
      </I18nProvider>
    )
    expect(await screen.findByText('Private log')).toBeTruthy()
    expect(await screen.findByText('The log is empty.')).toBeTruthy()
    act(() => { localStorage.setItem('micelio.lang', 'it') })
  })

  it('didascalia del tour nelle due lingue', () => {
    const stop = { topic: 'ci', ids: ['a', 'b', 'c'], authors: ['Ada', 'Bo', 'Cy', 'Di'], kinds: ['gotcha'] }
    expect(caption(stop, (k) => k)).toBe('3 ricordi · di Ada, Bo e altri 2 · soprattutto gotcha')
    expect(caption(stop, (k) => k, 'en')).toBe('3 memories · by Ada, Bo and 2 more · mostly gotcha')
  })
})
