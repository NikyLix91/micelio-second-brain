# Come funziona Micelio

Micelio è la **memoria condivisa del team di sviluppo**: raccoglie il sapere che nasce lavorando (sessioni con gli assistenti AI, documenti, note), lo ripulisce, lo distilla in **ricordi** brevi e lo rende disponibile a tutti i colleghi e ai loro agenti AI. Non c'è un server centrale: ogni PC del team ha una copia completa e cifrata del sapere.

## I pezzi {#pieces}

| Pezzo | Cos'è | Dove gira |
|---|---|---|
| **Daemon** | Il processo che fa tutto: rete P2P, raccolta, filtro privacy, distillazione, ricerca, API locale | In background sul tuo PC (`micelio start`, oppure all'accesso con `micelio autostart on`) |
| **App** | Questa interfaccia: guarda e governa il daemon | Finestra desktop (Electron) o browser su `http://127.0.0.1:7337/ui` |
| **Agenti AI** | Claude Code, Codex, VS Code, WebStorm… | Interrogano il daemon con il protocollo **MCP** e ricevono i ricordi pertinenti |
| **CLI** | Il comando `micelio` | Terminale: tutto ciò che fa l'app, più l'amministrazione |

Il daemon ascolta **solo su questo PC** (127.0.0.1) e risponde solo a chi ha il **token** salvato in `config.json`: l'app desktop lo legge da sola, il browser lo riceve con `micelio ui`.

## Dal lavoro al collega: il percorso di un ricordo {#flow}

1. **Raccolta.** A fine sessione di Claude Code (o ogni 15 minuti per le sessioni lunghe) il daemon legge la trascrizione; dalle cartelle di documenti legge i file nuovi o cambiati.
2. **Filtro privacy, sul tuo PC.** Argomenti HR e personali → il contenuto resta privato. Segreti e dati personali → sostituiti da segnaposto. File sensibili (`.env`, chiavi) → tolti per intero.
3. **Classificazione e distillazione.** Claude, tramite la CLI del tuo abbonamento (nessuna API key), decide se il contenuto è sapere utile al team e ne estrae pochi ricordi atomici.
4. **Pubblicazione.** Ogni ricordo diventa un **evento** firmato aggiunto al *tuo* log (un feed Hypercore), cifrato con la chiave del team.
5. **Replica.** I PC dei colleghi online scaricano il tuo log direttamente dal tuo (connessione P2P cifrata) e lo uniscono ai loro.
6. **Uso.** Il ricordo entra nell'indice di ricerca di ogni PC: la prossima volta che un collega (o il suo agente) cerca quell'argomento, lo trova.

## Prima la privacy {#privacy-first}

Tutto ciò che è sensibile viene fermato o ripulito **prima** di qualunque chiamata a un'AI: il filtro è deterministico e gira in locale. I casi dubbi non vengono pubblicati da soli: finiscono nella tua **Inbox**. Cosa non è andato al team, e perché, resta nel **Registro privato**, che non lascia mai il PC.

## Dove approfondire {#next}

- Dove sono fisicamente i dati: argomento **Dove sono i dati**.
- Come si collegano i PC: **Rete e replica**.
- Come nasce un ricordo nel dettaglio: **Raccolta e distillazione**.
- Il sapere che non si dimentica mai: **Radici**.
