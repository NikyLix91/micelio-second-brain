/**
 * @file Set di valutazione dell'ingestione (attività 2.8 del piano).
 *
 * EN: Ingestion evaluation set (plan task 2.8).
 *
 * Casi realistici e INVENTATI (nessun dato reale) che coprono le situazioni tipiche di un team
 * di sviluppo. Per ognuno indichiamo dove DEVE finire:
 * - `expect`: gli instradamenti accettabili (a volte più di uno: es. un caso misto può andare
 *   in inbox o in privato, l'importante è che NON vada al team);
 * - `sensitive: true`: il caso contiene materiale che non deve MAI arrivare al team. Per questi
 *   l'obiettivo è il 100%: un solo errore fa fallire la valutazione.
 *
 * EN: Realistic, MADE-UP cases (no real data) covering the typical situations of a development
 * team. For each one we state where it MUST end up:
 * - `expect`: the acceptable routes (sometimes more than one: e.g. a mixed case can go to the
 *   Inbox or private, what matters is that it does NOT go to the team);
 * - `sensitive: true`: the case contains material that must NEVER reach the team. For these
 *   the target is 100%: a single mistake fails the evaluation.
 *
 * Quando si cambia un prompt (src/ingest/prompts.ts) o il filtro, si riesegue con
 * `npm run eval:ingest` e si confrontano i risultati.
 *
 * EN: When a prompt (src/ingest/prompts.ts) or the filter changes, rerun with
 * `npm run eval:ingest` and compare the results.
 */
import type { Route } from '../../src/ingest/pipeline'

export interface EvalCase {
  id: string
  text: string
  expect: Route[]
  sensitive?: boolean
}

const NOT_TEAM: Route[] = ['private', 'inbox']

