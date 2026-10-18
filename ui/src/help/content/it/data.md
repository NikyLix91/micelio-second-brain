# Dove sono i dati

Tutti i dati di Micelio stanno nella cartella del nodo: `~/.micelio` (su Windows `C:\Users\<tu>\.micelio`), oppure quella indicata con `--home` o `MICELIO_HOME`. Nient'altro viene scritto altrove, salvo i log dei test.

## La cartella del nodo {#home}

| File / cartella | Contenuto | Formato | Replicato? |
|---|---|---|---|
| `config.json` | Porta, token dell'API locale, LLM, cartelle abilitate, rete | JSON | No |
| `state.json` | Nome del nodo e **chiavi del team**, compresa quella di cifratura | JSON | No: **proteggilo come una password** |
| `corestore/` | Il **log del team**: i feed di tutti i membri | Hypercore (file binari + RocksDB) | **Sì**, è ciò che si sincronizza |
| `view.db` | Indice di ricerca, vettori, segnali di priorità | SQLite | No: si ricostruisce dal log |
| `private.db` | Inbox, registro privato, coda dei lavori, budget, registro di sicurezza | SQLite | **Mai** |
| `export/` | Copia leggibile del sapere | Markdown con frontmatter | No |
| `sources/` | Documenti originali scaricati dai colleghi | File originali | No (cache di 30 giorni) |
| `logs/` | Log del daemon e dell'hook di Claude Code | Testo | No |

## Il log del team {#log}

Ogni membro scrive solo nel **proprio feed** (un *Hypercore*: un registro append-only, firmato con la chiave del membro). Ogni azione è un **evento** JSON: `memory.add` (nuovo ricordo), `memory.vote`, `root.set`, `member.add`, `team.config`… Nessun evento si modifica o si cancella: anche una correzione è un evento nuovo.

**Autobase** unisce i feed di tutti in un ordine unico e causale (lo stesso su ogni PC). I blocchi sono **cifrati** con la chiave del team: chi copiasse `corestore/` senza `state.json` non leggerebbe nulla.

## La vista {#view}

Dagli eventi, in quell'ordine, una funzione **deterministica** (`apply`) calcola lo **stato** del team: membri, ricordi, voti, Radici, configurazione. Lo stato è salvato in un *Hyperbee* (un database chiave-valore dentro il corestore). È anche il punto dove si controllano i **permessi**: un evento non permesso (es. un'espulsione fatta da chi non è admin) viene semplicemente ignorato da tutti.

## L'indice di ricerca {#index}

`view.db` è un database **SQLite** derivato dalla vista: ricordi attivi, ricerca testuale **FTS5** (BM25), i **vettori** semantici calcolati in locale e i segnali di priorità (usi, voti, pin). Si può cancellare in qualunque momento: al riavvio il daemon lo ricostruisce dal log.

## L'archivio privato {#private}

`private.db` contiene ciò che riguarda **solo te** e non viene mai replicato: l'inbox, il registro delle decisioni (cosa non è andato al team e perché), la coda dei lavori di raccolta, il consumo dell'LLM, l'avanzamento delle sessioni già lette, i documenti delle cartelle sorvegliate, il registro di sicurezza e i suggerimenti di Radici. Non è ricostruibile: non cancellarlo.

## L'export Markdown {#export}

`export/team/<tipo>/<titolo>-<id>.md`: un file per ricordo, con frontmatter YAML (id, tipo, tag, autore, data, progetto) e i riferimenti al codice. È in sola lettura e si aggiorna da solo: comodo per Obsidian o per un grep.

## Cosa salvare per un backup {#backup}

Il minimo indispensabile è **`state.json`** (le chiavi del team) e `config.json`. Il log (`corestore/`) si riscarica dai colleghi; `view.db` ed `export/` si ricostruiscono. `private.db` contiene la tua inbox e il registro: salvalo se ti interessano.
