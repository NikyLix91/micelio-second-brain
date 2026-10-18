# Riga di comando

Il comando `micelio` fa tutto ciò che fa l'app, e qualcosa in più. `micelio --help` e `micelio <comando> --help` elencano opzioni e sottocomandi. `--home <cartella>` usa un nodo diverso da `~/.micelio`. Con l'installer di Windows il comando sta in `resources\bin` della cartella d'installazione, aggiunta al PATH dell'utente: si usa da qualunque terminale aperto dopo l'installazione.

## Il daemon {#daemon}

| Comando | Effetto |
|---|---|
| `micelio start` / `stop` / `status` | avvia in background, ferma, mostra lo stato |
| `micelio autostart on` / `off` | avvio automatico all'accesso al PC (Windows, macOS, Linux) |
| `micelio ui` | apre l'app nel browser con un link monouso |

## Team e rete {#team}

| Comando | Effetto |
|---|---|
| `micelio init <team>` | crea un team (si aggiunge a quelli già presenti) |
| `micelio invite` · `micelio join <codice>` | invita · entra in un team |
| `micelio teams` · `teams default <team>` · `teams leave <team>` | i team del PC, il predefinito, togliere un team |
| `micelio --team <team> <comando>` | qualunque comando su un team diverso dal predefinito |
| `micelio members` | membri e ruoli |
| `micelio team config <chiave> <valore>` | impostazione di team (admin), es. `distill.maxMemories 8` |
| `micelio network` · `set` · `public` · `private` · `check` | DHT in uso, cambio, diagnosi |

## Sapere {#memory}

| Comando | Effetto |
|---|---|
| `micelio remember "<titolo>" -b "<testo>"` | propone un ricordo |
| `micelio recall "<parole>"` · `micelio get <id>` | cerca · legge |
| `micelio vote <id> up\|down\|clear` · `pin` / `unpin <id>` | segnali di priorità |
| `micelio roots` · `add` · `remove` · `confirm` · `review` · `suggested` | Radici |
| `micelio dream now` · `dream log` · `archive` · `restore <id>` | dreaming e archivio |
| `micelio quality` | qualità della distillazione |
| `micelio remember … --personal` · `micelio personal` | ricordi personali (solo su questo PC) |
| `micelio stale [--check]` | ricordi con il codice cambiato |
| `micelio gaps` · `gaps mine` · `gaps report` · `gaps close` · `micelio digest` | lacune e riepilogo |
| `micelio roots export <cartella>` · `roots import <percorso>` | Radici nei file degli agenti · import |

## Raccolta {#collection}

| Comando | Effetto |
|---|---|
| `micelio setup claude-code` | registra MCP e hook in Claude Code |
| `micelio watch add <cartella>` | abilita la raccolta delle sessioni |
| `micelio docs add <cartella> [--shareable] [--roots]` | cartella di documenti |
| `micelio ingest status` · `scan` · `run` | stato della coda, scansione, elaborazione |
| `micelio inbox` · `private` | casi dubbi · registro privato |

## Sicurezza {#security}

`micelio security test | scan | clean <id> | log | rules`: banco di prova, scansione, ripulitura (admin), registro, regole.
