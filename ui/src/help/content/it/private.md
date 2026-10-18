# Registro privato

Il registro mostra **cosa non è andato al team e perché**. Esiste solo sul tuo PC (`private.db`), non viene mai replicato.

## Gli esiti {#outcomes}

| Esito | Significato |
|---|---|
| Bloccato dal filtro | argomento HR/personale, percorso protetto o file sensibile: nessuna chiamata all'AI |
| Privato | la classificazione l'ha ritenuto personale |
| Scartato | nessun sapere riutilizzabile, o nessun LLM configurato |
| Rifiutato da te | l'hai scartato dall'inbox |
| Scaduto | era in inbox da oltre 14 giorni senza decisione |

Per ogni voce: quando, la fonte (sessione, documento, CLI, agente), un'anteprima e il motivo.

## A cosa serve {#use}

A fidarsi del filtro: puoi controllare che una mail di valutazione, un contratto o un `.env` non siano finiti nel team, e capire perché una sessione non ha prodotto ricordi. Per i segreti tolti dai contenuti c'è il registro della schermata **Sicurezza**.
