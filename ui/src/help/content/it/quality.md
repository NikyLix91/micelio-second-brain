# Qualità della distillazione

Quanti ricordi deve estrarre Claude da una sessione? Pochi e buoni, o di più? La scheda **Qualità della distillazione** (pagina Team) dà i dati per decidere il limite (`distill.maxMemories`, default 5).

## Perché un limite {#why}

Con la CLI dell'abbonamento il costo non è il problema: il problema è il **rumore**. Una memoria piena di ricordi marginali è più difficile da usare per le persone e per gli agenti, che la interrogano a ogni task. Il distillatore elenca i ricordi dal più importante; il limite taglia la coda.

## Come si misura {#metrics}

Ogni ricordo distillato porta la sua **posizione** nel distillato (1ª, 2ª…) e quanti ricordi aveva proposto il modello. Per ogni fascia di posizione, sui ricordi con **più di 3 giorni** (prima non hanno avuto il tempo di essere usati):

| Misura | Significato |
|---|---|
| Utili | votati positivamente o usati dagli agenti |
| Votati inutili | somma dei voti negativa |
| Fusi o archiviati | tolti dal dreaming: doppioni o sapere che non serviva |
| Mai usati | nessun uso e nessun voto |
| Punteggio | utili − votati inutili − fusi o archiviati (da −1 a +1) |

Più la **saturazione**: in quante distillazioni il modello ha proposto almeno tanti ricordi quanto il limite. Se succede spesso, il limite sta tagliando.

## L'indicazione {#advice}

Si confrontano le **prime posizioni** (1–3) con le **ultime consentite** (le ultime due sotto il limite):
- **alzare**: le ultime valgono quasi quanto le prime (scarto di punteggio ≤ 0,15) e il limite viene raggiunto in almeno il 30% delle distillazioni;
- **abbassare**: le ultime valgono molto meno (scarto ≥ 0,35) o almeno metà è inutile o fusa;
- **tenere**: negli altri casi;
- **dati insufficienti**: meno di 30 ricordi maturi, o meno di 10 nelle ultime posizioni.

Le metriche sono calcolate sul log del team, quindi sono le stesse su ogni PC. Da terminale: `micelio quality`.
