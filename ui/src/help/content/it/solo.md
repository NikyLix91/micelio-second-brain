# Da soli: solo locale e ricordi personali

Micelio funziona anche per una persona sola: un team di un solo membro è un team normale. In più ci sono due cose pensate per l'uso individuale.

## Modalità solo locale {#local}

Un team in modalità **solo locale** non usa nessuna rete: il nodo non entra nella DHT, non cerca colleghi e non risponde a richieste d'ingresso. Tutto il resto (raccolta, distillazione, ricerca, Radici, dreaming, agenti) funziona come sempre. Si sceglie creando il team («Solo per me, senza rete», o `micelio init <nome> --solo`) oppure più tardi in Impostazioni → Rete («Solo locale», o `micelio network local`).

Per invitare qualcuno si sceglie prima una rete (pubblica o privata): il nodo si ricollega e nulla va perso. In modalità solo locale gli inviti vengono rifiutati con questa spiegazione, e l'app desktop non avvisa di «nodo isolato».

Attenzione: da soli i dati esistono solo su questo PC. Attiva i **backup automatici** (Impostazioni → Backup automatici, vedi «Backup e ripristino»), oppure invita un tuo secondo PC: è anche una copia di riserva.

## Ricordi personali {#personal}

Un ricordo **personale** resta su questo PC (`private.db`, tabella `personal`): non entra nel log, non si replica, il team non lo vede. Compare però nelle tue ricerche e in quelle dei tuoi agenti, marcato 🔒, accanto ai ricordi del team. Si crea:
- da **Memoria → Nuovo ricordo → Solo per me**;
- dall'agente, chiedendogli di ricordare qualcosa «per te» (tool `remember` con `personal: true`);
- da terminale: `micelio remember "<titolo>" -b "<testo>" --personal`.

Il testo passa dalla redazione dei segreti (gli agenti lo leggono); il blocco dei contenuti personali o HR non si applica, perché non lascia il PC. Voti, pin e Radici non valgono per i ricordi personali, e restano fuori da costellazione, dreaming, export e metriche.

## Condividere o cancellare {#share}

Dal dettaglio di un ricordo personale: **Condividi con il team** lo manda per la stessa strada di un salvataggio esplicito (filtro e classificazione), quindi può finire nell'inbox; **Cancella** lo elimina senza tracce, perché non è mai stato nel log. Da terminale: `micelio personal`, `personal share <id>`, `personal delete <id>`.

## Dall'inbox {#inbox-keep}

Un ricordo in inbox che non vuoi dare al team ma ti è utile: **Tienilo per me** lo trasforma in ricordo personale (nel Registro privato risulta come scelta privata). Da terminale: `micelio inbox keep <id>`.
