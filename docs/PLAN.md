# Micelio — Piano di lavoro

> Documento vivo: viene aggiornato a ogni avanzamento. Design di riferimento: [DESIGN.md](DESIGN.md). Indice della documentazione: [README.md](README.md).
> Ultimo aggiornamento: **2026-10-26**. Fasi 0–6 completate, Fase 7 parziale. In attesa di revisione dopo il lavoro in autonomia.

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
| 7.7 | **Installer dell'app desktop** (Windows/macOS/Linux) | 🔄 **Windows fatto** (branch `feature/installer-windows`): `npm run package:win`, installer NSIS per utente con Node incluso e comando `micelio` nel PATH; provato da `win-unpacked` (CLI, moduli nativi, embedding, app che avvia il daemon). Da provare l'installazione vera; macOS e Linux da fare. Prima: rinviato per decisione D16. L'avvio automatico del daemon all'accesso c'è già: `micelio autostart on` |
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

## Backlog (da affrontare, ognuno su un branch dedicato staccato da `develop`)

**Flusso dei branch (dal 2026-10-19):** `develop` è stato staccato da `main`. Ogni `feature/*` si stacca da `develop` e, finita, si rimergia in `develop`; poi `develop` si mergia in `main`. Fino a B9 i branch partivano direttamente da `main`.

Richieste dell'utente del 2026-10-18 (B1–B3) e brainstorming sui concorrenti dello stesso giorno (B4–B6).

