# Sogni (dreaming)

Una volta al giorno un PC del team "sogna" per tutti: riordina il sapere fondendo i doppioni, archiviando ciò che è superato o non serve più e collegando i ricordi correlati. Come il sonno per la memoria umana.

## Chi sogna e quando {#turns}

- Ogni giorno è un'**epoca**. L'ordine dei turni fra i membri attivi è deterministico (hash dell'epoca e delle chiavi): ogni PC lo calcola uguale, senza coordinarsi.
- Il primo della lista può sognare dall'**ora configurata** (default le 13); ogni turno successivo dopo altri 30 minuti, se nessuno ha ancora sognato.
- Chi parte scrive un evento `dream.claim`: vince il primo nell'ordine del log; gli altri vedono la rivendicazione e non sognano.
- Ogni PC controlla il proprio turno ogni 10 minuti. «Sogna ora» avvia un sogno manuale con un'epoca dedicata.

## Cosa succede in un sogno {#phases}

1. **Quasi-doppioni**: si raggruppano i ricordi molto simili (somiglianza dei vettori ≥ 0,92 con il modello e5).
2. **Consolidamento**: per ogni gruppo Claude decide se **fondere** (un ricordo nuovo sostituisce i vecchi: evento `memory.supersede`), segnare un ricordo come **superato**, oppure solo **collegarli** (`memory.link`).
3. **Decadimento**: i ricordi con attivazione sotto 0,15 e più vecchi di 90 giorni vengono **archiviati** (al massimo 20 per sogno).
4. **Diario**: un riassunto (`dream.complete`) visibile a tutti nella schermata Sogni.

Ricordi fissati e Radici non vengono mai fusi né archiviati.

## Il costo {#budget}

Al massimo 30 chiamate a Claude per sogno, entro il budget giornaliero del PC che sogna.

## Archivio e ripristino {#archive}

Niente è perso: i ricordi sostituiti o archiviati escono dalla ricerca ma restano nel log. Nell'**Archivio** si vedono con il motivo e si possono **ripristinare** (evento `memory.restore`). Solo i ricordi **redatti** (tolti da un admin per errore di contenuto) non si ripristinano.
