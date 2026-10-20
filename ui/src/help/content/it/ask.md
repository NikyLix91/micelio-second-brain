# Chiedi

La pagina **Chiedi** è una chat con la memoria del team. Fai una domanda come la faresti a un collega esperto e ricevi una risposta scritta solo su quello che il team sa, con le fonti, più una **mappa del sapere** sull'argomento.

## Fare una domanda {#ask}

Scrivi la domanda e premi Invio. Partono due cose insieme:
- **la mappa**, che compare subito: i ricordi pertinenti raggruppati in temi;
- **la risposta**, che arriva dopo qualche secondo. È scritta dall'LLM usando **solo** i ricordi trovati, mai conoscenze generali, e ogni affermazione porta il numero del ricordo da cui viene, es. [2]. Un clic sul numero illumina il ricordo nella mappa.

Le domande successive tengono conto della conversazione (le ultime tre domande e risposte), quindi puoi chiedere «e per i timeout?» senza ripetere l'argomento.

Se la memoria del team non basta, la risposta lo dice. Con **Segnala al team come lacuna** la domanda arriva ai colleghi, nel Riepilogo.

## La mappa del sapere {#map}

A sinistra la domanda, poi i **temi**, poi i **ricordi**, ognuno con titolo e prima riga. I ricordi trovati dalla ricerca hanno il bordo più chiaro, quelli citati nella risposta sono evidenziati e le Radici hanno il simbolo ◆.

Le linee tratteggiate a destra delle schede sono i collegamenti fra ricordi: stesso argomento, significato simile, oppure decisi dal **dreaming**. Quelli del dreaming sono pieni e il tipo appare passandoci sopra: approfondisce, dipende da, contraddice. Una contraddizione è rossa.

- **Clic su un ricordo:** lo apre nel dettaglio.
- **+ su un ricordo:** aggiunge accanto i ricordi collegati.
- **Trascina** per spostarti, **rotella** per lo zoom.

## Salvare una risposta {#save}

Una buona risposta mette insieme il sapere di più ricordi. **Salva come ricordo** la trasforma in un ricordo del team: il titolo è la domanda, il testo è la risposta con l'elenco delle fonti. Passa dalla stessa strada di un ricordo scritto a mano: filtro privacy e, nei casi dubbi, Inbox.

## Conversazioni {#history}

Le conversazioni restano **solo su questo PC**: le ritrovi nella colonna a sinistra, puoi rinominarle e cancellarle. Il team non le vede.

## Come funziona dietro {#internals}

1. **Ricerca, senza LLM:** la stessa ricerca ibrida del resto dell'app (parole chiave e significato) trova fino a 12 ricordi, più le Radici pertinenti. Poi si aggiungono i loro **vicini nella costellazione**, prima quelli collegati dal dreaming, fino a 30 ricordi.
2. **Mappa, senza LLM:** i ricordi si raggruppano in temi con lo stesso metodo delle galassie (comunità sui loro collegamenti). Ogni tema prende il nome dai tag caratteristici, finché l'LLM non gliene dà uno più leggibile.
3. **Risposta:** una sola chiamata all'LLM, con i ricordi numerati come unico materiale e la regola di non andare oltre. Modello e budget giornaliero sono quelli di **Impostazioni → LLM**. Le chiamate all'LLM vanno in fila: se Micelio sta distillando una sessione, la risposta arriva appena ha finito. Senza ricordi pertinenti l'LLM non viene chiamato.
4. **Dove stanno i dati:** le conversazioni sono in `private.db` (tabelle `chats` e `chat_messages`), solo su questo PC. Le domande compaiono anche fra le consultazioni della pagina **Efficacia** (canale «chat»).
5. **Prestazioni:** con 5 000 ricordi la mappa di una domanda si calcola in circa un decimo di secondo.
