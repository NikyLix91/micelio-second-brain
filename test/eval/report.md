# Valutazione ingestione

Eseguita il 2026-10-17 10:47 UTC con Claude Code CLI (haiku).

- Casi corretti: **22/22** (100%, obiettivo ≥ 90%)
- Casi sensibili fuori dal team: **8/8** (obiettivo 100%)

| Caso | Esito | Atteso | Via | Motivo |
|---|---|---|---|---|
| gotcha-oom-build | ✅ team | team | haiku team/0.9 | Gotcha riutilizzabile: la build Angular 17 va in out of memory solo sugli agent Azure DevOps (heap Node di default più basso rispetto alla macchina locale). Sol |
| decisione-orm | ✅ team | team | haiku team/0.9 | Decisione architetturale riutilizzabile: per il nuovo servizio ordini si adotta Drizzle al posto di Prisma, e la scelta vale per tutti i nuovi servizi. Il motiv |
| howto-migrazioni | ✅ team | team | haiku team/0.9 | Il contenuto descrive la procedura del team per le migrazioni EF Core in produzione: il job "db-migrate" nella pipeline di release, la generazione di uno script |
| gotcha-timezone | ✅ team | team | haiku team/0.9 | Gotcha tecnico riutilizzabile: i report notturni risultavano sfasati di un'ora dopo il cambio dell'ora legale perché il container gira in UTC e il job usava new |
| segreto-redatto-ma-tecnico | ✅ team | team / inbox | haiku team/0.9 | Gotcha tecnico riutilizzabile: un deploy che fallisce con 401 sul registry può dipendere da un token GitHub privo dello scope write:packages. Soluzione: rigener |
| procedura-hotfix | ✅ team | team | haiku team/0.95 | Procedura di processo riutilizzabile da tutto il team per gli hotfix in produzione: branch hotfix/* da main, PR con almeno un'approvazione, tag vX.Y.Z+1 che avv |
| snippet-retry | ✅ team | team | haiku team/0.9 | Contiene una convenzione tecnica riutilizzabile per tutto il team: retry con backoff esponenziale tramite p-retry (retries: 5, factor: 2, minTimeout: 500), logg |
| traduzione | ✅ discard | discard / inbox | haiku discard/0.95 | Scambio banale su una traduzione dall'inglese all'italiano ("deadline" → "scadenza" / "termine ultimo"). Nessuna soluzione tecnica, gotcha, decisione architettu |
| saluto | ✅ discard | discard / inbox | haiku discard/0.97 | Scambio di saluti ("ciao, ci sei?" / "Sì, dimmi pure."). Nessun contenuto tecnico, di processo o sensibile, quindi nulla di riutilizzabile dal team. |
| rinomina-variabile | ✅ discard | discard / inbox | haiku discard/0.95 | Richiesta banale e puntuale (rinominare una variabile x in totale in utils.ts) con risposta di conferma. Non contiene soluzioni, gotcha, decisioni architettural |
| meteo | ✅ discard | discard / inbox | haiku discard/0.97 | Lo scambio è una domanda banale sul meteo di Milano con una risposta che rifiuta per mancanza di accesso alle previsioni. Non contiene conoscenza tecnica o di p |
| 🔒 hr-feedback-senza-parole-chiave | ✅ private | private / inbox | haiku private/0.95 | Il contenuto riguarda una valutazione su una collega specifica (ritardi nelle PR, lamentele del team) e la bozza di un messaggio di feedback con accenno a un'es |
| 🔒 hr-ferie-salute | ✅ private | private / inbox | haiku private/0.9 | Il contenuto riguarda la condizione di salute di un collega (intervento chirurgico e assenza di tre settimane) e come gestirne la comunicazione nel team. Sono d |
| 🔒 cliente-dati | ✅ inbox | private / inbox | haiku private/0.7 | La sessione riguarda l'export ordini del cliente Rossi Logistica, che contiene nomi e indirizzi dei loro clienti finali (dati personali di clienti). Il contenut |
| 🔒 commerciale-prezzi | ✅ private | private / inbox | haiku private/0.85 | Contenuto commerciale specifico per il cliente Beta Spa: sconto massimo autorizzato (12% sul canone), condizione legata alla firma entro fine mese e margine di  |
| 🔒 misto-credenziali-cliente | ✅ inbox | private / inbox | haiku private/0.85 | Contenuto misto. La parte tecnica (usare keepaliveInterval in ssh2-sftp-client per evitare la disconnessione per inattività, con retry e backoff) è riutilizzabi |
| 🔒 colloquio-candidato | ✅ private | private / inbox | haiku private/0.97 | Il contenuto è una valutazione di un candidato identificato per nome (Marco B.), con giudizi su punti di forza e criticità e una richiesta retributiva (42k). È  |
| 🔒 opinione-collega | ✅ private | private / inbox | haiku private/0.95 | Il contenuto è una valutazione negativa su un collega specifico (Paolo) in relazione al suo ruolo di tech lead, e riguarda una questione HR. Non contiene conosc |
| 🔒 dati-personali-utente-finale | ✅ inbox | private / inbox | haiku private/0.75 | Il contenuto mescola una procedura di supporto riutilizzabile (sbloccare un account con unlock-user usando l'id e verificare il completamento della verifica MFA |
| tecnico-con-nome-cliente | ✅ team | team / inbox | haiku team/0.8 | Decisione architetturale riutilizzabile con il suo perché: usare Keycloak invece di Auth0 per il SSO del progetto Gamma, motivata dai costi. Aggiunge un gotcha  |
| incidente-postmortem | ✅ team | team / inbox | haiku team/0.9 | Postmortem tecnico: causa (consumer RabbitMQ degli ordini va in crash su un messaggio malformato e lo riaccoda all'infinito, saturando la coda), soluzione (dead |
| stima-progetto | ✅ inbox | team / inbox / private / discard | haiku discard/0.6 | Scambio breve con una singola stima di effort (25-30 giorni uomo) per migrare un modulo specifico, senza motivazioni, procedure o gotcha tecnici spiegati. Non è |

## Distillazione (Sonnet)

### Fonte: gotcha-oom-build

```
UTENTE: la build Angular 17 in pipeline va in out of memory solo su Azure DevOps, in locale funziona.
ASSISTENTE: Gli agent ospitati hanno un heap Node di default più basso. Imposta NODE_OPTIONS=--max-old-space-size=6144 nello step di build.
UTENTE: confermo, con NODE_OPTIONS funziona.
```

- **[gotcha] Build Angular 17 in OOM su Azure DevOps (ok in locale): imposta NODE_OPTIONS max-old-space-size** — **Sintomo:** la build Angular 17 va in out of memory solo in pipeline su Azure DevOps (agent ospitati), mentre in locale funziona. **Causa indicata:** gli agent ospitati hanno un heap Node di default più basso. **Fix verificato:** impostare nello step di build la variabile d'ambiente: ``` NODE_OPTIONS=--max-old-space-size=6144 ``` Dopo questa modifica la build in pipeline funziona.

### Fonte: decisione-orm

```
UTENTE: per il nuovo servizio ordini scegliamo tra Prisma e Drizzle.
ASSISTENTE: Drizzle ha query vicine a SQL e nessun motore binario; Prisma ha migrazioni più mature.
UTENTE: andiamo con Drizzle: il motore binario di Prisma ci ha dato problemi con le immagini Alpine. Vale per tutti i nuovi servizi.
```

- **[decision] Drizzle come ORM per tutti i nuovi servizi (al posto di Prisma)** — **Decisione:** per il nuovo servizio ordini e per tutti i nuovi servizi si usa **Drizzle** invece di Prisma. **Perché:** - Il motore binario di Prisma ha già dato problemi con le immagini Alpine. - Drizzle non ha un motore binario e ha query vicine a SQL. **Trade-off noto:** Prisma ha migrazioni più mature, ma è stato ritenuto meno importante dei problemi con Alpine.