| # | Attività | Branch | Note |
|---|---|---|---|
| B1 | **UI in inglese** con selettore italiano/inglese | `feature/ui-inglese` | ✅ Fatto. Tutte le schermate, il pannello del ricordo, le viste grafiche, l'app desktop (menu e notifiche) e i 38 messaggi d'errore del daemon (intestazione `x-micelio-lang`). I testi composti dal daemon tornano come codice più valori. Restano nella lingua d'origine i **dati** del team (ricordi, segnalazioni, sogni), la CLI e le risposte MCP. Regola: `defineStrings` rende impossibile compilare una funzione senza la versione inglese |
| B2 | **Guida in linea onnicomprensiva** | `feature/guida-in-linea` | ✅ Fatto. 21 argomenti in italiano e in inglese (Markdown in `ui/src/help/content/<lingua>/`), con le sezioni che spiegano anche come funziona dietro: dove stanno i file, in che formato, come viaggiano. Pulsante «?» sui titoli di ogni pagina e scheda (pannello laterale sulla sezione giusta), F1 sulla pagina corrente, pagina «Guida» con indice e ricerca. Un test verifica che ogni argomento esista nelle due lingue con le stesse sezioni e che ogni «?» punti a una sezione esistente. Richiesta originale: per ogni schermata, pulsante e funzionalità: non solo *cosa* fa ma *come funziona dietro*. Per esempio, per la distillazione: dove finiscono fisicamente i ricordi (Hypercore/Autobase, corestore, vista Hyperbee, indice SQLite, export Markdown), in che formato, come arrivano agli altri nodi. Aiuti contestuali (icona «?») e una guida completa navigabile |
| B3 | **Più team nella stessa app (workspace)** | `feature/multi-team` | ✅ Fatto. `MicelioHost` gestisce più team sullo stesso PC, ognuno in `teams/<id>/` con chiavi, log, indice, archivio privato, impostazioni e rete propri; migrazione automatica dalla struttura a un team. Identità personale unica (`identity.json`) legata a ogni team con l'evento firmato `member.identity`: nella pagina Team si vede la stessa persona negli altri team. LLM (coda e budget) ed embedder condivisi. Sessioni al team della cartella più specifica; una cartella appartiene a un solo team. API con intestazione `x-micelio-team`, MCP `/mcp/<team>` registrato per progetto in ambito *local* di Claude Code, CLI `--team` e `micelio teams`, selettore nella UI, voce di guida «Più team». Richiesta originale: un nodo partecipa a più team, con sapere separato (chiavi, log, indici, archivio privato per team). Selettore del team nella UI. Instradamento per cartella di progetto: le sessioni di una cartella vanno al team di quella cartella. Agenti: endpoint MCP per team (`/mcp/<team>`) registrato **per progetto** (es. `.mcp.json` del repository), così un agente vede solo il team del progetto. Da verificare client per client (Claude Code, Codex, VS Code, WebStorm). È il più impegnativo |
| B4 | **Contesto automatico, lacune, file per gli agenti, qualità, uso personale** | `feature/contesto-e-qualita` | ✅ Fatto. Cinque funzioni in un unico blocco, scelte dal brainstorming sui concorrenti: (1) **contesto automatico**: hook `SessionStart` e `UserPromptSubmit` di Claude Code che inseriscono Radici e ricordi pertinenti senza aspettare `recall`; (2) **lacune di conoscenza** (ricerche senza risultato, segnalabili al team) e **riepilogo settimanale**; (3) **CLAUDE.md / AGENTS.md / regole di Cursor** generati dalle Radici e tenuti aggiornati, più **import** di ADR, CLAUDE.md e vault Markdown come Radici; (4) **aggiornare invece di aggiungere** alla scrittura (come mem0) e **ricordi che invecchiano con il codice** (commit sui file citati); (5) **modalità solo locale** (nessuna rete finché non serve) e **ricordi personali** che non lasciano il PC |
| G | **Galassie: viste dense per progetti grandi** | `feature/galassie` | ✅ Fatto. Oltre 250 ricordi Nucleo e Mappa 2D partono da una galassia per argomento (Louvain sui collegamenti, nomi dai tag caratteristici), si entra con un clic, ricerca e filtri mostrano solo i risultati o accendono le galassie che li contengono, tour fra le galassie, al massimo 600 stelle per galassia. Prestazioni misurate a 5 000 ricordi: scrittura ~0,3 s, ricerca < 10 ms, costellazione in cache ~70 ms, avvio senza ricalcoli (vicini salvati); ricalcoli pesanti in sottofondo e a blocchi |
| B5 | **Estensione per VS Code** | `feature/vscode` | Da fare dopo B4. Ricordi e Radici pertinenti al file aperto, ricerca, salvataggio di un ricordo dalla selezione, stato del nodo |
| B6 | **Connettori per code review e issue** (GitHub, GitLab, Jira) | da definire | In roadmap, non pianificato. I commenti delle PR e le issue sono dove nascono molte decisioni: distillarli (passando dallo stesso filtro privacy) |
| B7 | **Backup e ripristino del sapere di un team** | `feature/backup-team` | ✅ Fatto. File `.micelio-backup` cifrato (scrypt + AES-256-GCM) con tutto il sapere del team; ripristino in un team nuovo (anche dal benvenuto) o in uno esistente (solo admin), senza duplicati, con autore e data d'origine; backup automatici giornalieri per team. Pagina Team, Impostazioni, CLI `micelio backup`, guida «Backup e ripristino». 5 000 ricordi ripristinati in ~10 s. Vedi «B7 in dettaglio» sotto |
| B8 | **Server privato che funziona davvero** | `feature/server-privato` | ✅ Fatto (codice). Relay `blind-relay` sul nodo del server, stessa porta UDP, chiave ricavata dall'indirizzo (nessuna configurazione sui PC); i PC lo usano solo dopo un hole punching fallito o con NAT simmetrico, e solo se risponde. Log del server con l'attività ogni 15 minuti. `network check`, Impostazioni → Rete e Stato dicono se c'è il relay e quanto è usato. Server 0.2.0. Resta: immagine Docker da pubblicare e prova reale fra due reti diverse. Vedi «B8 in dettaglio» |
| B9 | **Pacchetto Linux** (AppImage e .deb) | `feature/package-linux` | ✅ Fatto. `npm run package:linux` (anche in un container), parti comuni con Windows in `scripts/package-common.js`. Provato in Debian 12 pulito: .deb con dipendenze, `micelio` nel PATH, daemon con il Node incluso, app desktop su schermo virtuale, rimozione. Corretta la dipendenza mancante dalla libreria audio. Da provare su un desktop Linux reale |
| B10 | **Chat AI sulla memoria, con mappa mentale del sapere** | `feature/chat-memoria` | ✅ Fatto. Pagina «Chiedi»: risposta dell'LLM scritta solo sui ricordi del team con riferimenti [n] cliccabili, «non lo so» senza chiamare l'LLM e segnalazione della lacuna, mappa mentale istantanea (temi come comunità dei collegamenti, ricordi con prima riga, collegamenti del dreaming, espandi), domande che seguono, «Salva come ricordo», cronologia solo locale. Mappa su 5 000 ricordi in ~0,1 s. Vedi «B10 in dettaglio» |
| B11 | **Misurazione dell'efficienza del sistema** | `feature/efficacia` | ✅ Fatto. Pagina «Efficacia»: consultazioni degli agenti in tempo reale (tool MCP e contesto automatico, con il tempo di risposta), esiti per ricordo a sessione finita (euristica sempre, LLM nella stessa chiamata della distillazione), pollice in su automatico sui ricordi confermati utili (mai sopra un voto a mano), utilità condivisa con il team (`useful.report`, peso 3 nell'attivazione), rumore, sbagliati, domande senza risposta, notifiche del desktop solo per utile/sbagliato. Vedi «B11 in dettaglio» |
| B12 | **Memoria che impara dall'uso** (idee da Spector) | `feature/memoria-dall-uso` | ✅ Fatto (0.6.0). Quattro interventi sul modo in cui i ricordi salgono e scendono: (1) abituazione, i ricordi proposti spesso e mai utili scendono in classifica; (2) sinapsi da uso congiunto, due ricordi utili nella stessa sessione rafforzano il loro legame; (3) peso alle scoperte sudate, più importanza ai ricordi nati da una lunga lotta; (4) ricevuta di redazione, ogni nodo conferma di aver tolto il contenuto. Vedi «B12 in dettaglio» |
| B13 | **Repository pubblica e aggiornamenti automatici** | `feature/repo-pubblica` | 🔄 In corso. L'app si aggiorna da sola invece di far scaricare e installare a mano ogni nuova versione: oggi ogni correzione (0.5.1, 0.5.2, 0.5.3) richiede di passare l'installer a tutti i colleghi. Scelta: `electron-updater` con GitHub Releases, quindi prima la repository va resa pubblica. Quattro fasi, ognuna presentata e approvata prima di iniziare: (1) repository pubblica ✅, cioè licenza GNU AGPL-3.0 con CLA, README nuovo, CONTRIBUTING, SECURITY, codice di condotta, CHANGELOG, template di GitHub, scheda «Informazioni» nelle Impostazioni, pulizia di IP, nomi di persone e progetti interni, spike tolti, e alla fine la riscrittura degli autori della storia sull'email personale; (2) CI con GitHub Actions 🔄 (branch `feature/ci`): ora che la repository è pubblica i minuti sono gratuiti, quindi matrice completa Linux/Windows/macOS, più CodeQL, dependency review e Dependabot; (3) release automatica da tag, con installer e `latest.yml`; (4) aggiornamenti automatici con firma Ed25519 nostra |

