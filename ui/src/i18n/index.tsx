/**
 * @file Lingua dell'interfaccia (italiano / inglese).
 *
 * EN: Interface language (Italian / English).
 *
 * COME SI USA. Ogni componente dichiara i SUOI testi accanto al codice, nelle due lingue:
 *
 * EN: HOW TO USE IT. Each component declares ITS OWN texts next to the code, in both languages:
 *
 *   const S = defineStrings({
 *     it: { title: 'Memoria del team', found: (n: number) => `${n} ricordi trovati` },
 *     en: { title: 'Team memory', found: (n: number) => `${n} memories found` }
 *   })
 *   …
 *   const s = useStrings(S)   →   <h1>{s.title}</h1> · {s.found(3)}
 *
 * `defineStrings` costringe la versione inglese ad avere ESATTAMENTE la forma di quella italiana
 * (stesse chiavi, stessi parametri): se manca un testo o una lingua, la compilazione fallisce.
 * È la garanzia che ogni funzione nuova nasca bilingue (regola di progetto).
 *
 * EN: `defineStrings` forces the English version to have EXACTLY the shape of the Italian one
 * (same keys, same parameters): if a text or a language is missing, compilation fails.
 * It guarantees that every new feature is born bilingual (project rule).
 *
 * LINGUA SCELTA. Si salva nel browser (o nell'app desktop) in `localStorage` (`micelio.lang`); la
 * prima volta si usa quella del sistema (italiano se il sistema è in italiano, altrimenti inglese).
 * Il selettore IT/EN è in fondo alla barra laterale.
 *
 * EN: CHOSEN LANGUAGE. It is saved in the browser (or the desktop app) in `localStorage` (`micelio.lang`);
 * the first time the system language is used (Italian if the system is in Italian, otherwise English).
 * The IT/EN switch is at the bottom of the sidebar.
 *
 * Le funzioni di formattazione (date, numeri: format.ts) leggono la lingua corrente con
 * `currentLang()`; il cambio di lingua fa ridisegnare tutta l'app, quindi si aggiornano anche loro.
 *
 * EN: Formatting functions (dates, numbers: format.ts) read the current language with
 * `currentLang()`; changing language re-renders the whole app, so they update too.
 */
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react'

export type Lang = 'it' | 'en'
export const LANGS: { code: Lang, label: string }[] = [{ code: 'it', label: 'IT' }, { code: 'en', label: 'EN' }]

const STORAGE_KEY = 'micelio.lang'

/** Lingua iniziale: quella salvata, altrimenti quella del sistema. / EN: Initial language: the saved one, otherwise the system one. */
export function detectLang (): Lang {
  // `#/…?lang=en` nell'indirizzo forza una lingua (catture per la documentazione, prove)
  // EN: `#/…?lang=en` in the address forces a language (screenshots for the docs, tests)
  try {
    const forced = new URLSearchParams(location.hash.split('?')[1] ?? '').get('lang')
    if (forced === 'it' || forced === 'en') return forced
  } catch { /* fuori dal browser / EN: outside the browser */ }
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'it' || saved === 'en') return saved
  } catch { /* localStorage non disponibile / EN: localStorage not available */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('it') ? 'it' : 'en'
}

/**
 * Lingua corrente per il codice fuori da React (formattazione di date e numeri, messaggi del
 * client API). Parte da "it" (anche nei test, che girano senza provider) e la imposta il provider.
 *
 * EN: Current language for code outside React (date and number formatting, API client
 * messages). Starts as "it" (also in tests, which run without a provider) and the provider sets it.
 */
let current: Lang = 'it'
export const currentLang = (): Lang => current
/** Locale per Intl/toLocaleString della lingua corrente. / EN: Locale for Intl/toLocaleString of the current language. */
export const currentLocale = (): string => (current === 'it' ? 'it-IT' : 'en-GB')

interface LangState { lang: Lang, setLang: (l: Lang) => void }
const LangContext = createContext<LangState>({ lang: 'it', setLang: () => {} })

/** Fornisce la lingua a tutta l'app. Va messo il più in alto possibile (main.tsx). / EN: Provides the language to the whole app. Place it as high as possible (main.tsx). */
export function I18nProvider ({ children, initial }: { children: ReactNode, initial?: Lang }) {
  const [lang, setState] = useState<Lang>(() => {
    const l = initial ?? detectLang()
    current = l
    // App desktop: menu dell'icona e notifiche seguono la lingua della UI
    // EN: Desktop app: the tray icon menu and notifications follow the UI language
    if (typeof window !== 'undefined') window.micelio?.setLang?.(l)
    return l
  })
  const setLang = useCallback((l: Lang) => {
    current = l
    try { localStorage.setItem(STORAGE_KEY, l) } catch { /* ignorato / EN: ignored */ }
    document.documentElement.lang = l
    window.micelio?.setLang?.(l)
    setState(l)
  }, [])
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>
}

/** Lingua corrente e funzione per cambiarla. / EN: Current language and the function to change it. */
export const useLang = (): LangState => useContext(LangContext)

/** Testi di un componente nelle due lingue: l'inglese deve avere la stessa forma dell'italiano. / EN: A component's texts in both languages: English must have the same shape as Italian. */
export function defineStrings<T> (s: { it: T, en: NoInfer<T> }): { it: T, en: T } {
  return s
}

/** I testi del componente nella lingua corrente. / EN: The component's texts in the current language. */
export function useStrings<T> (s: { it: T, en: T }): T {
  return s[useLang().lang]
}

/** Come useStrings, ma fuori da React (usa la lingua corrente globale). / EN: Like useStrings, but outside React (uses the global current language). */
export function stringsNow<T> (s: { it: T, en: T }): T {
  return s[current]
}

/**
 * Tabella di etichette che segue la lingua corrente (es. `KIND_LABEL[kind]`): un oggetto che,
 * letto, risponde con la voce della lingua attiva. Permette di tenere l'uso `TABELLA[chiave]`.
 *
 * EN: Label table that follows the current language (e.g. `KIND_LABEL[kind]`): an object that,
 * when read, answers with the entry of the active language. It keeps the `TABELLA[chiave]` usage.
 */
export function byLang<V> (tables: { it: Record<string, V>, en: Record<string, V> }): Record<string, V> {
  return new Proxy({} as Record<string, V>, {
    get: (_t, key: string) => tables[current][key],
    has: (_t, key: string) => key in tables[current],
    ownKeys: () => Reflect.ownKeys(tables[current]),
    getOwnPropertyDescriptor: (_t, key: string) => ({ enumerable: true, configurable: true, value: tables[current][key] })
  })
}

/** Selettore IT / EN (barra laterale e onboarding). / EN: IT / EN switch (sidebar and onboarding). */
export function LangSwitch () {
  const { lang, setLang } = useLang()
  return (
    <span className='lang-switch' role='group' aria-label='Lingua / Language'>
      {LANGS.map((l) => (
        <button key={l.code} className={`lang-btn ${lang === l.code ? 'on' : ''}`} aria-pressed={lang === l.code} onClick={() => setLang(l.code)}>{l.label}</button>
      ))}
    </span>
  )
}
