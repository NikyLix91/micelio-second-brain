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

Un ricordo **fissato** ha sempre attivazione 1; una **Radice** non scende mai sotto 0,75.

## I voti {#votes}

👍 utile / 👎 fuorviante o obsoleto. Un voto per membro (l'ultimo vale), replicato a tutti come evento `memory.vote`. Anche gli agenti possono votare con il tool `vote`, quando confermi che un ricordo ti ha aiutato o era sbagliato.

## Gli usi {#uses}

Ogni volta che un ricordo compare fra i risultati (tuoi o del tuo agente) il tuo PC conta un uso in `private.db`. Ogni 30 minuti i contatori vengono pubblicati (`usage.report`) come **G-Counter**: ogni nodo ha il suo contatore cumulativo e il totale è la somma, quindi invii ripetuti o fuori ordine non gonfiano i numeri.

## Il pin {#pin}

📌 **fissa** un ricordo: non decade e il dreaming non lo archivia né lo fonde. Lo può fare qualunque membro; lo sblocca chi l'ha fissato o un admin. Per il sapere fondante che deve anche emergere da solo, usa le **Radici**.
