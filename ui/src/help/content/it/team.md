# Team

Un team è un gruppo di PC che condividono lo stesso sapere. Un progetto con persone diverse è un team separato.

## Membri e ruoli {#members}

- **Membro**: può scrivere nel proprio feed (ricordi, voti, Radici, inviti). Ogni membro è un *writer* di Autobase.
- **Admin**: in più può espellere, promuovere, cambiare le impostazioni condivise e redigere ricordi. Gli admin sono anche **indexer**: fissano l'ordine definitivo del log del team.

Il fondatore è il primo admin. L'albero nella pagina Team mostra chi è entrato con l'invito di chi.

## Inviti {#invites}

**Qualunque membro** può creare un invito: un codice monouso, valido 24 ore, da mandare solo alla persona interessata (è un segreto). Il collega lo usa con «Ho un invito» nell'app o con `micelio join <codice> --name <nome-pc>`. Lo accoglie qualunque membro online che ha già ricevuto l'invito: per questo, se nessun altro membro è online, chi ha creato l'invito deve restare acceso finché il collega non è entrato.

## Espulsione {#removal}

Solo un admin può espellere un membro (evento `member.remove`): da quel momento i suoi nuovi eventi vengono ignorati da tutti. Ciò che aveva già scritto resta nel log. Con la **protezione completa** (vedi sotto) l'espulso viene anche staccato dalla rete del team e la chiave cambia: non riceve né legge più niente di nuovo. Ciò che aveva già sul suo PC resta suo: nessun sistema può toglierglielo.

## Protezione completa {#protection}

Due difese insieme, contro chi è stato rimosso e contro chi riesce a mettere le mani sui dati del team:

1. **Solo i membri attivi ricevono i dati.** Su ogni connessione il peer firma con la chiave del suo feed il codice della sessione cifrata; un nodo replica i dati del team solo dopo questa prova, e solo se il peer è un membro attivo. Chi viene rimosso viene staccato subito, da tutti.
2. **Il contenuto è cifrato con una chiave per generazione.** Titolo, testo, tag e sorgente dei ricordi, le domande delle lacune, i motivi delle segnalazioni delle Radici e i riassunti dei sogni viaggiano cifrati con la chiave della generazione corrente. Ogni membro attivo riceve la chiave cifrata con la sua chiave pubblica personale; quando un admin rimuove qualcuno la chiave cambia da sola, e chi è uscito non riceve quella nuova. Anche se un membro gli passasse i dati, non li leggerebbe.

**Accensione.** È accesa nei team creati dalla 0.7.0. In un team esistente la accende un admin dalla scheda **Protezione completa** di questa pagina, quando tutti i membri hanno la 0.7.0 o successiva: la scheda mostra la versione di ciascuno. Una volta accesa **non si spegne**, e da lì un PC con una versione più vecchia non si sincronizza più finché non si aggiorna.

**Cambiare la chiave a mano.** Dopo un PC perso o rubato: rimuovi il membro di quel PC, poi **Cambia la chiave adesso**. I ricordi nuovi si cifrano con una chiave che quel PC non riceve.

**Chi entra dopo** riceve l'ultima chiave da un membro online e legge anche la storia: ogni generazione contiene la precedente cifrata con la nuova, quindi dall'ultima si risale a tutte.

**Come funziona dietro.** Le chiavi di generazione sono 32 byte casuali; il contenuto si cifra con XSalsa20-Poly1305 (`secretbox` di libsodium) e le consegne con `crypto_box_seal` verso la chiave X25519 del membro, ricavata dalla coppia che il Corestore del nodo genera sempre uguale (nessun file segreto in più). Le chiavi aperte stanno solo in memoria e si ricavano a ogni avvio. Restano in chiaro, dentro la cifratura del registro, i dati che servono a tutti i nodi per arrivare alla stessa vista: id, tipi, autori, date, voti, ruoli e nomi. Eventi: `member.boxkey` (chiave pubblica e versione), `keys.rotate` (solo admin; fra due rotazioni concorrenti vince la prima nel registro, e la perdente resta come alternativa: ogni testo cifrato porta l'impronta della sua chiave, quindi ciò che è stato scritto con la perdente resta leggibile), `keys.grant` (consegna a chi entra). Codice: `src/core/team-crypto.ts`, `src/net/team-keys.ts`, `src/net/member-gate.ts`.

## Impostazioni condivise {#shared-settings}

Le impostazioni del team sono eventi `team.config`, scritti da un admin e replicati a tutti:
- **lingua dei ricordi distillati** (italiano o inglese): i ricordi nascono in questa lingua, qualunque sia la lingua della fonte;
- **ricordi massimi per distillazione** (1–20, default 5): vedi Qualità della distillazione;
- **parole che bloccano** un contenuto, in aggiunta a quelle di default;
- le **regole di sicurezza** (schermata Sicurezza).

Le impostazioni personali del tuo PC (rete, cartelle, modelli LLM) sono invece in Impostazioni.
