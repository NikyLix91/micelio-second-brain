# Impostazioni

Le impostazioni di **questo PC**, salvate in `config.json` (non replicate). Quelle condivise dal team sono nella pagina Team.

## Rete {#network}

Sceglie dove i nodi del team si incontrano: DHT pubblica di Holepunch, DHT privata del team (i nodi di avvio, `host:porta`) oppure **solo locale**, nessuna rete (vedi **Da soli**). «Verifica» prova la scelta senza applicarla; «Applica» salva e ricollega subito il nodo, senza riavvio e senza perdere dati. Tutti i membri devono usare la stessa DHT. Vedi **Rete e replica**.

## Raccolta automatica {#watch}

Le cartelle di progetto in cui le sessioni di Claude Code vengono raccolte (**opt-in**: fuori da queste cartelle nulla viene letto). Valgono anche le sottocartelle. Nell'app desktop c'è il selettore di cartelle.

## Cartelle di documenti {#documents}

Cartelle sorvegliate per PDF, Office, Markdown e diagrammi. Per ognuna: **originali scaricabili** (i colleghi possono chiedere il file originale) e **di Radici** (i ricordi diventano Radici). Vedi **Documenti**.

## Intelligenza (LLM) {#llm}

- **Adapter**: `claude` (la CLI di Claude Code installata sul PC, con il tuo abbonamento), `fake` (finto: solo per demo e test, non chiama Claude), `none` (niente LLM: i casi dubbi vanno tutti in inbox). Si cambia in `config.json` (`llm.adapter`) con riavvio del daemon.
- **Modelli**: uno veloce per classificare (default Haiku) e uno più capace per distillare (default Sonnet); dalla tendina Haiku, Sonnet, Opus o «Altro…» con qualunque nome accettato dalla CLI. Effetto immediato.
- **Chiamate massime al giorno** (default 300): oltre il limite il lavoro resta in coda per il giorno dopo.

## Claude Code {#claude-code}

Registra Micelio come **server MCP** di Claude Code (livello utente: vale in ogni progetto) e, se vuoi, gli **hook** in `~/.claude/settings.json`, salvandone prima una copia di backup. Da terminale: `micelio setup claude-code`. Vedi **Agenti e MCP**.

**Come funziona dietro.** Micelio usa il comando `claude mcp add` e cerca `claude` anche fuori dal PATH: nell'installazione nativa (`~/.local/bin`), in quella di npm (lancia il suo `cli.js` con il proprio Node, perché `claude.cmd` non si può avviare senza shell), in WinGet e dentro l'estensione di Claude Code per VS Code, Cursor e Windsurf (la versione più recente). Se non lo trova da nessuna parte, scrive la stessa voce direttamente in `~/.claude.json` (o nella cartella di `CLAUDE_CONFIG_DIR`), dopo averne salvato una copia in `.claude.json.micelio-backup`: per Claude Code il risultato è identico. Il messaggio dopo il clic dice quale strada ha preso. Lo stesso eseguibile serve anche alla distillazione (Intelligenza).

**Dopo la registrazione** chiudi e riapri le sessioni di Claude Code (o ricarica la finestra di VS Code): Claude Code legge i server MCP solo all'avvio.

**Un utente, una configurazione.** Claude Code legge la configurazione dal profilo dell'utente del sistema che lo esegue. Se lo avvii con un utente diverso da quello con cui gira Micelio (per esempio Claude Code installato e usato da un'utenza amministrativa per policy aziendale), non vedrà mai Micelio, e Micelio non potrà leggere le sue sessioni. Micelio se ne accorge quando in questo profilo non c'è traccia di Claude Code (né sessioni né i campi che Claude Code scrive al primo avvio) e lo segnala con un avviso. La soluzione è aprire Micelio con lo stesso utente con cui usi Claude Code (tasto destro → «Esegui come altro utente»), entrare nel team con un invito e ripetere la configurazione.

## Informazioni {#about}

Versione dell'app, autore e licenza, con i link al codice sorgente, al testo della licenza e alla guida per contribuire.

Micelio è **software libero** con licenza **GNU AGPL-3.0**: puoi usarlo gratis, anche in azienda, studiarlo, modificarlo e ridistribuirlo. Una sola condizione: se distribuisci una versione modificata, o la offri ad altri come servizio in rete, devi rendere disponibile il suo codice sorgente con la stessa licenza. Usarlo e modificarlo solo al tuo interno non obbliga a nulla.

**Come funziona dietro.** Il numero di versione viene da `package.json` ed è scritto nella UI al momento della build. Il testo completo della licenza è anche nella cartella d'installazione (`LICENSE.txt`). I link si aprono nel browser del sistema, non dentro l'app.

## Il file di configurazione {#config-file}

`config.json` vale per tutta la macchina: porta e interfaccia dell'API locale (default `127.0.0.1:7337`), il **token** di accesso, l'LLM, il modello di embedding e il team predefinito. Va trattato come privato: il token dà accesso al tuo nodo.

Ogni team ha poi il suo `teams/<id>/settings.json`: cartelle abilitate, soglie della raccolta delle sessioni (`watch.sessionScan`), riassunto git (`watch.gitChanges`), rete e ora del dreaming. Le schede di questa pagina mostrano le impostazioni del team scelto nella barra laterale; LLM e porta sono comuni a tutti i team.
