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
- **Radici**: al centro della sfera, con un anello bianco (rosso se da rivedere); «◆ Radici» le isola.

## La Mappa 2D {#map}

La stessa costellazione in piano, per analisi mirate: colori per autore o per tipo, legenda cliccabile, ricerca che accende, etichette che compaiono avvicinandosi. Le Radici sono rombi.

## Prestazioni {#performance}

Il Nucleo usa WebGL (three.js) ed è caricato solo quando serve. Su un PC con grafica debole, `#/?bloom=0` nell'indirizzo toglie il bagliore.
