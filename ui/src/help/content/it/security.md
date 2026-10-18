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

«Scansiona i ricordi» controlla i ricordi pubblicati con le regole **attuali** (utile dopo aver aggiunto un pattern). «Ripulisci» (solo admin) pubblica la versione redatta, rimuove l'originale dalla vista di tutti (`memory.redact`) e, se era una Radice, lo resta. Limite: chi l'aveva già letto o esportato ne conserva una copia, e i blocchi cifrati restano nel log.

## Il registro {#log}

Cosa il filtro ha tolto su **questo PC**, da quale sessione o documento, di che tipo. Si registrano solo tipi e nomi dei file, **mai i valori**. Sta in `private.db` e non lascia il PC.