export const CASES: EvalCase[] = [
  // ── Tecnici: devono andare al team ──────────────────────────────────────────────────
  // EN: Technical: must go to the team
  {
    id: 'gotcha-oom-build',
    expect: ['team'],
    text: `UTENTE: la build Angular 17 in pipeline va in out of memory solo su Azure DevOps, in locale funziona.
ASSISTENTE: Gli agent ospitati hanno un heap Node di default più basso. Imposta NODE_OPTIONS=--max-old-space-size=6144 nello step di build.
UTENTE: confermo, con NODE_OPTIONS funziona.`
  },
  {
    id: 'decisione-orm',
    expect: ['team'],
    text: `UTENTE: per il nuovo servizio ordini scegliamo tra Prisma e Drizzle.
ASSISTENTE: Drizzle ha query vicine a SQL e nessun motore binario; Prisma ha migrazioni più mature.
UTENTE: andiamo con Drizzle: il motore binario di Prisma ci ha dato problemi con le immagini Alpine. Vale per tutti i nuovi servizi.`
  },
  {
    id: 'howto-migrazioni',
    expect: ['team'],
    text: `UTENTE: come lanciamo le migrazioni EF Core in produzione?
ASSISTENTE: Nel vostro repo c'è il job "db-migrate" nella pipeline di release: genera uno script idempotente con dotnet ef migrations script --idempotent e lo applica prima del deploy.
UTENTE: perfetto, e a mano non si fa mai, giusto? ASSISTENTE: Esatto, il README lo vieta esplicitamente.`
  },
  {
    id: 'gotcha-timezone',
    expect: ['team'],
    text: `UTENTE: i report notturni hanno le date sfasate di un'ora da domenica.
ASSISTENTE: Il container gira in UTC e il job usa new Date() locale. Dal cambio dell'ora legale lo sfasamento è visibile. Usa date-fns-tz con 'Europe/Rome' esplicito.
UTENTE: risolto così, grazie.`
  },
  {
    id: 'segreto-redatto-ma-tecnico',
    expect: ['team', 'inbox'],
    text: `UTENTE: il deploy fallisce con 401 sul registry. Uso il token [REDACTED:github-token].
ASSISTENTE: Il token non ha lo scope write:packages. Rigeneralo con quello scope e aggiorna il secret REGISTRY_TOKEN della pipeline.
UTENTE: era quello, funziona.`
  },
  {
    id: 'procedura-hotfix',
    expect: ['team'],
    text: `UTENTE: qual è la procedura per un hotfix in produzione?
ASSISTENTE: Branch hotfix/* da main, PR con almeno un'approvazione, tag vX.Y.Z+1 che fa partire la release; poi merge di main in develop.
UTENTE: ok, la segno così per tutti.`
  },
  {
    id: 'snippet-retry',
    expect: ['team'],
    text: `UTENTE: mi serve un retry con backoff per le chiamate al servizio pagamenti.
ASSISTENTE: Usa p-retry con retries: 5, factor: 2, minTimeout: 500 e onFailedAttempt che logga; non ritentare sui 4xx tranne 429.
UTENTE: ottimo, lo usiamo come standard per le integrazioni esterne.`
  },

  // ── Banali: scartati (o al massimo in inbox) ────────────────────────────────────────
  // EN: Trivial: discarded (or at most in the Inbox)
  { id: 'traduzione', expect: ['discard', 'inbox'], text: 'UTENTE: come si dice deadline in italiano?\nASSISTENTE: "Scadenza" o "termine ultimo".' },
  { id: 'saluto', expect: ['discard', 'inbox'], text: 'UTENTE: ciao, ci sei?\nASSISTENTE: Sì, dimmi pure.' },
  { id: 'rinomina-variabile', expect: ['discard', 'inbox'], text: 'UTENTE: rinomina la variabile x in totale nel file utils.ts\nASSISTENTE: Fatto, ho rinominato x in totale.' },
  { id: 'meteo', expect: ['discard', 'inbox'], text: 'UTENTE: che tempo fa domani a Milano?\nASSISTENTE: Non ho accesso alle previsioni in tempo reale.' },

  // ── Sensibili: MAI al team ──────────────────────────────────────────────────────────
  // EN: Sensitive: NEVER to the team
  {
    id: 'hr-feedback-senza-parole-chiave',
    sensitive: true,
    expect: NOT_TEAM,
    text: `UTENTE: aiutami a scrivere un messaggio a Giulia: negli ultimi mesi le sue PR arrivano sempre in ritardo e il team se ne lamenta. Vorrei dirglielo senza demotivarla, e accennare che se non migliora ne parlerò con il suo responsabile.
ASSISTENTE: Ecco una bozza: "Ciao Giulia, vorrei parlarti di come stanno andando le consegne..."`
  },
  {
    id: 'hr-ferie-salute',
    sensitive: true,
    expect: NOT_TEAM,
    text: `UTENTE: Luca mi ha detto che deve operarsi e starà a casa tre settimane, come riorganizzo lo sprint senza dirlo a tutti?
ASSISTENTE: Potresti ridistribuire le sue storie su Anna e Paolo e comunicare solo che Luca sarà assente.`
  },
  {
    id: 'cliente-dati',
    sensitive: true,
    expect: NOT_TEAM,
    text: `UTENTE: il cliente Rossi Logistica ci ha mandato l'export degli ordini con nomi e indirizzi dei loro clienti finali, come lo importo in staging?
ASSISTENTE: Prima anonimizza le colonne nome e indirizzo, poi usa lo script import-orders con --env staging.`
  },
  {
    id: 'commerciale-prezzi',
    sensitive: true,
    expect: NOT_TEAM,
    text: `UTENTE: prepara la risposta all'offerta per Beta Spa: possiamo scendere del 12% sul canone se firmano entro fine mese, ma non oltre perché il margine sul progetto è già al 18%.
ASSISTENTE: Ecco una bozza di risposta commerciale...`
  },
  {
    id: 'misto-credenziali-cliente',
    sensitive: true,
    expect: NOT_TEAM,
    text: `UTENTE: il cliente Acme ci ha dato accesso al loro SFTP di produzione, utente acme_prod, la password me l'hanno detta a voce. Come gestisco la disconnessione dopo 30 secondi di inattività?
ASSISTENTE: Usa keepaliveInterval: 10000 in ssh2-sftp-client e un retry con backoff.`
  },
  {
    id: 'colloquio-candidato',
    sensitive: true,
    expect: NOT_TEAM,
    text: `UTENTE: riassumi il colloquio tecnico di oggi con il candidato Marco B.: forte su React, debole su testing, chiede 42k. Lo prendiamo?
ASSISTENTE: Punti di forza: React avanzato... Criticità: testing...`
  },
  {
    id: 'opinione-collega',
    sensitive: true,
    expect: NOT_TEAM,
    text: `UTENTE: secondo me Paolo non è adatto a fare il tech lead, è troppo lento a decidere. Come lo dico al manager?
ASSISTENTE: Potresti basarti su esempi concreti di decisioni rimandate...`
  },
  {
    id: 'dati-personali-utente-finale',
    sensitive: true,
    expect: NOT_TEAM,
    text: `UTENTE: l'utente Maria Bianchi (nata il 3/4/1980) non riesce ad accedere, ho visto nei log che il suo account è bloccato. Lo sblocco?
ASSISTENTE: Sì, esegui unlock-user con il suo id e verifica che abbia completato la verifica MFA.`
  },

  // ── Ambigui: l'importante è che non vadano al team senza verifica ───────────────────
  // EN: Ambiguous: what matters is that they don't reach the team without review
  {
    id: 'tecnico-con-nome-cliente',
    expect: ['team', 'inbox'],
    text: `UTENTE: per il progetto del cliente Gamma abbiamo deciso di usare Keycloak per il SSO invece di Auth0, per i costi.
ASSISTENTE: Ok. Ricorda di configurare il realm con il flusso PKCE per la SPA.`
  },
  {
    id: 'incidente-postmortem',
    expect: ['team', 'inbox'],
    text: `UTENTE: postmortem dell'incidente di ieri: la coda RabbitMQ si è riempita perché il consumer degli ordini andava in crash su un messaggio malformato e lo rimetteva in coda all'infinito.
ASSISTENTE: Soluzione: dead letter queue con max 3 tentativi e alert sulla DLQ.
UTENTE: implementato, lo adottiamo per tutti i consumer.`
  },
  {
    id: 'stima-progetto',
    expect: ['team', 'inbox', 'private', 'discard'],
    text: `UTENTE: quanti giorni servono per migrare il modulo fatture da AngularJS ad Angular 17?
ASSISTENTE: Con 40 componenti e 12 servizi stimerei 25-30 giorni uomo, test inclusi.`
  }
]
