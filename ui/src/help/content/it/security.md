# Sicurezza

Password, token, chiavi e file come `.env` non entrano mai nel sapere del team: vengono tolti sul tuo PC prima di qualunque AI. La schermata **Sicurezza** mostra le regole, permette di provarle e di sistemare ciò che è già stato pubblicato.

## Cosa viene riconosciuto {#detectors}

Sempre, senza configurazione: chiavi e token di Anthropic, OpenAI, AWS, Azure (chiavi degli account e firme SAS), Google, GitHub, GitLab, npm, PyPI, Slack, Stripe, SendGrid; JWT; header `Authorization` e `Bearer`; chiavi private PEM (anche dentro i JSON); password in stringhe di connessione e URL; variabili come `API_KEY=…` o `"password": …`; IBAN, codici fiscali, email, telefoni. Ogni valore diventa un segnaposto come `[REDACTED:aws-key]`.

## Le stringhe casuali {#entropy}

Un segreto senza formato noto (una chiave generata) viene riconosciuto dall'**entropia**: almeno 32 caratteri con maiuscole, minuscole e cifre, molto "casuali" (≥ 4 bit per carattere). Gli hash esadecimali (commit, id) sono esclusi apposta. La redazione è **idempotente**: un segnaposto non viene riconosciuto di nuovo.

## I file sensibili {#files}

`.env` e varianti, chiavi (`*.pem`, `*.key`, `id_rsa`…), `credentials`, `secrets.*`, kubeconfig, `.npmrc`, `.netrc`, `*.tfvars`, `*.tfstate`… Il loro **contenuto** non entra mai: nelle sessioni, se Claude li legge, scrive o modifica (anche con `cat .env`), input ed esito dello strumento spariscono per intero; nelle cartelle di documenti non si aprono; nel riassunto git compare solo il nome. I file di esempio (`.env.example`…) non sono sensibili.

## Le regole del team {#team-rules}

L'admin può aggiungere, per tutti i nodi (eventi `team.config`):
- **pattern** di segreti propri (espressioni regolari con un nome, es. un codice cliente interno): quelli non validi o troppo generici vengono rifiutati;
- **eccezioni** per i falsi positivi: testo o `/regex/`;
- **file sensibili** aggiuntivi: glob come `**/*.conf`.

## Il banco di prova {#bench}

Incolli un testo o scrivi un nome di file e vedi cosa verrebbe tolto, con le regole in vigore. Non viene salvato nulla. Da terminale: `micelio security test "…"`.

## Ripulire ciò che è già pubblicato {#scan-clean}

«Scansiona i ricordi» controlla i ricordi pubblicati con le regole **attuali** (utile dopo aver aggiunto un pattern). «Ripulisci» (solo admin) pubblica la versione redatta, rimuove l'originale dalla vista di tutti (`memory.redact`) e, se era una Radice, lo resta. Ogni PC conferma la redazione: vedi **Redazioni e ricevute**. Limite: chi l'aveva già letto o esportato a mano ne conserva una copia, e i blocchi cifrati restano nel log.

## Redazioni e ricevute {#redactions}

Quando un admin toglie un ricordo per tutto il team («Ripulisci» qui sopra, o `micelio redact`), ogni PC, appena riceve la redazione, toglie il ricordo anche dalle copie locali e lo **conferma**. La scheda **Redazioni** mostra per ogni ricordo redatto data, admin, motivo e quanti PC hanno confermato; aprendola si vede ogni membro:

- **confermato il …**, con cosa ha ripulito e se la conferma è firmata;
- **in attesa**: il PC è spento o ha una versione precedente alla 0.6.0; confermerà alla prossima accensione dopo l'aggiornamento;
- **uscito dal team** senza confermare: non conta nel totale.

**Esporta ricevuta** produce un testo leggibile (nella lingua dell'app) o un JSON con le firme, da consegnare a chi deve sapere che il dato è stato tolto, per esempio un cliente. Da terminale: `micelio redactions` per l'elenco, `micelio redactions <id>` per la ricevuta (`--json`, `--en`).

**Cosa ripulisce ogni PC**, oltre a indice di ricerca, vettori ed export Markdown (già tolti dalla redazione stessa):
- le **risposte della chat** che citavano il ricordo o lo mostravano nella mappa: restano come «risposta rimossa»;
- le **proposte in Inbox** con lo stesso contenuto;
- la **copia personale** dello stesso ricordo, se c'era.

**I backup non si toccano**: cancellarli o riscriverli è troppo rischioso. Ogni PC conta i backup automatici di questo team fatti prima della redazione e ancora nella cartella dei backup, e li dichiara nella ricevuta: chi li conserva li cancella se serve.

**Limiti, scritti anche nella ricevuta.** La ricevuta attesta cosa ha fatto il software sui PC che hanno confermato. Non può garantire che nessuno abbia fatto una copia a mano (testo copiato, screenshot, file esportati), né conoscere backup fatti a mano in altre cartelle. I blocchi cifrati del registro del team restano; nessun nodo ne mostra più il contenuto.

**Come funziona dietro.** La redazione (`memory.redact`) ora registra quando e da quale admin. A ogni aggiornamento della vista, ogni nodo cerca i ricordi redatti che non ha ancora confermato, fa la pulizia locale e pubblica l'evento `redact.ack` con l'istante, cosa ha ripulito e quanti backup restano. Ogni nodo conferma solo per sé (l'evento sta nel suo feed firmato) e vale la prima conferma. Se il PC ha un'**identità personale** (`identity.json`), la conferma porta anche una firma Ed25519 sul testo `micelio/redact-ack/v1:<ricordo>:<nodo>:<istante>`: il JSON della ricevuta contiene testo, chiave pubblica e firma, così chiunque può verificarla con uno strumento standard, senza Micelio. Ogni nodo tiene la firma solo se è valida. I nodi di versioni precedenti ignorano l'evento e restano «in attesa». Codice: `src/insight/redaction-receipt.ts`.

## Il registro {#log}

Cosa il filtro ha tolto su **questo PC**, da quale sessione o documento, di che tipo. Si registrano solo tipi e nomi dei file, **mai i valori**. Sta in `private.db` e non lascia il PC.