### B7 in dettaglio: backup e ripristino del sapere di un team

**A cosa serve.** Oggi il sapere di un team sopravvive finché c'è almeno un PC del team con i dati: la replica P2P è una copia, non un backup. Non protegge da una redazione sbagliata o da un team abbandonato, e non permette di spostare il sapere in un team nuovo. Il backup è un **file** che contiene il sapere del team e si ripristina in un team nuovo o in uno esistente.

**Cosa c'è nel file** (`<team>-<data>.micelio-backup`: JSON compresso con un manifesto):
- ricordi attivi **e** storico (archiviati, sostituiti, con il motivo), con autore e data originali;
- Radici (categoria, stato, segnalazioni), collegamenti, voti e ricordi fissati, lacune di conoscenza;
- configurazione condivisa del team (lingua dei ricordi e simili).

**Cosa NON c'è:** chiavi, membri, inviti (un team ripristinato ha chiavi nuove: i colleghi rientrano con un invito); archivio privato, Inbox e ricordi personali (stanno su un solo PC); originali dei documenti; ricordi redatti.

**Sicurezza:** il file contiene tutto il sapere del team. Cifratura con password (scrypt + AES-256-GCM).

**Ripristino:**
- in un **team nuovo** (chi ripristina ne diventa fondatore) o **dentro un team esistente** (fusione);
- i duplicati si saltano da soli: l'id di un ricordo deriva dal contenuto;
- autore e data originali restano visibili e contano per l'attivazione: un ricordo vecchio non torna "nuovo";
- scrittura a blocchi e un solo aggiornamento dell'indice alla fine. Obiettivo: 5 000 ricordi in meno di un minuto, con il daemon che continua a rispondere.

**Decisioni dell'utente (2026-10-19):**
- **backup:** qualunque membro (vede già tutto il sapere);
- **ripristino dentro un team esistente:** solo admin. In un team nuovo chiunque, perché ne diventa admin;
- **password obbligatoria;**
- **backup automatici giornalieri:** per team, spenti di default, in una cartella scelta, si tengono gli ultimi N (default 7). La password dei backup automatici si imposta una volta e resta solo sul PC, in `teams/<id>/settings.json`: i dati del team su quel disco sono già in chiaro, e la cifratura protegge le copie nella cartella di backup (che può essere condivisa o di rete).

**Dove si usa:** pagina Team (scheda «Backup e ripristino»), CLI `micelio backup create|restore`, API. Guida in linea IT/EN con il funzionamento interno; test, compresa una prova a 5 000 ricordi.

### B8 in dettaglio: server privato che funziona davvero

**Cosa sappiamo (2026-10-19).** Il server risponde (86 ms da un PC del team). Due nodi sullo stesso PC si trovano tramite il server in 1 secondo. Due colleghi su reti diverse sono invece rimasti a 0 peer per 9 minuti, mentre con la DHT pubblica si collegano in 3 secondi. Da un solo PC il caso «reti diverse» non si riproduce. Il log del server non dice chi lo contatta.

**Causa più probabile:** l'hole punching fra due reti aziendali o con NAT restrittivi non riesce, e oggi Micelio non ha un piano B. Con la DHT pubblica può riuscire più spesso, perché ci sono molti nodi da cui misurare il proprio NAT.

**Piano:**
1. **Server osservabile.** Ogni 15 minuti, e su richiesta, il log dice quanti PC lo hanno contattato, quanti team annunciano, quanti hole punching ha fatto da intermediario e quante connessioni ha passato in relay. Così un problema si vede dal server.
2. **Relay sul server** (`blind-relay` di Holepunch). Quando l'hole punching fallisce, o il NAT di un PC è simmetrico, la connessione passa dal server. Resta cifrata da un capo all'altro (Noise): il server inoltra byte che non può leggere. Dati e traffico passano dal server solo in quei casi.
3. **Client.** Con la DHT privata il nodo usa il relay del server automaticamente quando serve. Stato e `micelio network check` dicono se una connessione è diretta o in relay, e se il relay è raggiungibile.
4. **Immagine Docker nuova** (0.2.0), da pubblicare nel registry, con il comando per aggiornare.
5. **Test:** relay forzato fra due nodi con una DHT di test. Prova reale con te e il collega su reti diverse.
6. **Guida** (Rete, P2P) e `server/README.md`.

### B11 in dettaglio: efficacia di Micelio per gli agenti

**Richiesta (2026-10-19).** Vedere nella UI ogni volta che Claude Code interroga Micelio e se riceve dati utili. I ricordi con un uso positivo certo ricevono in automatico un pollice in su.

