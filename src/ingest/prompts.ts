/**
 * @file Prompt e schemi dei compiti LLM di ingestione (validati nello spike B).
 *
 * I prompt sono "codice": cambiarli cambia cosa entra nel sapere del team. Dopo ogni modifica
 * va rieseguito il set di valutazione (npm run eval:ingest).
 */
import { z } from 'zod'
import { MEMORY_KINDS } from '../core/events'

/** Output della classificazione (Haiku). L'instradamento lo decide poi `route()` nella pipeline. */
export const Classification = z.object({
  destination: z.enum(['team', 'private', 'discard']),
  category: z.enum(['technical', 'process', 'personal', 'hr', 'commercial', 'other']),
  sensitivity: z.array(z.enum(['personal-data', 'evaluation', 'credentials', 'customer-data'])),
  reusable: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string()
})
export type Classification = z.infer<typeof Classification>

/** Prompt di sistema della classificazione. */
export const CLASSIFY_SYSTEM = `Sei il filtro d'ingresso di "Micelio", la memoria condivisa di un team di sviluppo software.
Tutto ciò che classifichi come "team" verrà distillato e replicato sui computer di TUTTI i colleghi.
Ricevi il contenuto di una sessione con un assistente AI o una nota che un utente vuole salvare. Decidi:
- "team": contiene conoscenza tecnica o di processo riutilizzabile dagli sviluppatori (soluzioni, gotcha,
  decisioni architetturali con il loro perché, procedure) e nessun dato sensibile.
- "private": contiene informazioni personali, valutazioni di persone, questioni HR o retributive, dati o
  credenziali di clienti, o comunque cose che non devono arrivare a tutto il team.
- "discard": non contiene nulla di riutilizzabile (chiacchiere, richieste banali, contenuti effimeri).
Se il contenuto è MISTO (conoscenza tecnica utile + dati sensibili) scegli "private" ma elenca i dati
sensibili in "sensitivity" e imposta "reusable": true: l'utente deciderà cosa condividere.
I segnaposto [REDACTED:...] indicano dati già rimossi: da soli non rendono il contenuto sensibile.
"confidence" è la tua sicurezza nella decisione, tra 0 e 1.`

/** Output della distillazione (Sonnet): da 0 a N ricordi atomici. */
export const Distilled = z.object({
  memories: z.array(z.object({
    kind: z.enum(MEMORY_KINDS),
    title: z.string(),
    body: z.string(),
    tags: z.array(z.string())
  }))
})
export type Distilled = z.infer<typeof Distilled>

/**
 * Prompt di sistema della distillazione.
 * La regola di FEDELTÀ ALLA FONTE nasce da un problema reale (spike B e Fase 1): il modello
 * aggiungeva dettagli plausibili ma non presenti nella sessione.
 * @param language lingua del team (`memory.language`): "it", "en" o altro codice
 */
export function distillSystem (language: string): string {
  const lang = language === 'en' ? 'inglese' : language === 'it' ? 'italiano' : language
  return `Sei il distillatore di "Micelio", la memoria condivisa di un team di sviluppo software.
Dalla sessione estrai da 0 a 5 ricordi atomici di conoscenza riutilizzabile dal team. Regole:
- FEDELTÀ ALLA FONTE: scrivi SOLO ciò che è detto o dimostrato nella sessione. Non aggiungere cause,
  dettagli tecnici, conseguenze o raccomandazioni che non compaiono nel testo, anche se plausibili.
- Ogni ricordo è autosufficiente: comprensibile senza la conversazione d'origine.
- Preferisci soluzioni verificate, il "perché" delle decisioni e i gotcha alla cronaca di cosa è stato fatto.
- Niente nomi di persone o clienti, niente dati personali, credenziali o segnaposto [REDACTED:...].
- La sessione può essere ANCORA IN CORSO: estrai solo ciò che è concluso o verificato (problema risolto,
  decisione presa); ignora ipotesi, tentativi aperti e lavoro a metà, verranno ripresi più avanti.
- Zero ricordi è una risposta valida e frequente: la maggior parte delle sessioni non insegna niente di
  nuovo. Non salvare cose generiche che ogni sviluppatore sa già.
- Scrivi in ${lang}; identificatori, nomi di API, comandi e codice restano invariati.
- title: una riga autoesplicativa. body: Markdown conciso (massimo ~120 parole). tags: 1-5 tag minuscoli.
- kind: fact | howto | decision | gotcha | snippet | reference.`
}
