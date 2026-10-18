/**
 * @file Prompt e schemi dei compiti LLM di ingestione (validati nello spike B).
 *
 * I prompt sono "codice": cambiarli cambia cosa entra nel sapere del team. Dopo ogni modifica
 * va rieseguito il set di valutazione (npm run eval:ingest).
 */
import { z } from 'zod'
import { MEMORY_KINDS, ROOT_CATEGORIES } from '../core/events'

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
    tags: z.array(z.string()),
    // Riferimenti per approfondire (vedi CodeRefs in events.ts). Obbligatori nello schema, così il
    // modello li considera sempre; liste vuote quando il ricordo non riguarda codice specifico.
    // La pipeline li verifica (commit esistenti, percorsi relativi) prima di salvarli.
    files: z.array(z.string()),
    symbols: z.array(z.string()),
    commits: z.array(z.string()),
    // Suggerimento di RADICE (Fase 8): categoria se il ricordo è sapere fondante, altrimenti "none".
    // È solo un suggerimento: la promozione la decide una persona (salvo cartelle "di Radici").
    root: z.enum([...ROOT_CATEGORIES, 'none'])
  }))
})
export type Distilled = z.infer<typeof Distilled>

/**
 * Prompt di sistema della distillazione.
 * La regola di FEDELTÀ ALLA FONTE nasce da un problema reale (spike B e Fase 1): il modello
 * aggiungeva dettagli plausibili ma non presenti nella sessione.
 * @param language lingua del team (`memory.language`): "it", "en" o altro codice
 * @param maxMemories ricordi massimi per distillazione (`distill.maxMemories`, scelto dall'admin)
 */
export function distillSystem (language: string, maxMemories = 5): string {
  const lang = language === 'en' ? 'inglese' : language === 'it' ? 'italiano' : language
  return `Sei il distillatore di "Micelio", la memoria condivisa di un team di sviluppo software.
Dalla sessione estrai da 0 a ${maxMemories} ricordi atomici di conoscenza riutilizzabile dal team, dal più importante
al meno importante. Regole:
- FEDELTÀ ALLA FONTE: scrivi SOLO ciò che è detto o dimostrato nella sessione. Non aggiungere cause,
  dettagli tecnici, conseguenze o raccomandazioni che non compaiono nel testo, anche se plausibili.
- Ogni ricordo è autosufficiente: comprensibile senza la conversazione d'origine.
- Preferisci soluzioni verificate, il "perché" delle decisioni e i gotcha alla cronaca di cosa è stato fatto.
- Niente nomi di persone o clienti, niente dati personali, credenziali o segnaposto [REDACTED:...].
- La sessione può essere ANCORA IN CORSO: estrai solo ciò che è concluso o verificato (problema risolto,
  decisione presa); ignora ipotesi, tentativi aperti e lavoro a metà, verranno ripresi più avanti.
- Zero ricordi è una risposta valida e frequente: la maggior parte delle sessioni non insegna niente di
  nuovo. Non salvare cose generiche che ogni sviluppatore sa già.
- Se in fondo c'è la sezione "MODIFICHE AL CODICE" (riassunto automatico da git), usala per ricordi sulla
  STRUTTURA del codice: nuovi moduli, classi, endpoint, spostamenti di responsabilità, API rimosse. Spiega
  a cosa serve la novità usando le motivazioni presenti nella conversazione. Non fare l'elenco dei file
  toccati: solo i cambiamenti che un collega deve conoscere. Le modifiche "non ancora committate" sono lavoro
  in corso: usale solo se la conversazione le dà per concluse.
- RIFERIMENTI per approfondire (servono a chi legge per decidere se aprire il codice), per OGNI ricordo:
  files = percorsi dei file coinvolti, relativi alla radice del progetto (es. "src/orders/order.service.ts");
  symbols = classi, funzioni, metodi, endpoint o tabelle coinvolti (es. "class OrderService", "POST /orders/confirm");
  commits = hash brevi dei commit in cui è stata fatta la modifica, SOLO se compaiono nella sezione MODIFICHE AL CODICE.
  Indica solo riferimenti che compaiono nella sessione e riguardano davvero quel ricordo; liste vuote se non ce ne sono.
  Nel body cita il file o il simbolo principale quando aiuta a orientarsi.
- root: se il ricordo è sapere FONDANTE del team, che ogni sviluppatore deve conoscere e che non va mai
  dimenticato anche se si consulta di rado, indica la categoria:
  architecture (paradigmi e scelte architetturali), network (mappe di rete, infrastruttura),
  interface (interfacce applicative, contratti, API fra sistemi), domain (modello di dominio),
  practice (best practice, regole di sviluppo), policy (sicurezza, conformità), other.
  Altrimenti "none". Sii parsimonioso: la soluzione a un bug, un gotcha o una procedura puntuale NON sono Radici.
- Scrivi in ${lang}; identificatori, nomi di API, comandi e codice restano invariati.
- title: una riga autoesplicativa. body: Markdown conciso (massimo ~120 parole). tags: 1-5 tag minuscoli.
- kind: fact | howto | decision | gotcha | snippet | reference.`
}
