# Micelio — Documento di design

> Secondo cervello distribuito, peer-to-peer, per gli strumenti AI di un team di sviluppo.
> Stato: **bozza v0.1** — 2026-10-17

---

## 1. Visione

Micelio è una memoria condivisa per agenti AI (Claude Code, Codex CLI, assistenti negli IDE) che **non ha un server centrale**.
Ogni macchina del team esegue un **nodo**. I nodi formano una rete diffusa, come il micelio di un fungo: la conoscenza prodotta su un nodo si propaga a tutti gli altri e, a sincronizzazione completata, **ogni nodo possiede il 100% del sapere condiviso**.

Conseguenze desiderate:

- chi entra nel team riceve subito tutto il know-how accumulato;
- ognuno lavora in autonomia, anche offline, e si riallinea automaticamente quando torna in rete;
- non esiste un single point of failure né un server da mantenere.

Oltre alla sincronizzazione, il brain ha un ciclo di vita proprio:

- **filtro in ingresso**: non tutto ciò che passa per un agente AI diventa sapere del team (es. una mail di valutazione di una risorsa);
- **indicizzazione per priorità**: i ricordi più utili emergono per primi;
- **dreaming**: consolidamento periodico che fonde duplicati, collega concetti, rileva contraddizioni e lascia decadere i ricordi diventati inutili.

### Principi

