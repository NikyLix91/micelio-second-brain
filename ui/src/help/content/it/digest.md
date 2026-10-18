# Riepilogo e lacune

La pagina **Riepilogo** mostra cosa ha imparato il team negli ultimi giorni e cosa ancora non sa.

## La settimana del team {#week}

Calcolato al momento dalla vista del team (uguale su ogni PC) e da qualche segnale locale; non si salva da nessuna parte. Contiene:
- **ricordi nuovi** nel periodo, per tipo e per autore, e gli ultimi arrivati;
- **nuove Radici** e **Radici da rivedere**;
- i **più usati** (usati nel periodo, ordinati per usi totali);
- le **lacune aperte** del team, i sogni, quante tue ricerche non hanno trovato nulla e quanti ricordi hanno il codice cambiato.

Il periodo si sceglie (7, 14 o 30 giorni). Da terminale: `micelio digest --days 7`.

## La notifica del lunedì {#notification}

L'app desktop, il lunedì dalle 9, mostra una notifica con i ricordi nuovi e le lacune aperte della settimana; cliccandola si apre questa pagina. Una volta a settimana: la settimana già notificata si ricorda su disco, così un riavvio non la ripete.

## Le tue ricerche senza risposta {#mine}

Ogni ricerca **esplicita** che non trova nulla (il tool `recall` dei tuoi agenti, la ricerca nella UI o in CLI) è un indizio: serviva un sapere che il team non ha ancora scritto. Le richieste del contesto automatico non contano. Le ricerche si raggruppano se dicono la stessa cosa (stesse parole, in qualunque ordine, senza articoli e preposizioni) e il testo passa prima dalla redazione dei segreti. Restano in `private.db`, **solo su questo PC**: le puoi segnalare al team o ignorare. Se nel frattempo è arrivato un ricordo che forse le colma, compare accanto.

## Le lacune del team {#team-gaps}

Una lacuna **segnalata** (`gap.report`) arriva a tutti. Se un collega segnala la stessa domanda si aggiunge a chi la chiede: quante più persone, tanto più conviene scriverla. Chi conosce la risposta scrive il ricordo e chiude la lacuna (`gap.close`), anche indicando il ricordo che la colma; Micelio suggerisce quello che forse lo fa. Una lacuna chiusa e segnalata di nuovo si riapre. Si può anche scrivere una domanda a mano. Da terminale: `micelio gaps`, `gaps mine`, `gaps report`, `gaps close`.
