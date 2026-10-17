// Spike B — Classificazione privacy + distillazione su casi realistici.
// Uso: node run.mjs [modello-classificazione] [modello-distillazione]
import { z } from 'zod'
import { runClaude } from './adapter.mjs'

const classifyModel = process.argv[2] || 'haiku'
const distillModel = process.argv[3] || 'sonnet'

const Classification = z.object({
  destination: z.enum(['team', 'private', 'discard']),
  category: z.enum(['technical', 'process', 'personal', 'hr', 'commercial', 'other']),
  sensitivity: z.array(z.enum(['personal-data', 'evaluation', 'credentials', 'customer-data'])),
  reusable: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string()
})

const CLASSIFY_SYSTEM = `Sei il filtro d'ingresso di "Micelio", la memoria condivisa di un team di sviluppo software.
Ricevi il contenuto di una sessione con un assistente AI o di un documento. Decidi dove deve andare:
- "team": contiene conoscenza tecnica o di processo riutilizzabile dagli sviluppatori (soluzioni, gotcha, decisioni architetturali, procedure).
- "private": contiene informazioni personali, valutazioni di persone, questioni HR, dati di clienti, o comunque cose che non devono arrivare a tutto il team.
- "discard": non contiene nulla di riutilizzabile (chiacchiere, richieste banali, contenuti effimeri).
Se il contenuto è misto (conoscenza tecnica + dati sensibili), scegli "private": sarà l'utente a decidere.
"sensitivity" elenca i tipi di dati sensibili presenti. "confidence" è la tua sicurezza nella decisione.`

const Distilled = z.object({
  memories: z.array(z.object({
    kind: z.enum(['fact', 'howto', 'decision', 'gotcha', 'snippet', 'reference']),
    title: z.string(),
    body: z.string(),
    tags: z.array(z.string())
  }))
})

const DISTILL_SYSTEM = `Sei il distillatore di "Micelio", la memoria condivisa di un team di sviluppo.
Dalla sessione estrai 0..N ricordi atomici di conoscenza riutilizzabile. Regole:
- ogni ricordo è autosufficiente: comprensibile senza la conversazione d'origine;
- preferisci il "perché" e i gotcha alla cronaca; niente riferimenti a persone o clienti;
- zero ricordi è una risposta valida se la sessione non insegna niente di nuovo;
- scrivi in italiano; identificatori, API e codice restano invariati;
- body in Markdown, conciso (max ~120 parole).`

const CASES = [
  {
    id: 'hr-mail',
    expect: 'private',
    text: `Utente: aiutami a scrivere la mail di valutazione di fine anno per Marco Rossi. È stato puntuale ma ha avuto problemi
nelle code review, spesso difensivo. Vorrei proporre un aumento contenuto, RAL da 34k a 36k.
Assistente: Ecco una bozza: "Caro Marco, quest'anno hai dimostrato affidabilità nelle consegne..."`
  },
  {
    id: 'gotcha-tecnico',
    expect: 'team',
    text: `Utente: la build Angular 17 in pipeline va in out of memory solo su Azure DevOps, in locale funziona.
Assistente: Gli agent ospitati hanno heap Node di default più basso. Imposta NODE_OPTIONS=--max-old-space-size=6144 nello step di build.
Inoltre con "budgets" troppo stretti in angular.json la build fallisce in modo diverso: controlla prima il log.
Utente: confermo, con NODE_OPTIONS funziona. Il budget non c'entrava.`
  },
  {
    id: 'misto',
    expect: 'private',
    text: `Utente: il cliente Acme ci ha passato le credenziali del loro SFTP (user acme_prod, pwd Xk!92aa) per l'integrazione.
Come gestisco il retry quando il server SFTP chiude la connessione dopo 30s di inattività?
Assistente: Usa keepalive con ssh2-sftp-client (option keepaliveInterval: 10000) e un retry con backoff esponenziale.`
  },
  {
    id: 'banale',
    expect: 'discard',
    text: `Utente: come si dice "deadline" in italiano?
Assistente: "Scadenza" o "termine ultimo".`
  },
  {
    id: 'decisione',
    expect: 'team',
    text: `Utente: dobbiamo scegliere tra Prisma e Drizzle per il nuovo servizio ordini su Postgres.
Assistente: Drizzle ha query più vicine a SQL e nessun motore binario; Prisma ha migrazioni più mature.
Utente: andiamo con Drizzle, il motore binario di Prisma ci ha dato problemi con le immagini Alpine in passato. Lo usiamo per tutti i nuovi servizi.`
  }
]

let correct = 0
const toDistill = []
console.log(`== Classificazione (modello: ${classifyModel})`)
for (const c of CASES) {
  try {
    const { data, ms, model } = await runClaude({ system: CLASSIFY_SYSTEM, input: c.text, schema: Classification, model: classifyModel })
    const ok = data.destination === c.expect
    if (ok) correct++
    if (data.destination === 'team') toDistill.push(c)
    console.log(`${ok ? '✔' : '✘'} ${c.id.padEnd(15)} → ${data.destination.padEnd(8)} (atteso ${c.expect}) conf=${data.confidence} sens=[${data.sensitivity}] ${ms}ms ${model}`)
    console.log(`    ${data.reason}`)
  } catch (err) {
    console.log(`✘ ${c.id}: ${err.message.slice(0, 300)}`)
  }
}
console.log(`Corretti: ${correct}/${CASES.length}`)

console.log(`\n== Distillazione (modello: ${distillModel}) dei casi instradati a "team"`)
for (const c of toDistill) {
  try {
    const { data, ms } = await runClaude({ system: DISTILL_SYSTEM, input: c.text, schema: Distilled, model: distillModel })
    console.log(`-- ${c.id}: ${data.memories.length} ricordi in ${ms}ms`)
    for (const m of data.memories) console.log(`   [${m.kind}] ${m.title}  #${m.tags.join(' #')}\n     ${m.body.replace(/\n/g, '\n     ')}`)
  } catch (err) {
    console.log(`✘ ${c.id}: ${err.message.slice(0, 300)}`)
  }
}
