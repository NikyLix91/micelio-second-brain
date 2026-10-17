# Spike della Fase 0

Esperimenti usa e getta (cartella [spikes/](../spikes)) per validare le scelte tecniche prima di scrivere il prodotto. Il codice degli spike non viene mantenuto: il valore sta nelle lezioni, riportate in [DESIGN.md](DESIGN.md).

## A — Rete P2P ([spikes/a-p2p](../spikes/a-p2p))

**Domanda:** Autobase + Hyperswarm reggono un team di nodi che entrano, escono e scrivono in contemporanea, su internet?

**Setup:** 3 nodi (più un quarto che entra tardi) in container Docker, DHT pubblica, ingresso tramite blocchi *optimistic* di Autobase.

**Esito:** ✅ 6 scenari su 6. Scritture concorrenti, deduplica, fondatore offline, partizione, rientro di un nodo offline, ingresso di un nuovo membro con chi l'ha invitato offline. Convergenza in 1–2 s, circa 40 MB di RAM per nodo.

**Problemi trovati:**
- Con `store.replicate(conn)` (come nel README di Autobase) i nuovi writer non vengono mai scoperti. Serve `base.replicate(conn)`, che aggancia il protocollo *wakeup*.
- Hyperswarm rifà la ricerca dei peer di rado: se cade il nodo "ponte", gli altri restano isolati. Serve un refresh periodico della discovery.

**Come rieseguirlo:** `cd spikes/a-p2p && npm ci && docker compose up -d && bash scenario.sh`

## B — Claude CLI headless ([spikes/b-claude-cli](../spikes/b-claude-cli))

**Domanda:** possiamo usare l'abbonamento Claude dell'utente (niente API key) per classificare e distillare?

**Esito:** ✅ `claude -p` con `--json-schema` restituisce output strutturato e validato. Haiku classifica correttamente 5 casi su 5 (la mail di valutazione HR e il testo con credenziali di un cliente → `private`) in circa 5 s ciascuno. Sonnet distilla ricordi di buona qualità.

**Problemi trovati:**
- Su Windows va lanciato senza shell: con `shell: true` lo schema JSON passato come argomento si rompe.
- Lo schema va in JSON Schema draft-07: il CLI rifiuta il draft 2020-12 (default di zod 4).
- Il modello di default è il più costoso: per la classificazione si sceglie `--model haiku`.
- La distillazione aggiunge dettagli plausibili ma assenti nella fonte: serve una regola di fedeltà nel prompt.

**Non verificato:** Codex CLI (nessun abbonamento disponibile).

## C — Embedding locali ([spikes/c-embeddings](../spikes/c-embeddings))

**Domanda:** la ricerca semantica può girare in locale, senza API, su Windows?

**Esito:** ✅ `multilingual-e5-small` con transformers.js trova il ricordo giusto in 4 query su 4, anche tra lingue diverse (query in inglese, ricordi in italiano). 3,3 ms per testo, modello da 130 MB.

**Avvertenze:** il processo occupa circa 620 MB di RAM con il modello caricato, quindi va caricato in un worker su richiesta. I punteggi di similarità sono compressi (0,80–0,90), quindi le soglie vanno tarate su dati reali.

## Cosa è cambiato nel passaggio al prodotto (Fase 1)

- L'ingresso dei membri usa **blind-pairing** al posto dei blocchi optimistic: la chiave di cifratura non viaggia più nel codice d'invito (decisione D2).
- L'indice usa **`node:sqlite`** al posto di better-sqlite3: niente dipendenze native, quindi più semplice su tutti i sistemi operativi.