1. **Eventi, non stato.** Si replicano eventi immutabili e firmati. Lo stato è una vista ricalcolata in modo deterministico, identica su ogni nodo.
2. **Privato per default.** Un contenuto entra nel sapere del team solo se supera il filtro. Nel dubbio resta sulla macchina.
3. **Distillato, mai grezzo.** Nella rete viaggiano lezioni estratte, non trascrizioni né file originali.
4. **Niente si cancella davvero, tutto può decadere.** Archiviazione reversibile al posto della cancellazione (con l'eccezione della redazione, §10.3).
5. **Derivato = locale.** Indici full-text, vettori ed export si rigenerano su ogni nodo e non si sincronizzano.
6. **Nessuna API key.** L'intelligenza (classificazione, distillazione, dreaming) usa le CLI AI già installate e autenticate sulla macchina dell'utente.

---

## 2. Decisioni di base

| Tema | Decisione | Note |
|---|---|---|
| Rete | Internet, nodi ovunque | DHT + attraversamento del NAT, nessun server |
| Scala | 10–30 nodi | Mesh completa praticabile; dreaming coordinato |
| LLM | `claude` (Claude Code) o `codex` (Codex CLI), headless da terminale | Niente API; adapter configurabile per nodo |
| Sorgenti | Claude Code, Codex CLI, VS Code, WebStorm, cartelle di documenti (PDF, DOCX, XLSX…) | MCP + hook + watcher |
| Documenti | Viaggia solo la conoscenza distillata | L'originale resta sulla macchina del proprietario |
| Ambiti | `private` + `team` | Un progetto con persone diverse è un **team separato**, non un sotto-ambito |
| Lingua dei ricordi | Configurazione di team (`memory.language`) | Una lingua fissa per tutti i ricordi |
| Membership | Ogni membro può invitare, solo gli admin rimuovono | Ogni ingresso registra chi ha invitato |
| Runtime | Node.js (≥ 22 LTS), TypeScript | |

---

## 3. Architettura del nodo

Ogni macchina esegue un **daemon** `micelio` sempre attivo, più una CLI `micelio` per l'amministrazione.

```
┌──────────────────────────────── Nodo Micelio (daemon) ────────────────────────────────┐
│                                                                                       │
│  SORGENTI                      INGESTIONE                         CONOSCENZA          │
│  ┌────────────────────┐   ┌──────────────────────────────┐   ┌─────────────────────┐  │
│  │ Hook Claude Code   │──▶│ 1. Estrazione testo          │   │ Log eventi "team"   │◀─┼──▶ Rete P2P
│  │ Sessioni Codex     │   │ 2. Filtro deterministico     │──▶│ (Autobase/Hypercore)│  │   (Hyperswarm)
│  │ MCP remember()     │   │ 3. Classificazione (LLM)     │   └─────────┬───────────┘  │
│  │ Watcher cartelle   │   │ 4. Distillazione (LLM)       │             │ apply()      │
│  └────────────────────┘   │ 5. Redazione segreti         │   ┌─────────▼───────────┐  │
│                           └──────────────┬───────────────┘   │ Vista materializzata│  │
│                                          │                   │ SQLite + FTS5 + vec │  │
│                           ┌──────────────▼───────────────┐   └─────────┬───────────┘  │
│                           │ Archivio "private" + Inbox   │             │              │
│                           │ (solo locale, mai replicato) │   ┌─────────▼───────────┐  │
│                           └──────────────────────────────┘   │ Recall / Ranking    │  │
│                                                              │ (ibrido + attivaz.) │  │
│  ┌────────────────────┐   ┌──────────────────────────────┐   └─────────┬───────────┘  │
│  │ Adapter LLM (CLI)  │◀──│ Coda lavori LLM              │             │              │
│  │ claude -p │ codex  │   │ (ingestione, dreaming)       │   ┌─────────▼───────────┐  │
│  └────────────────────┘   └──────────────────────────────┘   │ Server MCP          │◀─┼── Claude Code, Codex,
│                           ┌──────────────────────────────┐   │ (HTTP locale+stdio) │  │   VS Code, WebStorm
│                           │ Dreamer (epoche)             │   └─────────────────────┘  │
│                           └──────────────────────────────┘   Export Markdown (r/o)    │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Componenti

| Componente | Responsabilità |
|---|---|
| **Net** | Identità del nodo, discovery (Hyperswarm), replica dei log, pairing/inviti |
| **Log** | Scrittura di eventi firmati sul proprio feed, unione multi-writer (Autobase) |
| **View** | Funzione `apply(eventi) → stato` deterministica, persistita in SQLite |
| **Index** | FTS5 (keyword) e sqlite-vec (semantica) derivati localmente dalla vista |
| **Ingest** | Pipeline sorgenti → filtro → classificazione → distillazione → evento |
| **LLM** | Adapter verso le CLI `claude` / `codex`, con coda, timeout, validazione output |
| **Dreamer** | Consolidamento periodico, coordinato fra i nodi |
| **MCP** | Espone `recall`, `remember` e gli altri tool agli strumenti AI |
| **Export** | Rigenera una vista Markdown in sola lettura, consultabile a mano |

---

## 4. Modello dati

### 4.1 Eventi

Tutto ciò che modifica il sapere del team è un **evento** appeso al feed del nodo autore. Ogni evento ha un envelope comune:

```ts
interface Envelope<T> {
  v: 1;                     // versione schema
  type: string;             // es. "memory.add"
  id: string;               // hash del payload (content-addressed)
  node: string;             // chiave pubblica del nodo autore
  ts: number;               // timestamp del nodo autore (informativo, non usato per ordinare)
  payload: T;
}
```

L'ordinamento è **causale**, fornito da Autobase: non si usano gli orologi dei nodi per risolvere i conflitti.

| Evento | Payload (sintesi) | Effetto sulla vista |
|---|---|---|
| `memory.add` | `Memory` (vedi 4.2) | Crea un ricordo (idempotente sullo stesso `id`) |
| `memory.supersede` | `{ old: id[], new: Memory, reason }` | Il nuovo ricordo sostituisce i vecchi, che restano consultabili come storico |
| `memory.link` | `{ from, to, rel }` | Arco nel grafo (`relates`, `refines`, `contradicts`, `depends-on`) |
| `memory.vote` | `{ id, delta: +1 \| -1 }` | Segnale esplicito di utilità |
| `memory.pin` / `unpin` | `{ id }` | Protegge dal decadimento |
| `memory.archive` / `restore` | `{ id, reason }` | Esce dalla ricerca di default / rientra |
| `memory.redact` | `{ id, reason }` | Rimuove il contenuto dalla vista e chiede ai nodi di eliminare i blocchi (§10.3) |
| `usage.report` | `{ period, counts: { [id]: n } }` | Contatori d'uso aggregati dal nodo (G-Counter) |
| `dream.claim` | `{ epoch }` | Il nodo dichiara di sognare per l'epoca |
| `dream.complete` | `{ epoch, summary, stats }` | Diario dei sogni |
| `team.config` | `{ key, value }` | Configurazione condivisa (es. `memory.language`, modello di embedding) |
| `member.add` | `{ node, name, role, invited_by }` | Nuovo writer (§9); pubblicabile da qualunque membro |
| `member.remove` | `{ node, reason }` | Rimozione di un writer; valido solo se l'autore è `admin` |

### 4.2 Ricordo (`Memory`)

```ts
interface Memory {
  kind: 'fact' | 'howto' | 'decision' | 'gotcha' | 'snippet' | 'reference';
  title: string;            // una riga, autoesplicativa
  body: string;             // Markdown, atomico e autosufficiente
  tags: string[];           // tecnologie, progetti, domini
  applies_to?: string[];    // es. ["repo:smartlookup", "stack:angular@17"]
  source: {
    type: 'claude-code' | 'codex' | 'mcp' | 'document' | 'manual' | 'dream';
    ref: string;            // id sessione o hash del percorso: mai il percorso in chiaro
    hash?: string;          // hash del contenuto d'origine
  };
  confidence: number;       // 0..1, assegnato da distillazione / dreaming
}
```

`id = sha256(kind + normalize(title + body))`: due nodi che distillano lo stesso ricordo producono lo stesso id, quindi i duplicati esatti si eliminano da soli.

### 4.3 Vista materializzata (SQLite)

Tabelle principali: `memories` (stato corrente, `status`: `active | superseded | archived | redacted`), `links`, `usage` (per nodo e periodo), `votes`, `pins`, `members`, `dreams`.
Indici derivati: `memories_fts` (FTS5) e `memories_vec` (sqlite-vec). La vista si può sempre ricostruire da zero rileggendo i log.

---

## 5. Rete e replica

### 5.1 Stack

- **Hypercore**: log append-only firmato, uno per nodo.
- **Autobase**: unisce i log di più writer in un ordine causale deterministico e calcola la vista con una funzione `apply`.
- **Hyperswarm**: discovery tramite DHT e attraversamento del NAT. Il topic è `hash(team_secret)`. Le connessioni sono cifrate con Noise.
- **Corestore**: gestione locale dei core.

Riferimento implementativo utile: **Autopass** (password manager P2P di Holepunch costruito su Autobase con inviti via blind-pairing). Ha esattamente la nostra forma: pochi writer, replica completa, inviti.

### 5.2 Comportamento

- All'avvio il nodo entra nel topic del team e replica i feed di tutti i membri da qualunque peer disponibile.
- Non serve che l'autore sia online: basta un nodo qualsiasi che possieda i suoi blocchi.
- Con 10–30 nodi ogni nodo può mantenere connessioni con tutti i peer online.
- Volume stimato: 10.000 ricordi × ~2 KB ≈ 20 MB. La replica completa è banale anche per un nuovo ingresso.
- I blocchi del feed `team` sono **cifrati con la chiave di team**, così anche un peer non autorizzato che li ottenesse non li potrebbe leggere.

### 5.3 Ambiti

| Ambito | Dove vive | Replica |
|---|---|---|
| `private` | SQLite locale separato | **Mai**: non è un Hypercore, quindi è strutturalmente impossibile che finisca in rete |
| `inbox` | Parte di `private`, con stato "in attesa di revisione" | Mai |
| `team` | Autobase del team | Tutti i membri |

La promozione `private → team` è un'azione esplicita: genera un nuovo `memory.add` sul feed team.

Non esistono sotto-ambiti per progetto. Se un gruppo di persone deve condividere conoscenza che non deve arrivare al resto, forma un **team Micelio separato** (rete, chiave e membri propri). Il supporto a più team sullo stesso nodo è un'estensione futura, fuori dalla roadmap attuale.

---

## 6. Pipeline di ingestione

```
sorgente ─▶ estrazione ─▶ filtro deterministico ─┬─▶ BLOCCATO ─▶ private (nessuna chiamata LLM)
                                                 │
                                                 └─▶ classificazione LLM ─┬─▶ discard
                                                                          ├─▶ private
                                                                          ├─▶ inbox (incerto)
                                                                          └─▶ team ─▶ distillazione ─▶ redazione segreti ─▶ memory.add
```

### 6.1 Sorgenti

| Sorgente | Meccanismo |
|---|---|
| **Claude Code** | Hook `SessionEnd`: riceve il percorso della trascrizione e la accoda |
| **Codex CLI** | Watcher sulla cartella delle sessioni di Codex (JSONL) e/o hook `notify` |
| **VS Code / WebStorm** | Tool MCP `remember` invocato dall'agente (con istruzioni nei file di regole del progetto) |
| **Cartelle documenti** | Watcher (`chokidar`) su cartelle indicate dall'utente, con glob di inclusione/esclusione |
| **Manuale** | `micelio remember "..."` da terminale |

**Anti-loop:** le chiamate CLI fatte da Micelio stesso girano con `MICELIO_INTERNAL=1`. Hook e watcher ignorano quelle sessioni, così una distillazione non viene a sua volta distillata.

### 6.2 Estrazione testo

| Formato | Libreria candidata |
|---|---|
| PDF | `unpdf` / `pdfjs-dist` |
| DOCX | `mammoth` |
| XLSX / CSV | `SheetJS` |
| PPTX, ODT, altri | `officeparser` |
| MD, TXT, codice | lettura diretta |

I documenti grandi vengono spezzati in sezioni prima della distillazione. Per ogni file si salva localmente `hash → ultimo stato elaborato`, così si rielabora solo ciò che cambia.

### 6.3 Filtro deterministico (locale, prima di ogni LLM)

Il filtro esiste perché le CLI inviano il contenuto al provider cloud: ciò che è palesemente sensibile **non deve nemmeno arrivarci**.

- **Percorsi:** glob bloccati (es. `**/HR/**`, `**/personale/**`, `**/contratti/**`).
- **Parole chiave:** lista configurabile (es. *valutazione*, *RAL*, *stipendio*, *performance review*, *colloquio*, *licenziamento*, *malattia*).
- **Pattern di dati personali:** codice fiscale, IBAN, numeri di telefono, indirizzi email di persone.
- **Segreti:** chiavi API, token, password, stringhe di connessione. In questo caso il contenuto **non** viene bloccato: i segreti vengono **redatti** (`[REDACTED:aws-key]`) prima di proseguire.

Un contenuto bloccato finisce in `private` senza chiamate LLM. Le regole stanno nella config del nodo, con un default di team distribuito tramite `team.config`.

### 6.4 Classificazione (LLM)

Prompt dedicato. Output JSON validato con `zod`:

```json
{
  "destination": "team | private | discard",
  "category": "technical | process | personal | hr | commercial | other",
  "sensitivity": ["personal-data", "evaluation", "credentials", "customer-data"],
  "reusable": true,
  "confidence": 0.0,
  "reason": "..."
}
```

Regola di instradamento:

- `team` **solo se** `destination = team`, `sensitivity` è vuoto e `confidence ≥ 0.8`;
- `discard` se il contenuto non contiene nulla di riutilizzabile;
- in tutti gli altri casi → **inbox**, che l'utente rivede con `micelio inbox` o con il tool MCP `inbox_review`. Gli elementi dell'inbox scadono dopo N giorni (default 14).

L'esempio della mail di valutazione si ferma già al filtro deterministico (parole chiave) oppure qui (`category: hr`, `sensitivity: evaluation`).

### 6.5 Distillazione (LLM)

Da una sessione o da un documento si producono **0..N ricordi atomici**:

- ogni ricordo è autosufficiente e comprensibile senza la conversazione d'origine;
- si generalizza: niente riferimenti a persone, clienti o dati non necessari al sapere tecnico;
- si preferiscono *perché* e *gotcha* alla cronaca ("abbiamo provato X, non funziona per Y, usare Z");
- zero ricordi è un risultato valido: la maggior parte delle sessioni non insegna niente di nuovo;
- i ricordi sono scritti nella lingua di team (`memory.language`, es. `it` o `en`), qualunque sia la lingua della fonte. Identificatori, nomi di API e frammenti di codice restano invariati.

**Perché una lingua fissa e non quella d'origine:** la ricerca full-text non funziona tra lingue diverse, e il consolidamento nel dreaming confronta e fonde meglio ricordi scritti nella stessa lingua. Se la lingua di team cambia, i ricordi esistenti non vengono tradotti in blocco: le versioni aggiornate nascono nella nuova lingua man mano che il dreaming li consolida.

Prima di scrivere si controlla l'hash dell'id per scartare i duplicati esatti. Le quasi-duplicazioni le gestisce il dreaming.

---

## 7. Adapter LLM via CLI

```ts
interface LlmAdapter {
  name: 'claude' | 'codex';
  available(): Promise<boolean>;
  run<T>(task: { prompt: string; input: string; schema: ZodSchema<T>; timeoutMs: number }): Promise<T>;
}
```

- **claude**: `claude -p` in modalità headless con output JSON, input passato via stdin.
- **codex**: `codex exec` in modalità non interattiva.
- Le invocazioni avvengono in una **cartella di lavoro vuota e isolata**, con tool e azioni disabilitati o in sandbox di sola lettura: l'agente deve solo rispondere, non agire sul filesystem.
- L'output viene validato con lo schema `zod`. Se non è valido si fa un retry con l'errore nel prompt (max 2), poi il lavoro viene scartato e registrato nei log.
- Una **coda unica** con concorrenza 1 e backoff rispetta i limiti degli abbonamenti. Ingestione e dreaming condividono la coda, con priorità all'ingestione.
- I flag esatti delle due CLI vanno verificati nello spike (Fase 0) e isolati nell'adapter, perché possono cambiare tra una versione e l'altra.

Un nodo senza CLI disponibile resta un nodo completo per replica e recall, ma non distilla e non sogna. Le sue sorgenti restano in coda finché una CLI non torna disponibile.

---

## 8. Recall, priorità e attivazione

### 8.1 Ricerca

Ricerca ibrida:

1. **FTS5** (BM25) sulla query;
2. **vettori** (similarità coseno) sull'embedding della query;
3. fusione con **Reciprocal Rank Fusion**;
4. ri-ordinamento finale: `rank = rrf × (1 + α · activation)`.

I ricordi `archived`, `superseded` e `redacted` sono esclusi di default (`include_archived` per includerli).

**Embedding locali** con `@huggingface/transformers` (transformers.js) e un modello multilingue piccolo (es. `multilingual-e5-small`). Restano locali, quindi coerenti con il vincolo "niente API". Il modello è fissato in `team.config`, così tutti i nodi calcolano vettori confrontabili. Se il modello cambia, ogni nodo reindicizza localmente.

### 8.2 Attivazione

Ispirata al livello base del modello ACT-R della memoria umana: ciò che è usato spesso e di recente è più accessibile.

```
activation(m) = w_r · recency(m)
              + w_u · log(1 + uses_team(m))
              + w_v · votes(m)
              + w_c · centrality(m)
              + pinned(m) · ∞

recency(m)    = exp(-ln2 · days_since_last_use(m) / half_life(kind))
```

- `uses_team`: somma dei `usage.report` di tutti i nodi. Un ricordo usato da molti colleghi pesa di più.
- `half_life` dipende dal tipo: `decision` 365 giorni, `howto` 180, `gotcha` 120, `snippet` 90 (valori iniziali da tarare).
- `centrality`: grado normalizzato nel grafo dei `memory.link`.
- L'attivazione si calcola **al momento della query** con l'orologio locale. La vista replicata contiene solo gli input, quindi resta deterministica.

### 8.3 Contatori d'uso

Ogni `recall` che restituisce un ricordo incrementa un contatore locale. Ogni N ore il nodo pubblica un solo `usage.report` aggregato, per non riempire il log con un evento per ogni lettura.

---

## 9. Membership e identità

- **Identità:** ogni nodo (dispositivo) ha una coppia di chiavi. Un utente con due PC ha due nodi.
- **Creazione del team:** il nodo fondatore crea l'Autobase, la chiave di cifratura e il segreto del topic, e diventa `admin`.
- **Invito:** **qualunque membro** può eseguire `micelio invite`, che genera un codice monouso con scadenza (default 24 h, blind-pairing). Il nuovo nodo lo usa con `micelio join <codice>`. Il nodo che ha creato l'invito completa il pairing, pubblica `member.add` con `invited_by` e consegna chiave e segreto sul canale cifrato. Non serve che un admin sia online.
- **Ruoli:** `admin` (rimuove membri, gestisce la config di team e le redazioni, promuove altri admin) e `member` (invita, scrive ricordi, vota, sogna).
- **Tracciabilità:** `micelio members` mostra l'albero degli inviti (chi ha portato dentro chi), così un admin può risalire all'origine di un ingresso sospetto.
- **Offboarding:** solo un admin può pubblicare `member.remove`. `apply` ignora le rimozioni pubblicate da chi non è admin. Dopo la rimozione i nuovi eventi del nodo rimosso vengono ignorati. **Limite intrinseco:** ciò che il nodo ha già replicato resta in suo possesso. Per proteggere il sapere futuro serve la rotazione della chiave di team (Fase 6).

---

## 10. Dreaming

### 10.1 Coordinamento fra nodi

Se ogni nodo sognasse per conto suo i risultati divergerebbero. Per questo il dreaming **non modifica mai la vista direttamente**: produce eventi che si replicano come tutti gli altri.

- **Epoca:** finestra temporale fissa (default 24 h, `epoch = floor(unix_time / 86400)`).
- **Elezione deterministica:** ogni nodo con CLI disponibile calcola `rank = hash(epoch ‖ node_key)` per tutti i membri. Il nodo di rango più basso tra quelli che hanno dato segni di vita di recente (eventi o connessioni) pubblica `dream.claim`. Se entro un periodo di tolleranza il primo non ha rivendicato l'epoca, tocca al successivo.
- **Rivendicazioni concorrenti:** se due nodi rivendicano la stessa epoca, vince quello con il rank più basso secondo l'ordine causale. L'altro, appena lo vede, interrompe il lavoro.
- **Idempotenza come rete di sicurezza:** se due nodi sognano comunque in parallelo, i loro eventi sono content-addressed. Inoltre `apply` ignora un `supersede` che fa riferimento a ricordi già sostituiti: vince il primo nell'ordine causale.
- **Quando:** preferibilmente quando la macchina è inattiva (configurabile, es. 13:00–14:00 o di notte).
- **Budget:** massimo N chiamate CLI per epoca (default 30), così un sogno non consuma tutto l'abbonamento di un collega.

### 10.2 Fasi di un sogno

1. **Raccolta:** ricordi nuovi dall'ultima epoca, più un campione di ricordi vecchi a bassa attivazione.
2. **Clustering:** raggruppamento per similarità vettoriale.
3. **Consolidamento:** nei cluster con sovrapposizioni l'LLM produce un ricordo fuso → `memory.supersede` (le fonti restano come storico).
4. **Contraddizioni e obsolescenza:** l'LLM confronta i ricordi in conflitto (es. "si usa la lib X" contro "abbiamo abbandonato X"). Il più recente e più supportato sostituisce l'altro. Se l'LLM non è sicuro crea un `memory.link` di tipo `contradicts`, da rivedere manualmente.
5. **Collegamenti:** `memory.link` tra ricordi correlati, per arricchire il grafo e la centralità.
6. **Decadimento:** i ricordi con attivazione sotto soglia, età minima superata e non pinnati diventano `memory.archive`. I casi limite passano da un controllo LLM ("è ancora valido?").
7. **Diario:** `dream.complete` con un riassunto leggibile di cosa è cambiato, visibile al team.

Fase futura: **astrazione**, cioè ricavare principi generali da più ricordi specifici.

### 10.3 Guardrail

- Il dreaming **non cancella mai**: archivia o sostituisce, e tutto è reversibile (`memory.restore`).
- I ricordi pinnati non decadono.
- L'unica cancellazione reale è la **redazione** (`memory.redact`), riservata agli admin per contenuti finiti in rete per errore. Ogni nodo che la riceve elimina localmente i blocchi interessati. È un'operazione **best-effort**: un nodo malevolo potrebbe conservare il contenuto. Proprio per questo la difesa principale sta nel filtro in ingresso.

---

## 11. Server MCP

Il daemon espone MCP su **HTTP locale** (`127.0.0.1`, con token) e una piccola **shim stdio** per i client che la preferiscono. La shim inoltra le chiamate al daemon.

| Tool | Descrizione |
|---|---|
| `recall(query, k?, tags?, include_archived?)` | Ricerca ibrida ordinata per rilevanza e attivazione |
| `remember(text, kind?, tags?, scope?)` | Propone un ricordo, che passa comunque da filtro e classificazione |
| `get(id)` | Ricordo completo, con collegamenti e storico delle sostituzioni |
| `vote(id, delta)` / `pin(id)` | Segnali espliciti |
| `promote(id)` | Sposta un ricordo da `private` a `team` |
| `inbox_review()` / `inbox_decide(id, decision)` | Revisione degli elementi incerti |
| `forget(id)` | Archivia (team) o elimina (private) |

Ogni IDE o CLI si configura una volta con `micelio setup <client>`, che scrive la configurazione MCP del client e, dove possibile, un file di regole che istruisce l'agente a usare `recall` all'inizio dei task e `remember` quando scopre qualcosa di non ovvio.

---

## 12. Export Markdown

`~/.micelio/export/team/<kind>/<slug>.md`, con frontmatter (id, tag, attivazione, fonte), rigenerato a ogni cambiamento della vista. È **in sola lettura**: le modifiche manuali vengono sovrascritte. Si può aprire con Obsidian o qualsiasi editor e serve anche come strumento di debug.

---

## 13. Configurazione e file locali

```
~/.micelio/
├─ config.json        # nome nodo, adapter LLM, cartelle sorvegliate, regole filtro, porta MCP
├─ keys/              # identità del nodo (protetta)
├─ corestore/         # feed Hypercore / Autobase
├─ view.db            # vista team + indici (derivati, ricostruibili)
├─ private.db         # ambito privato + inbox (mai replicato)
├─ export/            # Markdown in sola lettura
└─ logs/
```

```jsonc
{
  "node": { "name": "salvo-laptop" },
  "llm": { "adapter": "claude" },                 // oppure "codex"
  "watch": [
    { "path": "D:/Docs/Architetture", "include": ["**/*.{pdf,docx,md}"], "exclude": ["**/HR/**"] }
  ],
  "filter": { "extraKeywords": [], "extraBlockedPaths": [] },
  "mcp": { "port": 7337 },
  "dream": { "window": "13:00-14:00", "maxCalls": 30 }
}
```

---

## 14. Stack tecnologico

| Ambito | Scelta |
|---|---|
| Runtime | Node.js ≥ 22 LTS, TypeScript, ESM |
| P2P | `hypercore`, `autobase`, `corestore`, `hyperswarm`, `blind-pairing` |
| Storage | `better-sqlite3` + FTS5 + `sqlite-vec` |
| Embedding | `@huggingface/transformers` (locale) |
| Validazione | `zod` |
| MCP | `@modelcontextprotocol/sdk` |
| Watcher | `chokidar` |
| Parsing documenti | `unpdf`, `mammoth`, `xlsx` (SheetJS), `officeparser` |
| CLI | `commander` |
| Test | `vitest`; test di integrazione multi-nodo in-process (più corestore su una testnet DHT locale) |

### Struttura del repo (iniziale)

Un unico package, a moduli. Si divide in un monorepo solo se serve.

```
src/
├─ core/       # schema eventi, envelope, firma, apply()
├─ net/        # swarm, autobase, pairing, membership
├─ store/      # SQLite: vista, FTS, vettori, private.db
├─ ingest/     # sorgenti, estrazione, filtro, classificazione, distillazione
├─ llm/        # adapter claude/codex, coda
├─ recall/     # ricerca ibrida, attivazione
├─ dream/      # elezione, fasi del sogno
├─ mcp/        # server MCP + shim stdio
├─ export/     # Markdown
├─ daemon.ts
└─ cli.ts
```

---

## 15. Roadmap

| Fase | Obiettivo | Criterio di completamento |
|---|---|---|
| **0 — Spike** | Ridurre i rischi tecnici | (a) 3 nodi Autobase in container Docker si sincronizzano via Hyperswarm, anche con nodi che entrano tardi o vanno offline; (b) `claude -p` headless restituisce JSON valido su Windows (`codex` da verificare quando sarà disponibile); (c) embedding con transformers.js funzionanti in Node su Windows |
| **1 — MVP** | Brain condiviso minimo | Creazione del team, invito/join, `memory.add`, vista SQLite + FTS, MCP `remember`/`recall`, export Markdown. Due nodi reali allineati |
| **2 — Ingestione AI** | Raccolta automatica con filtro | Hook Claude Code, sessioni Codex, filtro deterministico, classificazione, distillazione, ambito privato, inbox |
| **3 — Documenti** | Cartelle sorvegliate | Watcher, estrazione PDF/DOCX/XLSX, elaborazione incrementale |
| **4 — Priorità** | Ricerca intelligente | Vettori, ricerca ibrida, `usage.report`, attivazione, voti e pin |
| **5 — Dreaming** | Consolidamento | Elezione per epoca, fasi 1–7, diario dei sogni |
| **6 — Hardening** | Pronto per il team | Offboarding e rotazione chiave, redazione, `micelio setup` per tutti i client, avvio come servizio (Windows/macOS/Linux), osservabilità |

---

## 16. Rischi e punti aperti

| Rischio | Mitigazione |
|---|---|
| Le API di Autobase evolvono rapidamente | Versioni fissate, accesso solo tramite il modulo `net/`, spike in Fase 0 |
| Flag e comportamento delle CLI cambiano | Adapter isolato, validazione con zod, test di contratto sull'adapter |
| Limiti di utilizzo degli abbonamenti | Coda con budget, dreaming in finestre configurabili, priorità all'ingestione |
| Qualità della distillazione (rumore o banalità) | Set di valutazione con sessioni reali anonimizzate; preferire 0 ricordi a ricordi deboli |
| Fuga di dati sensibili nel team | Filtro deterministico prima dell'LLM, privato per default, inbox, redazione (best-effort) |
| Cancellazione in un sistema append-only | Accettata come limite; redazione + eliminazione locale dei blocchi; GDPR da valutare con chi di competenza |
| Divergenza degli embedding | Modello fissato in `team.config`, reindicizzazione locale se cambia |

**Domande ancora aperte:** nessuna al momento.
