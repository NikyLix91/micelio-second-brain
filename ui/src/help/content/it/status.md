# Stato del nodo

La pagina **Stato** riassume il tuo PC: nodo e ruolo, rete, sapere, LLM, raccolta automatica, inbox e spazio occupato. Si aggiorna da sola.

## Le schede {#cards}

- **Questo nodo**: nome, chiave (l'identità del tuo feed), ruolo (admin, indexer).
- **Rete**: quanti colleghi sono collegati adesso. Zero per più di 10 minuti → l'app desktop ti avvisa che il sapere non si sta sincronizzando.
- **Sapere del team**: i ricordi attivi presenti su questo PC.
- **Intelligenza (LLM)**: quale adapter è in uso, se la CLI risponde, le chiamate di oggi rispetto al budget (oltre il 90% arriva una notifica).
- **Raccolta automatica**: lavori in coda, completati, falliti; cartelle abilitate.
- **Inbox**: i ricordi in attesa di una tua decisione.

## Lo spazio occupato {#storage}

- **Su questo disco**: il totale di Micelio, diviso fra log del team (`corestore/`), indice di ricerca (`view.db`), archivio privato (`private.db`), documenti scaricati (`sources/`) ed export.
- **Provenienza per membro**: per ogni membro, la dimensione del suo feed nel log del team (`byteLength` del suo Hypercore) e la quota sul totale. Comprende tutto ciò che ha scritto: ricordi, ma anche voti, uso e sogni. È la stessa su ogni PC, perché ogni nodo conserva tutto.
