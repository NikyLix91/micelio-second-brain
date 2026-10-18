# Rete e replica

Micelio non ha un server centrale: i PC del team si trovano su internet e si scambiano direttamente i log. Ogni PC ha una copia completa del sapere.

## La chiave del team {#team-key}

Un team nasce con due chiavi, salvate in `state.json`: la chiave della **base** (identifica il team) e la chiave di **cifratura** (32 byte casuali). Chi ha entrambe può leggere tutto il sapere del team: per questo l'ingresso passa da un invito e le chiavi non viaggiano mai in chiaro.

## Come si trovano i PC {#discovery}

Ogni daemon calcola dalla chiave del team un'**impronta** (un hash da cui non si risale alla chiave) e la annuncia in una **DHT** (tabella distribuita, HyperDHT): «per questa impronta rispondo io a questo indirizzo». Contemporaneamente cerca gli altri con la stessa impronta. La DHT vede solo impronte e indirizzi IP, mai nomi o contenuti.

## La connessione {#connection}

Due PC dietro router si collegano con l'**hole punching**: un nodo della DHT li mette in contatto e i due si "bussano" nello stesso istante, così i router lasciano passare la connessione. Da lì il collegamento è **diretto** fra i PC, cifrato con il protocollo **Noise** e autenticato con le chiavi dei nodi.

## La replica {#replication}

Su ogni connessione Autobase scambia i feed dei membri: ognuno scarica i blocchi che non ha, da **qualunque** collega online (non serve che l'autore sia acceso). Gli **indexer** (gli admin) fissano i punti di ordinamento definitivi del log. Ogni pochi secondi, se il nodo è isolato, rifà la ricerca dei colleghi; altrimenti ogni minuto.

## La cifratura {#encryption}

Due livelli: la connessione è cifrata (Noise) e i blocchi del log sono cifrati con la chiave del team. Un nodo estraneo che ottenesse i blocchi non potrebbe leggerli.

## DHT pubblica o privata {#public-private}

- **Pubblica** (default): i nodi di avvio di Holepunch. Nessun server da gestire; l'impronta del team e gli IP dei membri sono visibili nella DHT pubblica (i contenuti mai).
- **Privata del team**: un piccolo server Linux (`server/` nella repository, porta UDP 49737) fa da punto d'incontro. Nessuna dipendenza da terzi. Si sceglie in **Impostazioni → Rete**: tutti i membri devono usare la stessa DHT, altrimenti non si trovano.

**Verifica** in quella scheda prova la scelta senza applicarla: dice se la DHT risponde, con che IP pubblico esci e se il tuo router ha un NAT "simmetrico" (il caso difficile per l'hole punching).

## Offline {#offline}

Micelio funziona anche da solo: ricerca, raccolta e distillazione sono locali. Ciò che scrivi resta nel tuo feed e arriva ai colleghi alla prossima connessione; ciò che scrivono loro arriva a te allo stesso modo. Un **nodo sempre acceso** (es. sul server del team) rende il sapere disponibile anche quando i PC sono spenti.

## Gli inviti {#invites}

Un invito è un codice **monouso** valido 24 ore (protocollo *blind-pairing*). Il nuovo arrivato lo usa per chiedere l'ingresso; **qualunque membro online** che conosce l'invito lo accoglie, gli passa le chiavi del team su un canale cifrato e scrive l'evento `member.add`. Il codice d'invito non contiene la chiave di cifratura.
