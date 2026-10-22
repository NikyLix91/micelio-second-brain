# Efficacia

La pagina **Efficacia** mostra quando gli agenti (Claude Code) interrogano Micelio e se ricevono dati utili. Serve a capire quanto Micelio aiuta davvero, e migliora Micelio stesso: i ricordi utili salgono, quelli che fanno solo rumore si vedono.

## Consultazioni {#consultations}

Ogni richiesta di un agente a Micelio, appena arriva:
- **ricerca** (`recall`), **Radici** (`architecture`), **lettura** di un ricordo (`get`), **documento** originale (`fetch_source`);
- **contesto automatico**: a inizio sessione e a ogni tua richiesta, se gli hook sono attivi (Impostazioni → Contesto automatico).

Per ognuna: ora, progetto, domanda, ricordi restituiti e **tempo di risposta** del daemon. Con il contesto automatico ogni messaggio che scrivi a Claude Code aspetta Micelio: oltre 1 secondo la risposta è segnata come lenta. In cima alla pagina ci sono la mediana e il 95° percentile.

## Esiti {#outcomes}

Che un ricordo sia stato **restituito** non vuol dire che sia **servito**. Per saperlo Micelio guarda cosa ha fatto l'agente **dopo** averlo ricevuto. Lo fa quando raccoglie la sessione, cioè dopo qualche minuto di inattività, per questo gli esiti arrivano dopo le consultazioni. Due giudizi:
- **euristica**, per tutte le sessioni e senza costi: nei messaggi e nei comandi successivi dell'agente compare un elemento distintivo del ricordo, come un comando fra backtick, un percorso di file, un nome di classe o di funzione, un URL o un file dei riferimenti al codice. Esito **≈ probabilmente utile**, con l'elemento ritrovato come prova; altrimenti «nessuna traccia d'uso». Le parole comuni non contano;
- **LLM**, per le sessioni che si distillano: nella stessa chiamata della distillazione l'LLM giudica ogni ricordo fornito come **✓ utile** (usato davvero), **· non usato** o **✗ sbagliato** (superato o contraddetto da ciò che è emerso), con il motivo. Il giudizio dell'LLM prevale sull'euristica.

**Pollice in su automatico 👍:** un ricordo confermato «utile» dall'LLM riceve il voto +1 di questo PC, come se l'avessi votato tu. Mai sopra un voto che hai già dato a mano, in su o in giù. Il voto alza la priorità del ricordo per tutto il team.

## I più utili {#top}

I ricordi con più esiti utili nel periodo. Per ognuno: quante volte è stato utile qui e quante **nel team**. Ogni PC pubblica il proprio conteggio, e la somma compare anche nel dettaglio del ricordo («utile N volte agli agenti del team»).

## Rumore {#noise}

Ricordi restituiti spesso, almeno 5 volte, ma mai utili. Probabilmente il titolo li fa sembrare pertinenti a domande che non c'entrano, oppure ripetono cose ovvie. Si possono riscrivere, accorpare o archiviare. Intanto Micelio li propone meno: vedi **Abituazione**.

## Abituazione {#habituation}

Un ricordo fornito agli agenti più volte di fila senza mai servire viene proposto **meno**, come succede nel cervello con uno stimolo che si ripete senza conseguenze. Serve a togliere rumore dal contesto: ogni ricordo inutile distrae l'agente e consuma token.

| Volte di fila senza servire | Peso |
|---|---|
| fino a 2 | 100% |
| 3 | 85% |
| 5 | 55% |
| 7 o più | 30% (minimo) |

- **Contesto automatico** (inizio sessione e ogni richiesta): peso pieno. Un ricordo che è stato solo rumore può uscire del tutto dal contesto di una richiesta.
- **Ricerche esplicite** (`recall`, ricerca nell'app, chat): metà dell'effetto, al minimo il 65%, perché lì la domanda è precisa.
- **Basta un esito utile** («usato» o «probabilmente utile») per tornare al 100%. Un esito «sbagliato» conta come non servito.
- **I ricordi fissati non si toccano.** L'attivazione non cambia: costellazione, dreaming e archiviazione restano uguali.

Il dettaglio del ricordo dice quante volte di fila non è servito e quanto pesa ora; la lista **Rumore** mostra il peso attuale.

**Come funziona dietro.** La serie si legge dagli esiti di **questo PC** (tabella `outcomes` di `private.db`, ultimi 90 giorni), in ordine di tempo: ogni esito senza uso aggiunge uno, un esito utile azzera. Non si usano i contatori del team (`usage.report`, `useful.report`): sono cumulativi, senza ordine nel tempo, e contano anche consegne che nessuno ha valutato. Il calcolo si rifà solo quando arrivano esiti nuovi; nella ricerca il fattore moltiplica il punteggio finale, nel contesto per richiesta moltiplica la somiglianza prima della soglia di pertinenza (la soglia resta calcolata sui punteggi originali). Codice: `src/rank/habituation.ts`.

## Sbagliati o superati {#wrong}

Ricordi che l'LLM ha trovato contraddetti da ciò che è emerso in una sessione: per esempio una porta cambiata o una procedura non più valida. Micelio non fa nulla da solo: apri il ricordo e decidi. Puoi correggerlo scrivendone uno nuovo, votarlo giù o archiviarlo; se è una Radice, «segnala da rivedere».

## Domande senza risposta {#unanswered}

Ricerche degli agenti che non hanno trovato nulla. Sono lacune di conoscenza: le trovi anche in **Riepilogo**, dove si segnalano al team.

## Notifiche {#notifications}

Con l'app desktop arriva una notifica quando un ricordo è stato **utile** (confermato) o era **sbagliato**, al massimo tre per volta. Le consultazioni non notificano: con il contesto automatico sono decine all'ora. Si spengono in **Impostazioni → Contesto automatico**.

## Come funziona dietro {#internals}

- **Registro:** consultazioni ed esiti stanno in `private.db` (tabelle `consultations` e `outcomes`), **solo su questo PC**, e si conservano 90 giorni. La domanda passa dalla redazione dei segreti prima di essere salvata.
- **Cosa ha fornito Micelio:** Micelio rilegge la parte nuova della trascrizione della sessione (`~/.claude/projects/…/<sessione>.jsonl`). I risultati dei suoi tool MCP e il contesto inserito dagli hook (righe `hook_additional_context`) riportano `id:` di ogni ricordo: così si sa esattamente cosa ha ricevuto l'agente e da quale riga in poi guardare le sue azioni.
- **Giudizio dell'LLM:** l'elenco dei ricordi forniti va in coda al testo della distillazione con una regola in più nel prompt. Nessuna chiamata in più, solo pochi token. Le sessioni scartate o private non si distillano, quindi restano con il solo esito euristico.
- **Al team** arrivano due cose: il pollice in su (un normale `memory.vote`) e il conteggio delle volte in cui un ricordo è stato utile. Il conteggio viaggia con l'evento `useful.report`, contatori cumulativi per ricordo e per PC come quelli d'uso; i nodi di versioni precedenti lo ignorano.
- **Priorità:** nell'attivazione un uso utile vale 3 usi semplici. Prima un ricordo contava come «usato» appena veniva restituito.
