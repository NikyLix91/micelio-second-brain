# Nucleo 3D e Mappa 2D

Due modi di guardare il sapere del team come una costellazione: ogni ricordo è una stella, i collegamenti uniscono ricordi correlati.

## I collegamenti {#links}

Due ricordi sono collegati quando hanno **tag in comune** (pesati: i tag rari contano di più), quando sono **vicini di significato** (vettori simili) o quando il **dreaming** li ha collegati esplicitamente. I ricordi più collegati e più usati sono stelle più grandi.

## Il Nucleo {#nucleus}

La home: una sfera olografica navigabile.
- **Muoversi**: trascina per ruotare, rotella per lo zoom, clic su una stella per volarci e leggerla. Dopo 20 secondi di inattività la sfera ruota da sola.
- **Esplorazione guidata**: la camera vola da un argomento all'altro (i tag più diffusi), con una didascalia.
- **Accendi un argomento**: i ricordi pertinenti si accendono e la camera ci vola.
- **Colori**: olografico (intensità secondo l'attivazione), per autore o per tipo; nelle ultime due la legenda è cliccabile e isola una voce.
- **Radici**: al centro della sfera, con un anello bianco (rosso se da rivedere); «◆ Radici» le isola. Con molte Radici il nucleo si allarga, e oltre una ventina (es. un vault importato) le Radici si distribuiscono nel guscio come gli altri ricordi; più sono, più ognuna è piccola e tenue, e quelle fuori da filtro, ricerca o tappa del tour restano un puntino senza anello. Così restano distinguibili.

## La Mappa 2D {#map}

La stessa costellazione in piano, per analisi mirate: colori per autore o per tipo, legenda cliccabile, ricerca che accende, etichette che compaiono avvicinandosi. Le Radici sono rombi. Cliccando un nodo il dettaglio si apre sopra la mappa, in alto a destra.

## Le galassie {#galaxies}

Con molti ricordi (oltre 250) una stella per ricordo diventa un campo indistinto. Allora il Nucleo e la Mappa 2D partono dalla **vista d'insieme**: un ammasso (o un cerchio) per **galassia**, cioè un gruppo di ricordi dello stesso argomento, con il nome e il numero di ricordi.
- **Entrare**: clic su una galassia; «◀ Tutte le galassie» torna indietro. Dentro una galassia molto grande si disegnano al massimo 600 stelle: le Radici, quelle accese e le più vive (le altre si trovano con la ricerca).
- **Cercare e filtrare**: con pochi risultati (fino a 250) si vedono solo quelli, da tutte le galassie; con tanti si accendono le galassie che li contengono, con il numero di risultati.
- **Esplorazione guidata**: nella vista d'insieme vola da una galassia all'altra; dentro una galassia, fra i suoi argomenti.
- **Ammasso con anello ciano**: la galassia contiene Radici. «senza collegamenti» raccoglie i ricordi non legati a nessun altro.

**Come funziona dietro.** Il daemon raggruppa i ricordi con l'algoritmo di **Louvain** sui collegamenti della costellazione (tag in comune, significato, dreaming): ogni ricordo va nella comunità che rende i gruppi più "compatti", poi i gruppi si riuniscono e si ripete. La risoluzione si sceglie da sola: la più bassa che non produce galassie giganti (non oltre il 10% dei ricordi). Le comunità minuscole confluiscono nella vicina, e le galassie sono al massimo 40. Il **nome** sono i tag più caratteristici: frequenti nella galassia e rari nel resto del team. Il calcolo è deterministico (stessi ricordi, stesse galassie su ogni PC) e avviene in sottofondo dopo ogni aggiornamento (circa mezzo secondo con 5 000 ricordi); intanto le viste usano la versione precedente. I vicini per significato si salvano nell'indice locale (`view.db`) e all'avvio si rileggono invece di ricalcolarli.

## Prestazioni {#performance}

Il Nucleo usa WebGL (three.js) ed è caricato solo quando serve. Su un PC con grafica debole, `#/?bloom=0` nell'indirizzo toglie il bagliore.
