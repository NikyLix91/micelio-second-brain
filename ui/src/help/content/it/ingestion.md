# Raccolta e distillazione

Come il lavoro di tutti i giorni diventa sapere del team, passo per passo, e dove finisce ogni pezzo.

## Da dove arriva il materiale {#sources}

- **Sessioni di Claude Code** nelle cartelle che hai abilitato (Impostazioni → Raccolta automatica). Le trascrizioni sono i file `.jsonl` che Claude Code scrive in `~/.claude/projects/`.
- **Cartelle di documenti**: PDF, Word, Excel, PowerPoint, OpenDocument, Markdown, testo, diagrammi (draw.io, SVG, PlantUML, Mermaid).
- **Salvataggi espliciti**: «Nuovo ricordo» nell'app, `micelio remember`, oppure l'agente con il tool MCP `remember`.

## Le sessioni {#sessions}

- **A fine sessione**, l'hook `SessionEnd` installato in Claude Code avvisa il daemon (se è spento, l'hook lo accende).
- **Durante le sessioni lunghe**, ogni 15 minuti il daemon guarda le trascrizioni: una sessione **ferma da almeno 10 minuti** con abbastanza materiale nuovo (4 tuoi messaggi o 6.000 caratteri) viene elaborata a **capitoli**. Una sessione ferma da oltre 6 ore viene presa comunque.
- **Niente doppioni**: per ogni sessione `private.db` ricorda quante righe sono già state lette; si elabora solo la parte nuova.
- **Recupero**: le sessioni finite mentre il daemon era spento vengono raccolte al primo avvio.

Dalla trascrizione si ricava un testo compatto (domande, risposte, strumenti usati in breve); il ragionamento interno del modello e i sotto-agenti sono esclusi; il contenuto dei **file sensibili** letti o scritti (`.env`, chiavi…) viene tolto per intero.

## Le modifiche al codice {#code-changes}

Se la sessione è in un repository git, si aggiunge un **riassunto delle modifiche** del capitolo: commit fatti in quell'intervallo e lavoro non ancora committato, con i file toccati e le classi, funzioni ed endpoint aggiunti o rimossi. Il codice non viene copiato: solo nomi e messaggi di commit. Dei file sensibili compare solo il nome.

## I passaggi {#steps}

1. **Filtro locale** (vedi Filtro privacy): blocca gli argomenti HR/personali e toglie segreti e dati personali.
2. **Classificazione** (modello veloce, default Haiku): sapere per il team, privato o da scartare, con una confidenza.
3. **Instradamento**: team se pulito e sicuro (confidenza ≥ 0,8); inbox se dubbio o misto; privato o scartato se chiaro.
4. **Distillazione** (modello più capace, default Sonnet): da 0 al **limite** del team (default 5) ricordi atomici, dal più importante, con riferimenti a file e commit. Zero ricordi è un esito normale.
5. **Secondo filtro** sui ricordi prodotti (il modello potrebbe aver riportato qualcosa di sensibile).
6. **Pubblicazione** oppure inbox.

Le chiamate a Claude passano dalla **CLI** installata sul PC (`claude -p`), con il tuo abbonamento: nessuna API key, nessuno strumento abilitato per il modello, nessuna sessione salvata. Le chiamate di Micelio non vengono a loro volta raccolte.

## Dove finisce un ricordo {#storage}

Pubblicare significa aggiungere al **tuo feed** l'evento `memory.add` con titolo, corpo, tipo, tag e fonte (incluse posizione nel distillato e riferimenti al codice). L'**id** del ricordo è l'hash SHA-256 di tipo + titolo + corpo normalizzati: due PC che distillano lo stesso sapere producono lo stesso id, e il doppione non si crea. Poi: replica ai colleghi → vista → indice di ricerca (`view.db`) ed export Markdown, su ogni PC.

## La coda dei lavori {#queue}

Ogni sessione o documento è un **lavoro** nella coda di `private.db`, eseguito ogni 3 secondi. Budget LLM esaurito → il lavoro riparte domani senza perdere tentativi; CLI non disponibile → nuovo tentativo dopo 10 minuti; errore → dopo 5 minuti.

## I riferimenti al codice {#code-refs}

Ogni ricordo da una sessione porta il **progetto** (cartella del repository), il remote **senza credenziali**, il branch, i **file** (relativi al repository), i **simboli** e i **commit**. I commit indicati dal modello vengono verificati su git: un hash inventato viene scartato.
