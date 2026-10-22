# Priorità: quali ricordi contano di più

Ogni ricordo ha un'**attivazione** da 0 a 1: quanto è "vivo" per il team. Decide l'ordine a parità di pertinenza nelle ricerche e quali ricordi il dreaming lascia decadere.

## L'attivazione {#activation}

Ispirata al modello della memoria umana ACT-R, è la somma pesata di quattro componenti, calcolata sul momento:

| Componente | Peso | Cosa misura |
|---|---|---|
| Recenza | 40% | Decadimento dall'ultimo uso (o dalla creazione), con emivita per tipo: decisione e riferimento 365 giorni, procedura e fatto 180, gotcha 120, snippet 90 |
| Usi | 30% | Quante volte il team l'ha usato (logaritmico: satura verso i 50 usi) |
| Voti | 20% | Somma dei voti di utilità (0 voti = neutro) |
| Centralità | 10% | Quanti collegamenti ha nella costellazione |

Un ricordo **fissato** ha sempre attivazione 1; una **Radice** non scende mai sotto 0,75. Un ricordo nato da una sessione faticosa parte con un piccolo vantaggio (vedi **Le scoperte sudate**).

## Le scoperte sudate {#effort}

Un gotcha trovato dopo un'ora di errori vale più di un fatto ovvio. Per questo un ricordo distillato da una sessione parte con un **vantaggio** proporzionale alla fatica del capitolo da cui nasce: fino a **+0,15** di attivazione. Il vantaggio segue la recenza, quindi si consuma col tempo: se nessuno usa il ricordo, dopo qualche mese è sparito. Quando la fatica è almeno 0,5, il dettaglio del ricordo dice «Nato da una sessione difficile» con errori e minuti.

**Come funziona dietro.** La fatica (da 0 a 1) si calcola dalla trascrizione del capitolo, senza chiamate LLM in più: metà dagli **errori degli strumenti** (piena a 15), un quarto dalla **durata** (piena a 120 minuti), un quarto dai **messaggi dell'utente** (pieni a 25). Le soglie sono state tarate su 196 capitoli reali: così risulta «difficile» circa un capitolo su cinque. Il valore viaggia nel ricordo (`source.effort`, con errori e minuti), resta anche dopo la revisione in Inbox, non entra nell'id del ricordo e i nodi di versioni precedenti lo ignorano. Valgono solo i ricordi nati da sessioni, non da documenti o salvataggi a mano. Codice: `src/ingest/effort.ts`.

## I voti {#votes}

👍 utile / 👎 fuorviante o obsoleto. Un voto per membro (l'ultimo vale), replicato a tutti come evento `memory.vote`. Anche gli agenti possono votare con il tool `vote`, quando confermi che un ricordo ti ha aiutato o era sbagliato.

## Gli usi {#uses}

Ogni volta che un ricordo compare fra i risultati (tuoi o del tuo agente) il tuo PC conta un uso in `private.db`. Ogni 30 minuti i contatori vengono pubblicati (`usage.report`) come **G-Counter**: ogni nodo ha il suo contatore cumulativo e il totale è la somma, quindi invii ripetuti o fuori ordine non gonfiano i numeri.

## Il pin {#pin}

📌 **fissa** un ricordo: non decade e il dreaming non lo archivia né lo fonde. Lo può fare qualunque membro; lo sblocca chi l'ha fissato o un admin. Per il sapere fondante che deve anche emergere da solo, usa le **Radici**.
