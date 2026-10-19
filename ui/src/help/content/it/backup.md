# Backup e ripristino

Il sapere di un team vive su tutti i PC del team: finché ce n'è uno, c'è il sapere. Ma la replica non è un backup: non protegge da un errore che si propaga a tutti, da un team abbandonato, e non permette di portare il sapere in un team nuovo. Il **backup** è un file con tutto il sapere del team, che si ripristina in un team nuovo o in uno esistente.

## Creare un backup {#create}

Da **Team → Backup e ripristino**: scegli una password (almeno 8 caratteri, da ripetere) e premi «Crea e scarica». Da terminale: `micelio backup create --out <cartella>`; la password si scrive senza che compaia, oppure si passa con la variabile `MICELIO_BACKUP_PASSWORD` negli script. Mai come argomento: finirebbe nella cronologia della shell.

Qualunque membro può creare un backup: vede già tutto il sapere del team. Il file si chiama `<team>-<data>.micelio-backup`.

**Cosa contiene:** ricordi attivi e storico (archiviati e sostituiti, con il motivo), con autore e data originali; Radici con categoria e segnalazioni aperte; collegamenti fra ricordi; voti e ricordi fissati; uso dei ricordi; lacune di conoscenza; configurazione condivisa del team (es. lingua dei ricordi).

**Cosa non contiene:** chiavi, membri e inviti (un team ripristinato ha chiavi nuove); archivio privato, Inbox e ricordi personali (stanno su un solo PC); originali dei documenti; ricordi redatti.

**Conserva la password.** Senza, il backup non si apre: nessuno può recuperarla.

## Ripristinare {#restore}

Da **Team → Backup e ripristino → Ripristina un backup**: scegli il file. Micelio mostra di che team è, di quando e quanti ricordi contiene; poi chiede la password e dove ripristinarlo:
- **in un team nuovo** su questo PC: ne diventi fondatore e admin, e inviti tu i colleghi. Si può fare anche dalla schermata di benvenuto, su un PC appena installato («Ripristina da un backup»);
- **dentro questo team**: il sapere del backup si aggiunge a quello del team, per tutti. Solo gli admin, perché scrive per tutti.

Da terminale: `micelio backup restore <file> --new-team [nome]` oppure, dentro il team corrente, `micelio backup restore <file>`.

I ricordi già presenti nel team restano come sono, con il loro stato e le loro Radici: il ripristino aggiunge, non sostituisce. Ripristinare due volte lo stesso backup non duplica nulla. I ricordi ripristinati mostrano l'autore e la data originali, e contano per la priorità con la loro data: un ricordo vecchio non torna "nuovo".

Una password sbagliata non crea nulla: nessun team vuoto, nessun ricordo.

## Backup automatici {#auto}

Da **Impostazioni → Backup automatici**, per ogni team: attivali, scegli la cartella (anche condivisa o di rete), quanti tenerne (default 7) e una password. Micelio crea un backup al giorno, il primo subito, e cancella i più vecchi oltre il numero scelto (solo i backup di quel team). L'esito dell'ultimo, o l'errore, compare sotto. Da terminale: `micelio backup auto on --folder <cartella>`, `micelio backup auto off`, `micelio backup auto` per vedere lo stato.

La password dei backup automatici resta solo su questo PC, nelle impostazioni del team (`teams/<id>/settings.json`). Non indebolisce nulla: i dati del team su questo disco sono già in chiaro. La cifratura protegge le copie nella cartella dei backup, che spesso è condivisa.

## Come funziona dietro {#internals}

**Il file.** È un JSON con quattro parti: il **manifesto** in chiaro (team, data, chi l'ha creato, conteggi), i parametri della chiave, quelli della cifratura e i **dati**. I dati sono il sapere del team in JSON, compresso (gzip) e cifrato con **AES-256-GCM**. La chiave deriva dalla password con **scrypt** (N = 32 768, r = 8, p = 1): ogni tentativo costa circa un decimo di secondo e 32 MB di memoria, così provare password a tappeto è lento. Il manifesto è autenticato insieme ai dati: cambiarne anche una lettera rende il file illeggibile. Una password sbagliata e un file alterato danno lo stesso errore, e non si ripristina nulla.

**Il backup** si legge dalla vista del team (Hyperbee), non dall'indice locale: comprende anche lo storico e tutto ciò che l'indice non tiene.

**Il ripristino** non copia la vista: riscrive il sapere come **eventi normali** del team (`memory.add`, `memory.supersede`, `memory.archive`, `root.set`, `memory.link`, …), firmati dal nodo che ripristina. Così arrivano ai colleghi come ogni altro evento e passano dalle stesse regole. L'autore per il team è chi ripristina (un feed firmato non si può falsificare); autore, data e team d'origine stanno nel ricordo, in `source.origin`, e i nodi di versioni precedenti li ignorano. L'id di un ricordo deriva dal suo contenuto: per questo i ricordi già presenti si riconoscono e non si duplicano.

**Prestazioni.** Gli eventi si scrivono a blocchi di 500 in un'unica scrittura, e l'indice si aggiorna una volta sola alla fine. Gli embedding dei ricordi nuovi si calcolano in sottofondo, e i vicini per significato si ricalcolano tutti insieme. Misurato: 5 000 ricordi ripristinati in circa 10 secondi, con il daemon che continua a rispondere.
