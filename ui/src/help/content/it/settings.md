# Impostazioni

Le impostazioni di **questo PC**, salvate in `config.json` (non replicate). Quelle condivise dal team sono nella pagina Team.

## Rete {#network}

Sceglie dove i nodi del team si incontrano: DHT pubblica di Holepunch o DHT privata del team (i nodi di avvio, `host:porta`). «Verifica» prova la scelta senza applicarla; «Applica» salva e ricollega subito il nodo, senza riavvio e senza perdere dati. Tutti i membri devono usare la stessa DHT. Vedi **Rete e replica**.

## Raccolta automatica {#watch}

Le cartelle di progetto in cui le sessioni di Claude Code vengono raccolte (**opt-in**: fuori da queste cartelle nulla viene letto). Valgono anche le sottocartelle. Nell'app desktop c'è il selettore di cartelle.

## Cartelle di documenti {#documents}

Cartelle sorvegliate per PDF, Office, Markdown e diagrammi. Per ognuna: **originali scaricabili** (i colleghi possono chiedere il file originale) e **di Radici** (i ricordi diventano Radici). Vedi **Documenti**.

## Intelligenza (LLM) {#llm}

- **Adapter**: `claude` (la CLI di Claude Code installata sul PC, con il tuo abbonamento), `fake` (finto: solo per demo e test, non chiama Claude), `none` (niente LLM: i casi dubbi vanno tutti in inbox). Si cambia in `config.json` (`llm.adapter`) con riavvio del daemon.
- **Modelli**: uno veloce per classificare (default Haiku) e uno più capace per distillare (default Sonnet); dalla tendina Haiku, Sonnet, Opus o «Altro…» con qualunque nome accettato dalla CLI. Effetto immediato.
- **Chiamate massime al giorno** (default 300): oltre il limite il lavoro resta in coda per il giorno dopo.

## Claude Code {#claude-code}

Registra Micelio come **server MCP** di Claude Code (con `claude mcp add`, livello utente: vale in ogni progetto) e, se vuoi, l'**hook** di fine sessione in `~/.claude/settings.json`, salvandone prima una copia di backup. Da terminale: `micelio setup claude-code`. Vedi **Agenti e MCP**.

## Il file di configurazione {#config-file}

`config.json` contiene anche porta e interfaccia dell'API locale (default `127.0.0.1:7337`), il **token** di accesso, le soglie della raccolta delle sessioni (`watch.sessionScan`), il riassunto git (`watch.gitChanges`), il modello di embedding e l'ora del dreaming. Va trattato come privato: il token dà accesso al tuo nodo.
