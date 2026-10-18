# Memoria e ricerca

La schermata **Memoria** cerca nel sapere del team e mostra il dettaglio dei ricordi. La stessa ricerca la usano gli agenti AI (tool `recall`).

## Come funziona la ricerca {#search}

È una ricerca **ibrida**, calcolata sul tuo PC:

1. **Parole chiave**: indice FTS5 di SQLite con punteggio BM25; una parola nel titolo vale 3 volte una nel corpo, nei tag 2 volte. Accenti ignorati, prefissi accettati.
2. **Significato**: la domanda e i ricordi sono trasformati in **vettori** da un modello di embedding locale e multilingue (`multilingual-e5-small`): una domanda in inglese trova ricordi in italiano.
3. **Fusione**: le due classifiche si uniscono con la *Reciprocal Rank Fusion* (k = 60).
4. **Priorità**: a parità di pertinenza vincono i ricordi più "vivi" (attivazione: usati, votati, collegati, fissati).

Ogni risultato restituito conta come un **uso** del ricordo.

## Gli embedding {#embeddings}

Il modello (circa 130 MB) viene scaricato la prima volta e gira in un thread separato del daemon, senza inviare nulla fuori. I vettori stanno in `view.db` e si ricalcolano se cambia il modello. Senza modello la ricerca funziona solo per parole chiave.

## Proporre un ricordo {#propose}

«Nuovo ricordo» passa dallo **stesso percorso** di CLI e agenti: filtro privacy e classificazione. L'esito può essere: pubblicato nel team, in inbox per una tua verifica, oppure trattenuto come privato (con il motivo). Il ricordo deve essere autosufficiente: comprensibile senza la conversazione da cui nasce.

## Il dettaglio di un ricordo {#detail}

Il pannello mostra tipo, tag, testo, autore e data, e poi:
- **Attivazione, usi e voti**, con 👍 / 👎 e 📌 (vedi Priorità);
- il riquadro **Radice** (per renderlo sapere fondante o rivederlo);
- **Dal codice**: progetto, branch, file, simboli e commit (i commit sono link se il repository è su un server web);
- **Da documento**: il nome del file originale e «Scarica l'originale» dal collega che lo possiede.

## Aggiornare invece di aggiungere {#update-on-write}

Quando un ricordo nuovo sta per entrare nel team, Micelio cerca i ricordi più **simili per significato**. Se non ce ne sono, si aggiunge e basta. Se ce ne sono, Claude (il modello veloce) decide: **nuovo** (dice altro) → si aggiunge; **doppione** → non si scrive nulla; **aggiornamento** (corregge o completa un ricordo esistente) → si scrive UNA versione aggiornata che sostituisce la vecchia (`memory.supersede`), che resta nello storico e si può ripristinare dall'Archivio. Le Radici e i ricordi fissati non vengono mai sostituiti. Senza LLM o a budget finito il ricordo si aggiunge come prima. L'admin lo spegne nella pagina Team («Aggiorna invece di aggiungere»).

## Codice cambiato {#stale}

Se un ricordo cita dei file (dal codice di una sessione) e dopo la sua scrittura quei file sono cambiati o spariti, potrebbe descrivere un codice che non c'è più. Micelio lo controlla sui repository di **questo PC** (all'avvio, ogni 6 ore, o con «Ricontrolla i repository» nel filtro «⚠ Codice cambiato»): legge la storia git dei soli file citati e conta i commit successivi al ricordo. Effetti: l'attivazione scende (−5% per commit, −20% per file sparito, fino a metà), e il ricordo mostra l'avviso, anche agli agenti, perché verifichino sul codice attuale. Il segnale resta locale. Le Radici hanno invece la loro revisione. Da terminale: `micelio stale --check`.
