# Micelio — Piano di lavoro

> Documento vivo: viene aggiornato a ogni avanzamento. Design di riferimento: [DESIGN.md](DESIGN.md). Indice della documentazione: [README.md](README.md).
> Ultimo aggiornamento: **2026-10-17**. Fasi 0–6 completate, Fase 7 parziale. In attesa di revisione dopo il lavoro in autonomia.

## Stato

| Fase | Obiettivo | Stato |
|---|---|---|
| 0 — Spike | Ridurre i rischi tecnici | ✅ Completata |
| 1 — MVP | Brain condiviso minimo, usabile da Claude Code | ✅ Completata |
| 2 — Ingestione AI | Raccolta automatica con filtro privacy | ✅ Completata |
| 3 — UI base | App desktop di monitoraggio, controllo e decisioni (React + Electron) | ✅ Completata |
| 4 — Documenti | Cartelle sorvegliate + documento originale su richiesta | ✅ Completata |
| 5 — Priorità | Vettori, ricerca ibrida, attivazione | ✅ Completata |
| 6 — Dreaming | Consolidamento coordinato | ✅ Completata |
| 7 — Hardening | Offboarding, redazione, installer, altri client | 🔄 In corso (parziale) |

---

## Decisioni prese

| # | Decisione | Esito |
|---|---|---|
| D1 | Linguaggio | TypeScript. Le parti web/HTTP usano **NestJS** |
| D2 | Consegna della chiave al nuovo membro | Blind-pairing con un membro online qualsiasi: il codice d'invito non contiene la chiave |
| D3 | Indexer | Gli admin sono gli indexer. Consigliati 2–3 admin |
| D4 | Cosa entra nell'MVP | Solo i salvataggi espliciti. "Come gestire l'esplicito" si definisce in Fase 2 (vedi D6) |
| D5 | Sistemi operativi | Tutti. Sviluppo su Windows, Linux verificato in Docker, macOS non ancora provato |
| D6–D9 | Ingestione AI | Vedi Fase 2 |
| D10 | Consenso al download dell'originale di un documento | Automatico per cartella: "scaricabili su richiesta sì/no" scelto quando si aggiunge la cartella (DESIGN §12-bis) |
| D11 | Chi serve l'originale | Solo il nodo proprietario. Le copie scaricate restano in cache locale per 30 giorni e non vengono ri-servite |
| D12 | UI | Web app **React** servita dal daemon + guscio Electron (notifiche, icona nell'area di notifica, avvio automatico del daemon). Fase dedicata subito dopo la Fase 2 (DESIGN §12-ter). Inizialmente proposta in Angular; il team usa React |

---

## Fase 0 — Spike ✅

Resoconto completo: [spike-fase-0.md](spike-fase-0.md). In sintesi: P2P 6/6 scenari, Claude CLI 5/5 classificazioni, embedding locali 4/4 query. Codex non è verificato (nessun abbonamento).

---

## Fase 1 — MVP ✅

| # | Attività | Stato |
|---|---|---|
| 1.1 | Setup del progetto: TypeScript 5.9, vitest + SWC, build | ✅ |
| 1.2 | `core/`: schemi zod degli eventi, id content-addressed | ✅ |
| 1.3 | `net/`: Autobase + Hyperswarm (refresh della discovery, wakeup), cifratura, admin = indexer | ✅ |
| 1.4 | Membership: init, invito blind-pairing (chi ha invitato può essere offline), espulsione e promozione solo admin, albero degli inviti | ✅ |
| 1.5 | `store/`: indice FTS5 su `node:sqlite` derivato dalla vista | ✅ |
| 1.6 | Daemon NestJS + CLI `micelio` | ✅ |
| 1.7 | MCP Streamable HTTP (`recall`, `remember`, `get`) + `micelio setup claude-code` | ✅ |
| 1.8 | Export Markdown in sola lettura | ✅ |
| 1.9 | Test: 25 di unità e integrazione + scenario Docker end-to-end (11 controlli) | ✅ |
| 1.10 | Documentazione: README, guida utente, guida per sviluppatori, MCP | ✅ |

**Criterio di completamento: raggiunto.**
- Un nodo sul PC Windows è entrato nel team di un nodo in container via DHT pubblica (14 s).
- Claude Code reale ha trovato con `recall` un ricordo scritto dal container.
- Claude Code ha salvato con `remember` una decisione, che il container ha visto subito.

**Problemi emersi e risolti durante la fase:**
1. Un invito creato da un nodo che va subito offline non è verificabile dagli altri. Ora `invite` attende che almeno un peer l'abbia ricevuto, altrimenti avvisa.
2. Con eventi concorrenti un'azione da admin emessa da un non-admin poteva diventare valida. Ora il nodo la rifiuta già in partenza (DESIGN §9).
3. Su Windows `SIGTERM` uccide il processo senza chiusura ordinata. Ora lo shutdown passa da un segnale interno.
4. L'albero degli inviti attribuiva l'invito a chi aveva accolto la richiesta. Ora lo attribuisce a chi l'ha creato.

**Osservazione importante per la Fase 2:** quando Claude salva un ricordo con `remember`, scrive lui il testo e **aggiunge dettagli non detti dall'utente** (visto anche nello spike B). Va affrontato insieme alla decisione D6.

**Non verificato:** `npm link` su macOS/Linux e il comando `micelio setup claude-code` sulla configurazione reale. Per non modificare la tua configurazione l'ho provato con un `--mcp-config` temporaneo.

---

## Fase 2 — Ingestione AI ✅

**Obiettivo:** il sapere entra anche senza `remember` esplicito, dalle sessioni di Claude Code, e **niente di personale o sensibile arriva al team**. Riferimenti: DESIGN §6–7.

### Decisioni

| # | Domanda | Esito |
|---|---|---|
| D6 | Come trattare i salvataggi espliciti (`remember`) | ✅ Passano **anche loro** dal filtro deterministico e dalla classificazione. Se sono puliti vanno al team, altrimenti in inbox. Il tool risponde mostrando il testo salvato, così l'utente vede subito cosa è stato scritto a suo nome |
| D7 | Raccolta automatica dalle sessioni di Claude Code | ✅ **Opt-in per progetto:** si attiva solo nelle cartelle elencate dall'utente (`micelio watch add <cartella>`) |
| D8 | Budget di chiamate LLM per nodo | ✅ Configurabile, default **300 chiamate al giorno**. Quando il budget finisce il lavoro resta in coda per il giorno dopo. Classificazione con Haiku, distillazione con Sonnet |
| D9 | Inbox | ✅ Raccoglie **solo i casi dubbi in ingresso** (contenuto misto, dati sensibili segnalati insieme a contenuto utile, classificatore poco sicuro). I contenuti puliti vanno al team senza approvazione, quelli chiaramente personali o HR restano privati. Revisione da CLI (`micelio inbox`) e da MCP; gli elementi scadono dopo 14 giorni. **Non** riguarda i ricordi diventati inutili: quelli li archivia il dreaming (Fase 6), in modo reversibile |

### Attività

| # | Attività | Stato |
|---|---|---|
| 2.1 | `llm/`: adapter Claude CLI (dallo spike B) dietro un'interfaccia comune, coda con concorrenza 1, budget giornaliero, retry su output non valido, anti-loop `MICELIO_INTERNAL` | ✅ |
| 2.2 | Archivio privato `private.db` (mai replicato) + inbox: CLI `micelio inbox [approve\|reject\|edit]` e tool MCP `inbox_review` / `inbox_decide` | ✅ |
| 2.3 | Filtro deterministico: percorsi, parole chiave (HR, valutazioni, retribuzioni…), pattern di dati personali (codice fiscale, IBAN, telefono, email), **redazione dei segreti** (chiavi API, token, password, stringhe di connessione). Regole di default + regole del team via `team.config` | ✅ (regole sui percorsi rinviate alla Fase 4, dove servono per le cartelle di documenti) |
| 2.4 | Classificazione con Haiku (schema e prompt dello spike B, set di casi di prova ampliato) | ✅ |
| 2.5 | Distillazione con Sonnet: 0..N ricordi atomici, **regola di fedeltà alla fonte**, lingua del team (`memory.language`) | ✅ |
| 2.6 | Hook `SessionEnd` di Claude Code installato da `micelio setup claude-code`: invia al daemon il percorso della trascrizione, solo per le cartelle opt-in (D7) | ✅ |
| 2.7 | `remember` esplicito attraverso filtro + classificazione (D6) | ✅ |
| 2.8 | Set di valutazione: 20–30 sessioni realistiche anonimizzate (tecniche, HR, miste, banali) con l'esito atteso, eseguibile con `npm run eval:ingest` | ✅ |
| 2.9 | Test e documentazione (guida utente: privacy e inbox; sviluppo: pipeline) | ✅ |

**Criterio di completamento:**
- Una sessione tecnica in una cartella opt-in produce ricordi nel team senza intervento.
- Una sessione su una mail di valutazione, o con credenziali, **non** produce nulla nel team (resta in privato o in inbox).
- Il set di valutazione passa almeno il 90% dei casi, e il 100% dei casi sensibili.

**Criterio di completamento: raggiunto**, con strumenti reali:
- una **sessione reale di Claude Code** in una cartella opt-in ha fatto scattare l'hook, è stata classificata (Haiku, 4,9 s) e distillata (Sonnet, 6,1 s), e ha prodotto un ricordo fedele, ritrovabile con `recall`;
- una **sessione reale** in cui si chiedeva la mail di valutazione di fine anno di un collega è stata bloccata dal filtro locale **senza alcuna chiamata a Claude**: il team è rimasto invariato e il registro privato riporta il motivo;
- **set di valutazione** con Claude reale: 22 casi su 22 corretti, 8 casi sensibili su 8 fuori dal team (`test/eval/report.md`);
- 66 test automatici e scenario Docker end-to-end (11/11) verdi.

**Problemi emersi e risolti durante la fase:**
1. **Windows, nomi corti 8.3:** Claude Code riporta la cartella di lavoro con il nome lungo, mentre la cartella abilitata poteva essere salvata con quello corto (`MARIOR~1.ROS`). Le sessioni venivano ignorate in silenzio. Ora i percorsi sono normalizzati.
2. **Hook silenzioso:** un errore dell'hook non lasciava traccia. Ora finisce in `logs/hook.log`, e le sessioni ignorate sono segnalate nel log del daemon.
3. **Schema degli eventi:** `source.type` era un enum rigido, quindi i nodi vecchi avrebbero ignorato i ricordi con sorgenti nuove. Ora è una stringa libera (compatibilità in avanti).
4. **Commenti nel codice:** su tua segnalazione, tutto il codice è stato riscritto con intestazioni, JSDoc e commenti sul perché. La regola è nelle convenzioni ([sviluppo.md](sviluppo.md)).
5. **Disco:** i rebuild Docker lasciavano immagini orfane (circa 480 MB ciascuna). Sono state rimosse, e ora lo scenario e2e ripulisce da solo le immagini di Micelio.

**Non coperto in Fase 2:** Codex CLI (serve un abbonamento per provarlo), cartelle di documenti (Fase 4).

---

## Fase 3 — UI base ✅

**Obiettivo:** un'app desktop per monitorare il nodo, cercare nel sapere del team, prendere le decisioni (inbox, membri) e configurare la raccolta, senza usare il terminale. Riferimento: DESIGN §12-ter.

### Decisioni

| # | Domanda | Esito |
|---|---|---|
| D13 | Dove vive il codice | ✅ Stesso repository: `ui/` (React + Vite) e `desktop/` (Electron), come workspace npm. Il daemon serve la UI compilata su `http://127.0.0.1:7337/ui` |
| D14 | App o browser | ✅ Si preferisce l'**app desktop**, ma la stessa UI funziona anche nel browser: `micelio ui` apre un link monouso che consegna il token alla pagina. L'app Electron legge il token direttamente da `config.json` |
| D15 | Notifiche | ✅ Nuovi elementi in inbox, nodo isolato da più di 10 minuti, budget LLM quasi esaurito |
| D16 | Pacchetti di installazione | ✅ **Nessuno per ora**: l'app si avvia da console (`npm run desktop`). Installer per tutti i sistemi, e avvio automatico all'accesso, in Fase 7 |

### Attività

| # | Attività | Stato |
|---|---|---|
| 3.1 | Daemon: canale di eventi in tempo reale (SSE `/api/events`): sincronizzazione, nuovi ricordi, inbox, coda, peer | ✅ |
| 3.2 | Daemon: pubblicazione della UI compilata e comando `micelio ui` con link monouso | ✅ |
| 3.3 | React: scheletro, navigazione, tema chiaro/scuro, client API tipizzato, aggiornamenti in tempo reale | ✅ |
| 3.4 | Schermata Dashboard: nodo, team, peer, sincronizzazione, LLM e budget, coda | ✅ |
| 3.5 | Schermata Memoria: ricerca, dettaglio, autore, fonte | ✅ |
| 3.6 | Schermata Inbox: anteprima, approva (con modifica), rifiuta | ✅ |
| 3.7 | Schermata Team: albero degli inviti, crea e copia un invito, promuovi ed espelli (solo admin), impostazioni di team | ✅ |
| 3.8 | Schermata Privato: registro delle decisioni | ✅ |
| 3.9 | Schermata Impostazioni: cartelle abilitate, budget e modelli LLM, configurazione di Claude Code | ✅ |
| 3.10 | Electron: avvio automatico del daemon, finestra, icona nell'area di notifica, notifiche (D15), avvio da console | ✅ |
| 3.11 | Test: SSE e API (integrazione), componenti React principali (unità), screenshot delle schermate dall'app reale | ✅ |
| 3.12 | Documentazione: guida all'app, sviluppo della UI | ✅ |
| 3.13 | **Nucleo 3D** (richiesta in corso d'opera): home olografica navigabile con esplorazione guidata, ricerca che "accende" gli argomenti, colori per autore/tipo. **Mappa 2D** per analisi mirate | ✅ |
| 3.14 | Team dimostrativo (`npm run demo`): 3 nodi locali, ~50 ricordi, DHT privata, LLM finto | ✅ |

**Criterio di completamento:** sul PC Windows, l'app desktop avvia da sola il daemon e permette, senza terminale, di:
- vedere lo stato del nodo;
- cercare un ricordo;
- approvare o rifiutare un elemento dell'inbox, ricevendone la notifica;
- creare un invito;
- abilitare una cartella per la raccolta.

La stessa UI funziona anche dal browser con `micelio ui`.

**Esito:**
- **Criterio raggiunto e verificato con le catture dell'app reale** (`docs/img/`). L'app avvia da sola il daemon e mostra stato, ricerca, inbox con approvazione e correzione, inviti, cartelle abilitate e configurazione di Claude Code.
- **Notifiche** per inbox, isolamento e budget, con le regole coperte dai test.
- **Browser** con `micelio ui` (link monouso).
- **Test:** 72 del daemon + 8 della UI.

**Problemi emersi e risolti:**
1. Due copie di three.js (0.169 e 0.186) e di React (18 e 19), portate dalle dipendenze: allineato tutto su three 0.186 e React 19.
2. Electron dal terminale di VS Code partiva senza finestre (`ELECTRON_RUN_AS_NODE` ereditata): aggiunto `desktop/launch.js`.
3. Nucleo 3D con sfondo grigio-blu invece che nero: con la catena di post-processing il colore di fondo veniva schiarito. Diagnosticato confrontando catture con e senza bloom; risolto con fondo nero puro e bloom inserito prima della conversione colore.
4. Mappa 2D "rimpicciolita" al centro: aggiunto l'inquadramento automatico.

**Nota sul disco:** React, Vite ed Electron aggiungono circa 600–800 MB di dipendenze di sviluppo in `node_modules` (nessuna immagine Docker in più). Per i test della UI non userò Playwright, che scaricherebbe altri browser: bastano i test dei componenti e la verifica manuale nell'app.

---

## Fase 4 — Documenti ✅

| # | Attività | Stato |
|---|---|---|
| 4.1 | Cartelle di documenti in config (con flag "condivisibile", D10), CLI `micelio docs`, API, schermata Impostazioni | ✅ |
| 4.2 | Sorveglianza con chokidar, elaborazione incrementale per hash (tabella `documents` nell'archivio privato) | ✅ |
| 4.3 | Estrazione del testo con officeparser (PDF, DOCX, XLSX, PPTX, ODT, RTF, MD…), suddivisione in parti | ✅ |
| 4.4 | Regole sui percorsi (rinviate dalla Fase 2): cartelle HR/contratti/… mai aperte, più regole del team (`filter.blockedPaths`) | ✅ |
| 4.5 | Riferimento alla fonte nei ricordi (hash, nome, dimensione, tipo; mai il percorso) | ✅ |
| 4.6 | Protocollo P2P `micelio/file/v1`: solo membri attivi (firma legata alla connessione), solo dal proprietario (D11), verifica dell'hash, cache locale di 30 giorni | ✅ |
| 4.7 | `micelio fetch`, tool MCP `fetch_source` (percorso + testo), pulsante "Scarica l'originale" nell'app | ✅ |
| 4.8 | Test (unità + integrazione su nodi reali con DOCX veri), team demo con documenti, documentazione | ✅ |

**Esito:** 85 test del daemon + 8 della UI. Verificato anche fra daemon reali nel team demo: Bruno ha scaricato da Alice `architettura-ordini.docx`, identico byte per byte.

**Problemi emersi e risolti:**
1. **Canale di scambio file chiuso subito** (gara fra i due lati all'apertura): risolto con `protomux.pair`.
2. **"Non sei un membro"** anche per un membro: in Hypercore 11 la chiave del feed e la chiave di firma sono diverse. Risolto con la verifica tramite manifest (DESIGN §12-bis).
3. **Nessun documento rilevato sotto una cartella nascosta (`.demo/`):** la regola che ignora `.git` e simili si applicava all'intero percorso; ora si applica solo sotto la cartella sorvegliata.
4. **chokidar usa "/" anche su Windows:** i confronti con i percorsi configurati fallivano. Normalizzati.
5. **Percorsi brevi e lunghi di Windows** anche nei test: confronti sui percorsi canonici.

---

## Fase 5 — Priorità ✅

| # | Attività | Stato |
|---|---|---|
| 5.1 | Eventi `memory.vote`, `memory.pin`/`unpin`, `usage.report` (G-Counter: si tiene il massimo per nodo) | ✅ |
| 5.2 | Attivazione (DESIGN §8.2): recency con emivita per tipo, usi, voti, collegamenti, pin | ✅ |
| 5.3 | Embedding locali in un worker thread (multilingual-e5-small), caricati su richiesta e scaricati dopo 10 minuti; calcolo in background dei vettori mancanti | ✅ |
| 5.4 | Ricerca ibrida: BM25 + coseno con soglia per modello, fusione RRF, peso dell'attivazione | ✅ |
| 5.5 | Contatori d'uso locali pubblicati ogni 30 minuti e alla chiusura | ✅ |
| 5.6 | Collegamenti semantici nella costellazione; nel Nucleo stelle più grandi e dorate per i ricordi più vivi | ✅ |
| 5.7 | `micelio vote/pin/unpin`, tool MCP `vote`, 👍 👎 📌 e attivazione nell'app | ✅ |
| 5.8 | Test (unità: attivazione, RRF, G-Counter; integrazione: voti/uso/pin propagati, collegamenti semantici) e documentazione | ✅ |

**Esito:** 98 test del daemon + 8 della UI. Embedder vero verificato dal codice compilato: modello scaricato una volta (130 MB, cache condivisa), "quale ORM usare per un nuovo microservizio" trova il ricordo su Drizzle.

**Scelte e problemi:**
1. **Niente sqlite-vec:** la ricerca vettoriale è esaustiva in JavaScript. Con qualche migliaio di ricordi da 384 dimensioni costa millisecondi, e non introduce un'estensione nativa da distribuire su tre sistemi operativi. Da rivalutare oltre ~50.000 ricordi.
2. **Il worker teneva il processo "staccato" anche con richieste aperte:** fuori dal daemon il processo terminava prima della risposta. Ora resta agganciato finché ci sono richieste.
3. **Soglia semantica dipendente dal modello:** e5 ha punteggi compressi fra 0,8 e 0,9 (spike C), quindi la soglia è 0,83. L'embedder finto dei test usa 0,3.
4. **Test, e2e e demo usano l'embedder finto** (`MICELIO_EMBEDDER=hash`): veloce, deterministico, senza download. In produzione il default è quello vero.

---

## Fase 6 — Dreaming ✅

| # | Attività | Stato |
|---|---|---|
| 6.1 | Eventi `memory.supersede`, `memory.link`, `memory.archive`/`restore`, `dream.claim`, `dream.complete`, con regole deterministiche in apply: la prima fusione vince, i ricordi fissati sono intoccabili, il diario è accettato solo dal vincitore dell'epoca | ✅ |
| 6.2 | Turnazione per epoca (giorno): ordine deterministico per hash(epoca + chiave), finestra dalle 13, un turno ogni 30 minuti; attesa dopo la rivendicazione per ridurre i sogni doppi | ✅ |
| 6.3 | Gruppi di quasi duplicati (union-find sui vettori, soglia per modello) → decisione del LLM: fondi / superato / collega / niente; prompt prudente e fedele ai contenuti | ✅ |
| 6.4 | Decadimento deterministico (attivazione < 15%, oltre 90 giorni, non fissati), massimo 20 per sogno | ✅ |
| 6.5 | Budget: massimo 30 chiamate per sogno, entro il budget giornaliero | ✅ |
| 6.6 | Diario, archivio e ripristino: `micelio dream now/log`, `micelio archive/restore`, schermata Sogni; nel Nucleo le sinapsi del dreaming sono dorate | ✅ |
| 6.7 | Test (unità: selezione, decadimento, turnazione, regole di apply; integrazione: fusione replicata, ripristino, sogni concorrenti) e documentazione | ✅ |

**Esito:** 107 test del daemon + 8 della UI. Nel team demo un sogno ha fuso due coppie di quasi duplicati scritti da colleghi diversi (schermata in `docs/img/sogni.png`).

**Problema emerso:** due nodi che sognano la stessa epoca nello stesso istante vedono entrambi la propria rivendicazione prima di quella dell'altro. La correttezza è garantita da apply (un solo diario, fusioni non duplicate); per ridurre il lavoro sprecato il nodo attende 5 secondi dopo la rivendicazione e ricontrolla chi ha vinto.

**Limite noto:** la qualità delle fusioni con Claude reale non è ancora stata misurata con un set di valutazione come quello della Fase 2. Va fatto prima di attivare il dreaming su un team vero.

---

## Fase 7 — Hardening 🔄 (parziale)

| # | Attività | Stato |
|---|---|---|
| 7.1 | Shim MCP stdio (`micelio mcp`): inoltra al daemon, verificato con un client MCP stdio reale | ✅ |
| 7.2 | `micelio setup codex / vscode / webstorm`: stampa la configurazione da incollare (formati documentati dai client, non provati nei client stessi) | ✅ |
| 7.3 | Redazione (`memory.redact`, solo admin, non ripristinabile) via CLI e API | ✅ |
| 7.4 | Metriche (`micelio metrics`, `GET /api/metrics`) | ✅ |
| 7.5 | **Rotazione della chiave di team all'offboarding** | ⬜ Da fare: richiede di creare una nuova Autobase cifrata con una chiave nuova e migrare i membri rimasti; lavoro delicato, da progettare insieme |
| 7.6 | **Eliminazione locale dei blocchi redatti** (oltre alla vista) | ⬜ Da fare |
| 7.7 | **Installer dell'app desktop** (Windows/macOS/Linux) | ⬜ Rinviato per decisione D16. L'avvio automatico del daemon all'accesso c'è già: `micelio autostart on` |
| 7.8 | **Test su macOS** e prova reale con Codex, VS Code e WebStorm | ⬜ Serve una macchina macOS e i client installati |
| 7.10 | **Distillazione consapevole delle modifiche**: riassunto git del capitolo di sessione (commit, lavoro non committato, classi/funzioni/endpoint) aggiunto al materiale del distillatore, con riferimenti a file e commit. Opzione `watch.gitChanges`. Ogni ricordo da sessione porta i **riferimenti al codice** (`source.code`: progetto, repository, branch, file, simboli, commit verificati), visibili in app, CLI, MCP ed export | ✅ |
| 7.11 | **Server del team (DHT privata)**: pacchetto separato `server/` (`micelio-server`, solo `hyperdht`) con `install.sh`/`uninstall.sh` per systemd; lato client `network.bootstrap` e `micelio network show/set/public/check`. Verificati: test automatico (team via solo server), installazione in un container Debian, diagnosi della DHT pubblica da Windows. **Da provare**: servizio systemd e NAT reali su una macchina Linux vera | 🔄 Parziale |
| 7.12 | **Rete e spazio dalla UI**: scelta DHT pubblica/privata in Impostazioni (verifica senza applicare, applicazione a caldo con riconnessione, nodi privati conservati), `micelio network private`; scheda *Spazio occupato* in Stato (totale su disco per componente, quota del log del team per membro da `core.byteLength`) | ✅ |
| 7.9 | **Set di valutazione del dreaming** con Claude reale (come quello della Fase 2) | ⬜ Da fare prima di attivare il dreaming su un team vero |

---

## Fase 8 — Radici: il sapere fondante ✅ (branch `feature/radici`)

Alcuni ricordi sono **pilastri**: paradigmi architetturali, mappe di rete, interfacce applicative, modello di dominio, best practice (es. regole di coding con l'AI), policy di sicurezza. Si consultano di rado, ma non devono mai essere dimenticati. Possono nascere da codice, documentazione, PDF, schemi, diagrammi o vault.

Decisioni dell'utente (2026-10-18):
- **nome:** «Radici»;
- **chi promuove:** qualunque membro può promuovere o togliere una Radice;
- **pin:** resta separato;
- **revisione:** niente promemoria periodici; si lancia a mano;
- **viste grafiche:** le Radici sono marcate in modo distinto.

| # | Attività | Stato |
|---|---|---|
| 8.1 | **Modello e permessi:** eventi `root.set/unset/flag/confirm`, record con categoria, stato di revisione e segnalazioni. Le Radici non si fondono e non si archiviano. Attivazione mai sotto 0,75 (`ROOT_FLOOR`); il dreaming le esclude | ✅ |
| 8.2 | **Emergono quando servono:** "Radici pertinenti" in coda a ogni `recall` MCP; tool MCP `architecture` (filtri per progetto, categoria, file toccati, testo) e `mark_root`; API `/api/roots`; CLI `micelio roots` (alias `radici`) | ✅ |
| 8.3 | **Revisione manuale** (`micelio roots review`, `POST /api/roots/review`): segnala le Radici il cui codice (commit successivi alla revisione sui file citati, file scomparsi) o documento d’origine è cambiato, o che ricordi più recenti contraddicono (collegamenti del dreaming + LLM, max 30 confronti). I repository si cercano nelle cartelle abilitate su questo PC | ✅ |
| 8.4 | **Ingestione:** il distillatore *suggerisce* Radici (archivio privato; promozione o "ignora" da UI/CLI `micelio roots suggested`); cartelle di documenti "di Radici" (`micelio docs add --roots`): i loro ricordi diventano Radici da soli; testo dai diagrammi: draw.io (anche compresso), SVG, PlantUML, Mermaid | ✅ |
| 8.5 | **UI:** vista *Radici* (per categoria, filtro per progetto e testo, stato e motivi, revisione con resoconto, suggerimenti da promuovere o ignorare); riquadro Radice nel dettaglio del ricordo; cartelle «di Radici» nelle Impostazioni; nel **Nucleo 3D** le Radici stanno al centro della sfera con un anello (rosso se da rivedere), nella **Mappa 2D** sono rombi; «◆ Radici» le isola. Verificato con le catture dell'app | ✅ |
| 8.6 | Documentazione: guida utente §7-ter-bis, MCP, app, DESIGN §10-bis, sviluppo | ✅ |

---

## Fase 9 — Sicurezza dei segreti ✅ (branch `feature/sicurezza-segreti`)

Richiesta dell'utente (2026-10-18): un meccanismo di sicurezza, nel backend e con una schermata dedicata, per le informazioni sensibili come password e file `.env`. Il punto di partenza è quello che c'è già: la redazione dei segreti nel testo e i percorsi bloccati per i documenti.

| # | Attività | Stato |
|---|---|---|
| 9.1 | **Riconoscimento dei segreti:** nuovi formati (Azure, Stripe, npm, PyPI, SendGrid, header Authorization/Bearer, chiavi private nei JSON); stringhe ad alta entropia (esclusi hash esadecimali); pattern ed eccezioni del team (`security.secretPatterns`, `security.allow`) | ✅ |
| 9.2 | **File sensibili:** `.env*`, chiavi, `credentials`, kubeconfig, `.npmrc`… Nelle sessioni il contenuto letto o scritto da Claude viene tolto per intero (anche `cat .env` via Bash); nelle cartelle di documenti non si aprono; nel riassunto git si esclude il diff. Pattern aggiuntivi del team (`security.sensitiveFiles`) | ✅ |
| 9.3 | **Registro di audit locale** (`private.db`): cosa è stato tolto, da dove, di che tipo. Mai il valore | ✅ |
| 9.4 | **Scansione retroattiva** dei ricordi pubblicati e "ripulisci" (admin): versione redatta pubblicata, originale rimosso; una Radice resta Radice | ✅ |
| 9.5 | **UI *Sicurezza*:** banco di prova (testo o nome di file), regole fisse e del team (modifica solo admin, pattern validati), scansione con *Ripulisci*, registro di questo PC. CLI `micelio security test|scan|clean|log|rules`. Verificato con le catture dell'app | ✅ |
| 9.6 | Test (unità: riconoscitori, entropia, idempotenza, file sensibili, trascrizioni; integrazione: regole, scansione, ripulitura, diff git; UI) e documentazione (guida §5-bis, app, DESIGN §6.3) | ✅ |

---

## Fase 10 — Limite dei ricordi distillati ✅ (branch `feature/limite-distillazione`)

Richiesta dell'utente (2026-10-18):
- il numero di ricordi per distillazione diventa un'impostazione di team scelta dall'admin, con default 5;
- si alza solo **con metriche di qualità precise**.

Il motivo del limite non è il costo (con la CLI dell'abbonamento le chiamate non si pagano una a una) ma il rumore.

| # | Attività | Stato |
|---|---|---|
| 10.1 | `distill.maxMemories` (team, solo admin, 1–20, validato): nel prompt e fatto rispettare dalla pipeline; ogni ricordo distillato porta `source.rank` (posizione) e `source.batch` (proposti dal modello) | ✅ |
| 10.2 | Metriche (`src/ingest/quality.ts`): per fascia di posizione, ricordi utili, votati inutili, fusi o archiviati, mai usati, punteggio; saturazione del limite; indicazione (alzare, tenere, abbassare, dati insufficienti) con soglie dichiarate. Solo ricordi con più di 3 giorni | ✅ |
| 10.3 | UI (pagina Team: impostazione e scheda «Qualità della distillazione»), API `GET /api/distill/quality`, CLI `micelio quality`, test, documentazione | ✅ |

---

## Backlog (da affrontare, ognuno su un branch dedicato staccato da `main`)

Richieste dell'utente del 2026-10-18 (B1–B3) e brainstorming sui concorrenti dello stesso giorno (B4–B6).

| # | Attività | Branch | Note |
|---|---|---|---|
| B1 | **UI in inglese** con selettore italiano/inglese | `feature/ui-inglese` | ✅ Fatto. Tutte le schermate, il pannello del ricordo, le viste grafiche, l'app desktop (menu e notifiche) e i 38 messaggi d'errore del daemon (intestazione `x-micelio-lang`). I testi composti dal daemon tornano come codice più valori. Restano nella lingua d'origine i **dati** del team (ricordi, segnalazioni, sogni), la CLI e le risposte MCP. Regola: `defineStrings` rende impossibile compilare una funzione senza la versione inglese |
| B2 | **Guida in linea onnicomprensiva** | `feature/guida-in-linea` | ✅ Fatto. 21 argomenti in italiano e in inglese (Markdown in `ui/src/help/content/<lingua>/`), con le sezioni che spiegano anche come funziona dietro: dove stanno i file, in che formato, come viaggiano. Pulsante «?» sui titoli di ogni pagina e scheda (pannello laterale sulla sezione giusta), F1 sulla pagina corrente, pagina «Guida» con indice e ricerca. Un test verifica che ogni argomento esista nelle due lingue con le stesse sezioni e che ogni «?» punti a una sezione esistente. Richiesta originale: per ogni schermata, pulsante e funzionalità: non solo *cosa* fa ma *come funziona dietro*. Per esempio, per la distillazione: dove finiscono fisicamente i ricordi (Hypercore/Autobase, corestore, vista Hyperbee, indice SQLite, export Markdown), in che formato, come arrivano agli altri nodi. Aiuti contestuali (icona «?») e una guida completa navigabile |
| B3 | **Più team nella stessa app (workspace)** | `feature/multi-team` | ✅ Fatto. `MicelioHost` gestisce più team sullo stesso PC, ognuno in `teams/<id>/` con chiavi, log, indice, archivio privato, impostazioni e rete propri; migrazione automatica dalla struttura a un team. Identità personale unica (`identity.json`) legata a ogni team con l'evento firmato `member.identity`: nella pagina Team si vede la stessa persona negli altri team. LLM (coda e budget) ed embedder condivisi. Sessioni al team della cartella più specifica; una cartella appartiene a un solo team. API con intestazione `x-micelio-team`, MCP `/mcp/<team>` registrato per progetto in ambito *local* di Claude Code, CLI `--team` e `micelio teams`, selettore nella UI, voce di guida «Più team». Richiesta originale: un nodo partecipa a più team, con sapere separato (chiavi, log, indici, archivio privato per team). Selettore del team nella UI. Instradamento per cartella di progetto: le sessioni di una cartella vanno al team di quella cartella. Agenti: endpoint MCP per team (`/mcp/<team>`) registrato **per progetto** (es. `.mcp.json` del repository), così un agente vede solo il team del progetto. Da verificare client per client (Claude Code, Codex, VS Code, WebStorm). È il più impegnativo |
| B4 | **Contesto automatico, lacune, file per gli agenti, qualità, uso personale** | `feature/contesto-e-qualita` | ✅ Fatto. Cinque funzioni in un unico blocco, scelte dal brainstorming sui concorrenti: (1) **contesto automatico**: hook `SessionStart` e `UserPromptSubmit` di Claude Code che inseriscono Radici e ricordi pertinenti senza aspettare `recall`; (2) **lacune di conoscenza** (ricerche senza risultato, segnalabili al team) e **riepilogo settimanale**; (3) **CLAUDE.md / AGENTS.md / regole di Cursor** generati dalle Radici e tenuti aggiornati, più **import** di ADR, CLAUDE.md e vault Markdown come Radici; (4) **aggiornare invece di aggiungere** alla scrittura (come mem0) e **ricordi che invecchiano con il codice** (commit sui file citati); (5) **modalità solo locale** (nessuna rete finché non serve) e **ricordi personali** che non lasciano il PC |
| B5 | **Estensione per VS Code** | `feature/vscode` | Da fare dopo B4. Ricordi e Radici pertinenti al file aperto, ricerca, salvataggio di un ricordo dalla selezione, stato del nodo |
| B6 | **Connettori per code review e issue** (GitHub, GitLab, Jira) | da definire | In roadmap, non pianificato. I commenti delle PR e le issue sono dove nascono molte decisioni: distillarli (passando dallo stesso filtro privacy) |

---

## Registro

| Data | Evento |
|---|---|
| 2026-10-17 | Design v0.1. Nodi su internet, 10–30 nodi, LLM via CLI senza API, solo conoscenza distillata, ambiti private + team, lingua configurabile per team, inviti aperti a tutti con espulsione riservata agli admin, un progetto = un team separato |
| 2026-10-17 | Fase 0 completata (spike A, B, C) |
| 2026-10-17 | Decisioni D1–D5 confermate. Fase 1 avviata |
| 2026-10-17 | Fase 1 completata: 25 test + e2e Docker 11/11 + prova reale Windows ↔ container con Claude Code. Documentazione in `docs/`. Fase 2 proposta (decisioni D6–D9) |
| 2026-10-17 | Decisioni D6–D9 confermate (budget LLM di default portato a 300 chiamate al giorno; inbox solo per i casi dubbi) |
| 2026-10-17 | Nuove funzioni: documento originale su richiesta (D10–D11, Fase 4) e UI desktop Electron (D12, nuova Fase 3). Fasi successive rinumerate. Fase 2 avviata |
| 2026-10-17 | Su richiesta: codice riscritto con commenti abbondanti (regola nelle convenzioni). Igiene di Docker: immagini orfane rimosse e pulizia automatica |
| 2026-10-17 | Fase 2 completata: 66 test + e2e 11/11 + valutazione con Claude reale 22/22 (sensibili 8/8) + prova reale dell'hook di Claude Code (sessione tecnica → ricordo; mail di valutazione → bloccata localmente). Fase 3 proposta (decisioni D13–D16) |
| 2026-10-17 | Decisioni D13–D16 confermate: **React** al posto di Angular, stessa repository, app desktop preferita (browser supportato), nessun installer per ora (avvio da console). Fase 3 avviata |
| 2026-10-17 | Richiesta: home "wow" in 3D con navigazione guidata (stile ologramma) e viste 2D per scopi specifici. Fase 3 completata: UI React + app Electron, Nucleo 3D, Mappa 2D, notifiche, team demo, documentazione con catture reali. Avvio della Fase 4 in autonomia |
| 2026-10-17 | Fase 4 completata: cartelle di documenti, regole sui percorsi, documento originale su richiesta via P2P (verificato fra daemon reali). Avvio della Fase 5 |
| 2026-10-17 | Fase 5 completata: attivazione, ricerca ibrida con embedding locali, voti, pin, uso condiviso (G-Counter), collegamenti semantici. Avvio della Fase 6 |
| 2026-10-17 | Fase 6 completata: dreaming coordinato (fusioni, superati, collegamenti, decadimento, diario, archivio). Avvio della Fase 7 |
| 2026-10-17 | Fase 7 parziale: shim MCP stdio, configurazioni per Codex/VS Code/WebStorm, redazione, metriche. Restano rotazione della chiave, installer, test su macOS e valutazione del dreaming |
| 2026-10-17 | Raccolta affidabile: sessioni di Claude Code in corso distillate a capitoli e recupero di quelle perse (session-scanner); l'hook accende il daemon se è spento; `micelio autostart on/off` (Windows, macOS, Linux). Verificati dal vero hook e script di avvio su Windows |
| 2026-10-17 | Distillazione consapevole delle modifiche (7.10): il distillatore riceve il riassunto git del capitolo di sessione. Test con un repository git temporaneo (commit datati dentro e fuori dal capitolo, lavoro non committato) |
| 2026-10-17 | Riferimenti al codice nei ricordi (`source.code`), su richiesta: servono a decidere se approfondire un ricordo. Commit verificati su git, percorsi relativi, remote senza credenziali |
| 2026-10-17 | Server del team (7.11) su richiesta: installazione separata per Linux, comandi `micelio network`. Dal PC di sviluppo: DHT pubblica raggiungibile, NAT non simmetrico |
| 2026-10-18 | Rete configurabile dalla UI e spazio occupato per membro (7.12), su richiesta. Verificati con test d'integrazione (cambio di DHT a caldo fra due nodi, quote che sommano al 100%) e catture dell'app |
| 2026-10-18 | Fase 8 completata sul branch `feature/radici`: Radici (sapere fondante mai dimenticato), revisione manuale, suggerimenti, cartelle di Radici, diagrammi, vista e marcatura grafica. Trovato con le catture e corretto un conflitto di rotte (`roots/review` preso per un id) |
| 2026-10-18 | Fase 9 completata sul branch `feature/sicurezza-segreti`. Trovati e corretti due difetti: redazione non idempotente (i segnaposto venivano riconosciuti di nuovo come segreti) e riassunto git vuoto sul primo commit di un repository |
| 2026-10-18 | Fase 10 completata sul branch `feature/limite-distillazione`: limite dei ricordi distillati scelto dall'admin, metriche di qualità per posizione e indicazione sul limite |
| 2026-10-18 | B1 completato sul branch `feature/ui-inglese`: interfaccia, app desktop ed errori del daemon in italiano e inglese. Nuova regola: ogni funzione nasce bilingue e con la guida in linea |
| 2026-10-18 | Server del team in Docker (branch `feature/server-docker`): `server/Dockerfile` su Debian slim (su Alpine `udx-native` non ha binari musl e il server non partiva). Provato in locale con due client DHT che si trovano tramite il container; immagine pubblicata nel registry dell'utente |
| 2026-10-18 | B4 completato sul branch `feature/contesto-e-qualita`: contesto automatico (hook SessionStart e UserPromptSubmit), lacune e riepilogo settimanale (pagina Riepilogo, notifica del lunedì), CLAUDE.md / AGENTS.md / regole di Cursor dalle Radici e import di ADR, aggiornare invece di aggiungere, ricordi che invecchiano con il codice, modalità solo locale e ricordi personali. Trovati e corretti due difetti: condividere un ricordo personale veniva scambiato per un duplicato di se stesso; `git log --since` saltava commit con date fuori ordine (ora si legge la storia dei soli file citati) |
| 2026-10-18 | B3 completato sul branch `feature/multi-team`: più team sullo stesso PC con sapere separato e identità personale comune (scelta dell'utente: «stessa persona + team»). Trovato e corretto un difetto di `canonicalPath`: per un percorso inesistente non espandeva i nomi corti 8.3 di Windows |
| 2026-10-18 | B2 completato sul branch `feature/guida-in-linea`: guida in linea in italiano e inglese, «?» contestuali, F1, pagina Guida. Il test di parità ha confermato che tutte le 21 voci hanno le stesse sezioni nelle due lingue |