**Decisioni dell'utente:**
- **Notifiche:** la pagina «Efficacia» con il flusso in tempo reale; le notifiche del desktop solo per gli esiti «utile» e «sbagliato», disattivabili.
- **Giudizio:** euristica sempre (gratis), più l'LLM quando la sessione si distilla. Il pollice in su scatta solo con la conferma dell'LLM.
- **Condivisione:** si condivide con il team anche quante volte un ricordo è stato utile.

**Piano:**
1. **Registro delle consultazioni** (`private.db`, solo su questo PC). Ogni richiesta di un agente: tool MCP (`recall`, `architecture`, `get`, `fetch_source`) e contesto automatico (inizio sessione, richiesta). Si registrano ora, progetto, sessione, domanda e ricordi restituiti. La UI riceve ogni consultazione subito (evento `efficacy`). Conservazione: 90 giorni.
2. **Esito per ogni ricordo restituito**, quando la sessione è finita (lo stesso momento in cui oggi si raccoglie). Dalla trascrizione si ricavano i ricordi che Micelio ha davvero fornito (risultati dei tool e contesto inserito, che portano l'id) e cosa ha fatto Claude dopo.
   - **Euristica, per tutte le sessioni:** nei messaggi e nei comandi successivi compaiono elementi distintivi del ricordo (file, comandi, simboli, configurazioni, URL). Esito «probabilmente utile», con la prova (es. «ha eseguito `npm cache clean` dal ricordo X»).
   - **LLM, per le sessioni che si distillano:** nella chiamata di distillazione già prevista, una domanda in più: per ogni ricordo fornito, «usato», «ignorato» o «sbagliato o superato», con il motivo.
   - **Pollice in su automatico** (voto +1 del tuo nodo) solo con l'LLM che conferma «usato». Mai sopra un voto dato a mano.
   - **«Sbagliato»:** notifica e azione proposta nella pagina (rivedi, vota giù, archivia; per una Radice, «segnala da rivedere»). Niente di automatico.
3. **Utilità condivisa con il team.** Nuovo evento `useful.report`: contatori cumulativi per ricordo e per nodo, come `usage.report`; i nodi di versioni precedenti lo ignorano. Il dettaglio di un ricordo mostra «utile N volte nel team». L'attivazione (priorità) dà più peso all'uso UTILE che al semplice «restituito»: oggi un ricordo conta come usato appena viene restituito.
4. **Pagina «Efficacia»:**
   - flusso delle consultazioni con gli esiti che arrivano dopo;
   - metriche: consultazioni al giorno, percentuale con risultati, percentuale utile;
   - ricordi che aiutano di più;
   - ricordi restituiti spesso ma mai usati (rumore);
   - ricordi segnalati come sbagliati;
   - domande senza risposta (collegate alle lacune).
   Filtri per progetto e periodo. Impostazioni: notifiche on/off.
5. **Prestazioni:** registrare una consultazione non deve rallentare la risposta all'agente (scrittura in sottofondo, indici). Euristica lineare nella lunghezza della sessione. Prova con migliaia di consultazioni.
6. **Guida** «Efficacia» IT/EN con il funzionamento interno; test unitari (euristica, piano dei voti) e d'integrazione (consultazione → esito → voto → contatore di team).

### B12 in dettaglio: memoria che impara dall'uso

**Origine (2026-10-21).** Un commento al post LinkedIn su Micelio ha segnalato [Spector](https://github.com/spectrayan/spector), un motore di memoria per agenti in Java (Apache-2.0). Non è un concorrente diretto: è una memoria per singolo utente o agente, senza condivisione nel team e senza raccolta automatica dalle sessioni. Molte idee le abbiamo già (decadimento, rinforzo con l'uso, ricerca ibrida con RRF, consolidamento, grafo). Quattro meritano di entrare in Micelio. L'utente ha chiesto di metterle in piano tutte e quattro.

**Perché ora.** Nei primi tre giorni la pagina Efficacia ha mostrato che solo una parte dei ricordi passati all'agente serve davvero: 28% in un team, 10% in un altro. Il contesto automatico propone spesso gli stessi ricordi anche quando non c'entrano. Ogni ricordo inutile nel contesto è rumore per l'agente e token sprecati.

**1. Abituazione: chi non serve scende.**
- Oggi il «rumore» (ricordi restituiti almeno 5 volte e mai utili) si vede solo nella pagina Efficacia; la classifica non ne tiene conto.
- Si aggiunge all'attivazione un fattore di abituazione: più volte un ricordo è stato restituito senza essere utile, più scende. Un esito utile lo azzera, perché il ricordo ha dimostrato di servire.
- Vale soprattutto per il contesto automatico (`SessionStart`, `UserPromptSubmit`), dove l'agente non ha chiesto niente. Una `recall` esplicita lo applica più leggero, perché lì la domanda è precisa.
- Le Radici non scendono sotto la soglia attuale, i ricordi fissati non sono toccati.
- Dati: la serie di esiti senza uso dall'ultimo esito utile, letta dagli esiti di QUESTO PC (pagina Efficacia), non dai contatori di team. Decisione del 2026-10-22: i contatori di team (`usage.report`, `useful.report`) sono cumulativi e senza ordine nel tempo, quindi non permettono di azzerare dopo un esito utile, e contano anche le consegne mai valutate.
- Pesi: fino a 2 esiti senza uso 100%, poi meno 15% a esito, minimo 30% (3 → 85%, 5 → 55%, 7 o più → 30%). Non tocca l'attivazione: costellazione e dreaming restano uguali.
- Misura del successo: la percentuale di ricordi utili nella pagina Efficacia deve salire nelle settimane dopo il rilascio, a parità di consultazioni.

**2. Sinapsi da uso congiunto (apprendimento hebbiano).**
- Oggi le sinapsi nascono da tag in comune, significato simile e dreaming.
- Nuovo tipo di sinapsi «uso»: quando due ricordi risultano utili nella stessa sessione, il loro legame si rafforza. Un legame che non viene più rinforzato si indebolisce con il tempo, come l'attivazione.
- In ricerca, un ricordo trovato porta con sé i vicini più forti per uso, anche se non contengono le parole cercate: sono quelli che di solito servono insieme.
- Nella costellazione e nella mappa della chat queste sinapsi hanno un colore loro.
- Condivisione con il team: evento nuovo con le coppie e il loro peso, accumulato come gli altri contatori; i nodi di versioni precedenti lo ignorano.
- Prestazioni: le coppie crescono con il quadrato dei ricordi utili per sessione, quindi si tiene un massimo di coppie per sessione e di vicini per ricordo. Prova con migliaia di ricordi.

**3. Peso alle scoperte sudate.**
- Un gotcha trovato dopo un'ora di errori vale più di un fatto ovvio, ma oggi nasce con lo stesso peso.
- Durante la distillazione si misura quanto è stata faticosa la parte di sessione da cui nasce il ricordo: comandi falliti, tentativi ripetuti, durata, messaggi dell'utente. Il dato c'è già nella trascrizione e non richiede chiamate LLM in più.
- Il ricordo nasce con un'importanza iniziale più alta, che decade normalmente se poi nessuno lo usa. Si vede nel dettaglio del ricordo («nato da una sessione difficile»).
- Tarato il 2026-10-22 su 196 capitoli reali: la prima ipotesi (6 errori, 60 minuti, 12 messaggi) rendeva «difficile» il 43% dei capitoli; scelte con l'utente 15 errori, 120 minuti, 25 messaggi (circa uno su cinque).

**4. Ricevuta di redazione.**
- Oggi la redazione di un admin toglie il contenuto da tutti i nodi, ma chi l'ha chiesta non sa quando è successo davvero su ognuno.
- Ogni nodo, dopo aver tolto il contenuto (indice, export Markdown, cache), pubblica un evento firmato di conferma con l'id del ricordo e l'istante.
- Nella UI, per ogni redazione: elenco dei membri con «confermato il …» o «in attesa» (nodi spenti). Esportabile, per chi deve dimostrare a un cliente che un dato è stato tolto.
- Limite da scrivere nella guida: la ricevuta dice che il software ha tolto il dato, non che nessuno ne abbia fatto una copia a mano.

**Ordine proposto:** 1, poi 2, poi 4, poi 3. Il primo ha l'effetto più diretto sull'efficacia ed è il più piccolo; il terzo richiede di tarare le soglie su dati veri.

**Per ogni punto:** guida in-app IT/EN con il funzionamento interno, testi della UI nelle due lingue, test unitari e d'integrazione, prova a scala con migliaia di ricordi.

### B10 in dettaglio: chat AI sulla memoria, con mappa mentale del sapere

**Richiesta (2026-10-20).** Una chat AI per interrogare la memoria e ricostruire un albero navigabile di collegamenti e know-how, leggibile da una persona.

**Decisioni dell'utente:**
- l'albero è una **mappa mentale**;
- le risposte buone si salvano come ricordo con un pulsante;
- la cronologia resta solo su questo PC.

**Come funziona per chi la usa.** Pagina «Chiedi»: a sinistra la conversazione, a destra la mappa mentale. Si fa una domanda in linguaggio normale e si ricevono due cose:
1. **una risposta scritta solo sui ricordi e sulle Radici del team**, con i riferimenti numerati ai ricordi d'origine. Se la memoria non lo sa, lo dice e propone di segnalare la lacuna al team;
2. **la mappa mentale dell'argomento**: la domanda al centro, i temi intorno, poi i ricordi. Le linee mostrano i collegamenti (approfondisce, dipende da, contraddice, simile). Un clic su un ricordo lo apre; «espandi» aggiunge i suoi vicini.

Le domande successive tengono conto della conversazione. Sotto ogni risposta c'è «Salva come ricordo».

**Piano:**
1. **Ricerca, senza LLM e subito:**
   - ricerca ibrida (parole chiave + significato) e Radici pertinenti;
   - allargamento di un passo sui collegamenti della costellazione (tag in comune, significato, dreaming);
   - al massimo ~30 ricordi, ordinati per pertinenza e attivazione.
2. **Mappa, subito:** i ricordi trovati si raggruppano in temi con lo stesso metodo delle galassie (comunità sui collegamenti) e ogni tema prende il nome dai tag caratteristici. Ogni ricordo mostra titolo e prima riga. La mappa compare prima della risposta.
3. **Risposta, LLM:**
   - una chiamata con i ricordi trovati come unico materiale. Regola: niente fuori da lì, ogni affermazione con il suo riferimento, «non lo so» se manca;
   - nella stessa chiamata l'LLM dà ai temi della mappa un nome leggibile;
   - modello e budget giornaliero sono quelli già configurati (Impostazioni → LLM);
   - le domande successive portano con sé le ultime 3 domande e risposte.
4. **Espandi un ricordo:** i suoi vicini nella costellazione si aggiungono alla mappa, senza LLM.
5. **Salva come ricordo:** la risposta diventa un ricordo del team, con l'elenco dei ricordi d'origine. Passa dalla stessa strada di un salvataggio esplicito (filtro privacy, eventuale Inbox).
6. **Cronologia** in `private.db`: conversazioni e messaggi, da riaprire, rinominare o cancellare. Solo su questo PC.
7. **Efficacia:** le domande della chat compaiono fra le consultazioni (canale «chat»).
8. **Prestazioni:** ricerca e mappa in meno di 100 ms anche con 5 000 ricordi; nessuna attesa dell'LLM per vedere la mappa. Prova a scala.
9. **Guida** «Chiedi» IT/EN con il funzionamento interno; test unitari (ricerca allargata, temi della mappa) e d'integrazione (domanda, risposta, salvataggio, cronologia) con l'LLM finto.

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
| 2026-10-18 | Correzioni dalla prova reale (versione 0.3.2): Nucleo ancora bianco con i filtri per autore/tipo e nel tour (le Radici accese tornavano a piena luce; oltre 20 Radici ora stanno nel guscio, quelle spente senza anello, tour con distanza in base all'ampiezza della tappa); Mappa 2D con il dettaglio fuori schermo (ora sopra la mappa); contesto per richiesta ancora fuori tema (ora passa solo ciò che si distacca dagli altri: media + 2 deviazioni standard), callout di Obsidian nella prima riga |
| 2026-10-18 | Correzioni dalla prova reale (versione 0.3.1): Nucleo inusabile con 63 Radici da un vault (nucleo che si allarga con il numero di Radici, Radici e anelli attenuati quando sono tante); import che lasciava l'intestazione YAML di Obsidian nel testo e collegava tutto con il tag `import` (ora titolo e tag dall'intestazione, e reimportare aggiorna i file cambiati); contesto per richiesta con Radici fuori tema (soglia più alta e uguale per ricordi e Radici) |
| 2026-10-18 | Installer di Windows (7.7) sul branch `feature/installer-windows`, su richiesta dell'utente per provare una versione reale. Trovati e risolti: electron-builder esclude `node_modules` dalle risorse extra (copia in `afterPack`), metteva il `node_modules` della radice in `app.asar`, Windows Defender blocca a tratti `Micelio.exe` (nuovi tentativi) |
| 2026-10-20 | B10 chat sulla memoria (branch `feature/chat-memoria`). Con le misure delle galassie (gruppi fino a 150 ricordi) la mappa di una domanda finiva in un tema solo: aggiunte misure per la chat (temi da al massimo un terzo dei ricordi). Mappa resa leggibile dopo la prima cattura: temi raccolti a 3 ricordi, collegamenti non del dreaming solo al passaggio del mouse, colonne più strette |
| 2026-10-19 | B11 efficacia. Misurando il contesto automatico sul PC dell'utente: ogni messaggio a Claude Code aspettava ~2,3 s per un timer di sicurezza che teneva vivo l'hook (ora ~0,4 s; con il daemon occupato l'hook arrivava al limite di 10 s e veniva annullato, 6 volte su 14 in una giornata). Prova di carico: senza WAL ogni scrittura su SQLite costava ~12 ms (attesa del disco), ora 0,14 ms; il resoconto leggeva al massimo 5 000 consultazioni (totali sbagliati oltre), corretto |
| 2026-10-19 | B9 pacchetti Linux, costruiti in un container `node:24-bookworm`. Trovati e corretti: il .deb richiede `homepage`; su un sistema minimo l'app non partiva per la libreria audio mancante (aggiunta alle dipendenze). Riverificato anche l'installer di Windows con le parti comuni |
| 2026-10-19 | B8 server privato: con due nodi sullo stesso PC il server privato funziona (invito in 1 s); il caso reale (due reti diverse, 0 peer) non si riproduce da un PC solo. Aggiunti relay sul server e log dell'attività. Prototipo verificato prima: un nodo DHT risponde anche per i servizi in ascolto su sé stesso, quindi il relay non richiede un'altra porta. Il relay si usa solo se risponde, altrimenti con un server vecchio due PC resterebbero scollegati per sempre |
| 2026-10-19 | B7 backup e ripristino (branch `feature/backup-team`). Trovati e corretti con la prova a 5 000 ricordi: vettori salvati con un commit su disco per riga (33 s, ora una transazione per gruppo), vicini per significato aggiornati uno per uno anche con migliaia di ricordi nuovi (13 s, ora ricalcolo unico in sottofondo): servono anche a import e primo avvio. Ripristino da 58 s a ~10 s. Corretto anche un errore della CLI di Windows all'uscita con errore dopo più chiamate al daemon |
| 2026-10-18 | Galassie e prestazioni a scala (branch `feature/galassie`), su richiesta dopo la prova con un vault: «2 secondi è tollerabile, decine significa non usare il sistema». Prova di carico a 5 000 ricordi: trovati e corretti stack overflow nella costellazione (~1 800 ricordi), vicini per significato ricalcolati da zero a ogni scrittura (ora incrementali e salvati), indice ricostruito da zero, attivazione con una lettura per ricordo (2,1 s → 40 ms) |
| 2026-10-18 | Server del team in Docker (branch `feature/server-docker`): `server/Dockerfile` su Debian slim (su Alpine `udx-native` non ha binari musl e il server non partiva). Provato in locale con due client DHT che si trovano tramite il container; immagine pubblicata nel registry dell'utente |
| 2026-10-18 | B4 completato sul branch `feature/contesto-e-qualita`: contesto automatico (hook SessionStart e UserPromptSubmit), lacune e riepilogo settimanale (pagina Riepilogo, notifica del lunedì), CLAUDE.md / AGENTS.md / regole di Cursor dalle Radici e import di ADR, aggiornare invece di aggiungere, ricordi che invecchiano con il codice, modalità solo locale e ricordi personali. Trovati e corretti due difetti: condividere un ricordo personale veniva scambiato per un duplicato di se stesso; `git log --since` saltava commit con date fuori ordine (ora si legge la storia dei soli file citati) |
| 2026-10-18 | B3 completato sul branch `feature/multi-team`: più team sullo stesso PC con sapere separato e identità personale comune (scelta dell'utente: «stessa persona + team»). Trovato e corretto un difetto di `canonicalPath`: per un percorso inesistente non espandeva i nomi corti 8.3 di Windows |
| 2026-10-18 | B2 completato sul branch `feature/guida-in-linea`: guida in linea in italiano e inglese, «?» contestuali, F1, pagina Guida. Il test di parità ha confermato che tutte le 21 voci hanno le stesse sezioni nelle due lingue |
| 2026-10-21 | Bug grave corretto sul branch `fix/mcp-team-cartella` (0.5.1): l'MCP utente era registrato via HTTP e lavorava sempre sul team predefinito, così 25 ricordi salvati da una sessione in un progetto del team A erano finiti nel team B, quello predefinito. Ora l'MCP utente è lo shim stdio `micelio mcp`, che manda la cartella del progetto a ogni richiesta, e il daemon sceglie il team che la possiede. `remember` dice in quale team pubblica. I 25 ricordi sono stati copiati nel team A e redatti dal team sbagliato |
| 2026-10-21 | Avvio lento corretto sul branch `fix/avvio-lento` (0.5.2): il daemon ci metteva 55 s a partire (l'app ne aspettava 30 e diceva «daemon non attivo»), per la scansione sincrona di una trascrizione da 209 MB. Cause: il controllo dei file sensibili ricompilava 33 espressioni per ogni parola (36 s su 40); la scansione girava nel thread principale e durante l'avvio. Ora espressioni in cache, trascrizioni lette in un worker thread, prima scansione dopo l'avvio, sessioni non mature non rilette, attesa dell'app a 90 s. Blocco massimo del thread principale con la trascrizione da 209 MB: 51 ms |
| 2026-10-21 | Aggiunto al backlog B12 «Memoria che impara dall'uso»: abituazione, sinapsi da uso congiunto, peso alle scoperte sudate, ricevuta di redazione. Idee prese dal confronto con Spector, segnalato in un commento al post LinkedIn |
| 2026-10-22 | «Collega Claude Code» funziona su ogni installazione, sul branch `fix/collega-claude-code` (0.5.3): alcuni colleghi non vedevano Micelio in `/mcp`. Cause: `claude` lanciato senza shell non parte se è il `claude.cmd` di npm o se c'è solo l'estensione di VS Code, e un collega usa Claude Code con un'utenza amministrativa diversa da quella di Micelio. Ora `claude` si cerca anche fuori dal PATH (nativo, npm tramite `cli.js`, WinGet, estensioni di VS Code, Cursor, Windsurf), anche per la distillazione; se manca, la registrazione si scrive in `~/.claude.json`; se Claude Code non è mai stato usato dall'utente di Micelio compare un avviso |
| 2026-10-22 | B12 completato sul branch `feature/memoria-dall-uso` (0.6.0). (1) Abituazione: serie di esiti senza uso dagli esiti di questo PC, peso pieno nel contesto automatico e metà nelle ricerche, un esito utile azzera. (2) Sinapsi d'uso: coppie di ricordi utili nella stessa sessione, evento `couse.report`, nuovo tipo di sinapsi e vicini portati nella ricerca. (4) Ricevuta di redazione: pulizia di chat, Inbox e copie personali, evento `redact.ack` firmato Ed25519, scheda Sicurezza → Redazioni, `micelio redactions`. (3) Scoperte sudate: fatica del capitolo in `source.effort`, vantaggio fino a +0,15 nell'attivazione. Tempi della chat su 5 000 ricordi invariati rispetto a develop |
| 2026-10-23 | B13 fase 1 sul branch `feature/repo-pubblica`: repository pronta per essere pubblica. Licenza GNU AGPL-3.0 (scelta dell'autore) con CLA, così resta possibile rilasciare Micelio anche con un'altra licenza; README, CONTRIBUTING, SECURITY, codice di condotta, CHANGELOG, template di GitHub e controllo del CLA; scheda «Informazioni» nelle Impostazioni con il link al sorgente (richiesto di fatto dall'AGPL) e licenza dentro gli installer. Tolti dai file l'IP del server del team, nomi di persone, di team e di progetti di lavoro, e il codice degli spike. Trovato che il commit 0.4.1 (Wayland su Linux, di Federico Partesano) esiste solo su `origin/main` |
| 2026-10-24 | Ricordi ancora nel team sbagliato, corretti sul branch `fix/team-sbagliato` (0.6.1): una sessione di Claude Code aperta la sera prima, con la registrazione MCP utente ancora HTTP (mai aggiornata dopo la 0.5.1), ha salvato 3 ricordi di un progetto del team A nel team predefinito B, anche dopo che la cartella era stata abilitata in A (spostati a mano in A e redatti da B). Cause: l'aggiornamento dell'app non cambiava la registrazione, e senza cartella il daemon usava il predefinito in silenzio. Ora il daemon migra all'avvio le registrazioni HTTP vecchie allo shim (con backup di `~/.claude.json`), e su richiesta dell'utente `remember` controlla sempre la cartella della sessione contro le cartelle abilitate di tutti i team: se non corrisponde al team il ricordo va in Inbox con problema e soluzione, e «Pubblica in…» lo porta nel team giusto. «Collega Claude Code» per cartella registra lo shim, non fissa più un team |
| 2026-10-26 | B13 fase 1, ultimo passo: la repository pubblica è nuova, `micelio-second-brain`, e la vecchia `micelio-brain` resta privata come archivio (più semplice che eliminarla e ricrearla). Sul branch `fix/nome-repo` aggiornati tutti gli indirizzi (package.json, README, CONTRIBUTING, SECURITY, CHANGELOG, template di GitHub, link al sorgente nelle Impostazioni): gli aggiornamenti automatici leggeranno questo indirizzo. La storia pubblicata è quella riscritta (email personale, Federico Partesano con il suo indirizzo noreply di GitHub, niente IP né nomi interni) |
| 2026-10-26 | Revisione di sicurezza prima di pubblicare la repository (tre revisioni in parallelo: accesso ai team, superfici locali, segreti nella storia). Esito: dall'esterno non si entra in un team (dati cifrati con chiave casuale, inviti monouso senza la chiave, eventi firmati, ruoli controllati nel registro); storia pulita. Corretto sul branch `fix/sicurezza`: lettura di file arbitrari tramite il riferimento di un ricordo «da documento»; chiavi del team consegnate anche a un ingresso scartato; daemon che cadeva con una richiesta d'ingresso malformata; cartelle fuori da tutti i team che ricevevano la memoria del team predefinito (ora niente contesto e strumenti di lettura bloccati, `remember` va in Inbox); «sì» non firmato per i documenti originali; `~/.micelio` leggibile dagli altri utenti su macOS/Linux; Radici solo per gli admin (impostazione `roots.adminOnly`, accesa nei team nuovi). SECURITY.md con i limiti noti. Da pianificare: rotazione della chiave alla rimozione di un membro, daemon che dimostra la propria identità ai client, chiave casuale del relay, installer che non chiude Micelio |
| 2026-10-26 | 0.6.2 sul branch `fix/installer-e-identita`, gli altri punti della revisione di sicurezza: (A) l'installer di Windows chiude davvero Micelio (segnale «installazione in corso» che ferma i riavvii di hook e shim, stop ordinato, chiusura di tutti i processi della cartella con 10 tentativi; la causa del bug della 0.6.1 era il riavvio continuo del daemon da parte di hook e shim); (B) il daemon dimostra la propria identità prima che un client gli mandi il token (`GET /api/hello`, HMAC di un numero casuale con il token; lo shim e l'app la richiedono a ogni chiamata); (C) relay del server con chiave casuale (server 0.3.0): indirizzo per i PC `host:porta#chiave`, chiave vecchia accesa per la transizione finché `MICELIO_SERVER_RELAY_LEGACY=0`. Resta la rotazione della chiave alla rimozione di un membro (0.7.0), con il suo piano |
| 2026-10-26 | 0.7.0 sul branch `feature/chiavi-per-generazione`: protezione completa, al posto della rotazione con copia in un registro nuovo (scartata dall'utente perché fragile: autori persi, migrazioni, membri offline). (1) Cancello sulle connessioni: replica solo dopo la prova di appartenenza firmata sulla sessione Noise, riesame a ogni aggiornamento; trovati e corretti due problemi di tempi (canale aperto prima che l'altro lato fosse pronto, prova non partita nella callback di apertura). (2) Chiavi X25519 dei membri ricavate dal Corestore. (3) Contenuto cifrato per generazione, rotazione automatica quando la generazione corrente è stata data a un rimosso, consegna a chi entra, catena delle chiavi; un ricordo non apribile non entra nell'indice e la versione letta conta le chiavi. (4) Accensione per i team esistenti quando tutti hanno la 0.7.0, senza ritorno, cambio di chiave a mano, scheda nella pagina Team. Prova a scala: 5 000 ricordi cifrati, apertura sotto i 100 ms in più della lettura |
| 2026-10-26 | B13 fase 2 sul branch `feature/ci`: CI con GitHub Actions. `ci.yml` (typecheck, build, test del daemon e della UI su Linux, Windows e macOS con Node 22, più Node 24 su Linux; build del server; dependency review sulle PR), `codeql.yml` (analisi di sicurezza, anche settimanale), Dependabot verso `develop`. Regole da repository pubblica: permessi minimi, azioni fissate allo SHA (anche quella del CLA), niente `pull_request_target` con codice della PR. Fuori dalla CI: scenario Docker (DHT pubblica) e set di valutazione (Claude reale) |
