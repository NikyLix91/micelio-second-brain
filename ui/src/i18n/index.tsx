/**
 * @file Lingua dell'interfaccia (italiano / inglese).
 *
 * COME SI USA. Ogni componente dichiara i SUOI testi accanto al codice, nelle due lingue:
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
 * LINGUA SCELTA. Si salva nel browser (o nell'app desktop) in `localStorage` (`micelio.lang`); la
 * prima volta si usa quella del sistema (italiano se il sistema è in italiano, altrimenti inglese).
 * Il selettore IT/EN è in fondo alla barra laterale.
 *
 * Le funzioni di formattazione (date, numeri: format.ts) leggono la lingua corrente con
 * `currentLang()`; il cambio di lingua fa ridisegnare tutta l'app, quindi si aggiornano anche loro.
 */
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react'

export type Lang = 'it' | 'en'
export const LANGS: { code: Lang, label: string }[] = [{ code: 'it', label: 'IT' }, { code: 'en', label: 'EN' }]

const STORAGE_KEY = 'micelio.lang'

/** Lingua iniziale: quella salvata, altrimenti quella del sistema. */
export function detectLang (): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'it' || saved === 'en') return saved
  } catch { /* localStorage non disponibile */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('it') ? 'it' : 'en'
}

/**
 * Lingua corrente per il codice fuori da React (formattazione di date e numeri, messaggi del
 * client API). Parte da "it" (anche nei test, che girano senza provider) e la imposta il provider.
 */
let current: Lang = 'it'
export const currentLang = (): Lang => current
/** Locale per Intl/toLocaleString della lingua corrente. */
export const currentLocale = (): string => (current === 'it' ? 'it-IT' : 'en-GB')

interface LangState { lang: Lang, setLang: (l: Lang) => void }
const LangContext = createContext<LangState>({ lang: 'it', setLang: () => {} })

/** Fornisce la lingua a tutta l'app. Va messo il più in alto possibile (main.tsx). */
export function I18nProvider ({ children, initial }: { children: ReactNode, initial?: Lang }) {
  const [lang, setState] = useState<Lang>(() => {
    const l = initial ?? detectLang()
    current = l
    return l
  })
  const setLang = useCallback((l: Lang) => {
    current = l
    try { localStorage.setItem(STORAGE_KEY, l) } catch { /* ignorato */ }
    document.documentElement.lang = l
    setState(l)
  }, [])
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>
}

/** Lingua corrente e funzione per cambiarla. */
export const useLang = (): LangState => useContext(LangContext)

/** Testi di un componente nelle due lingue: l'inglese deve avere la stessa forma dell'italiano. */
export function defineStrings<T> (s: { it: T, en: NoInfer<T> }): { it: T, en: T } {
  return s
}

/** I testi del componente nella lingua corrente. */
export function useStrings<T> (s: { it: T, en: T }): T {
  return s[useLang().lang]
}

/** Come useStrings, ma fuori da React (usa la lingua corrente globale). */
export function stringsNow<T> (s: { it: T, en: T }): T {
  return s[current]
}

/**
 * Tabella di etichette che segue la lingua corrente (es. `KIND_LABEL[kind]`): un oggetto che,
 * letto, risponde con la voce della lingua attiva. Permette di tenere l'uso `TABELLA[chiave]`.
 */
export function byLang<V> (tables: { it: Record<string, V>, en: Record<string, V> }): Record<string, V> {
  return new Proxy({} as Record<string, V>, {
    get: (_t, key: string) => tables[current][key],
    has: (_t, key: string) => key in tables[current],
    ownKeys: () => Reflect.ownKeys(tables[current]),
    getOwnPropertyDescriptor: (_t, key: string) => ({ enumerable: true, configurable: true, value: tables[current][key] })
  })
}

/** Selettore IT / EN (barra laterale e onboarding). */
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
