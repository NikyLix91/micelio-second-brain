# Radici

Le **Radici** sono il sapere fondante del team: paradigmi architetturali, mappe di rete e infrastruttura, interfacce e contratti fra sistemi, modello di dominio, best practice (es. le regole di sviluppo con l'AI), policy di sicurezza. Si consultano di rado, ma non devono mai essere dimenticate.

## Cosa cambia per una Radice {#guarantees}

- **Non si dimentica**: la sua attivazione non scende mai sotto **0,75**; il dreaming non la archivia e non la fonde con altri ricordi. Queste garanzie sono nella funzione `apply`, quindi valgono su ogni PC.
- **Emerge quando serve** (vedi sotto).
- **Si rivede invece di dimenticarla** (vedi Revisione).

È un record della vista (`root/<id>`) con categoria, chi l'ha promossa, data dell'ultima revisione, stato (`ok` o `review`) e segnalazioni.

## Come arriva agli agenti {#emerge}

- In coda a ogni ricerca `recall` arrivano fino a 3 **Radici pertinenti** che non sono già fra i risultati: il sapere fondante raggiunge l'agente anche se la domanda non lo nomina.
- Il tool MCP **`architecture`** dà le Radici di un progetto, di una categoria o dei file che l'agente sta toccando; le istruzioni del server chiedono di chiamarlo prima di modificare l'architettura.

## Come nasce una Radice {#create}

- **Qualunque membro** può promuovere (e togliere) una Radice: dal dettaglio di un ricordo («Rendi Radice»), da CLI (`micelio roots add <id> <categoria>`) o chiedendolo all'agente (tool `mark_root`).
- **Suggerite da Micelio**: il distillatore segnala i ricordi che sembrano fondanti; restano suggerimenti nel tuo `private.db` finché non li promuovi o li ignori.
- **Cartelle di Radici**: i documenti di una cartella marcata «di Radici» (Impostazioni) diventano Radici da soli.

## La revisione {#review}

Una Radice che non decade può diventare **falsa**. «Rivedi le Radici» (o `micelio roots review`) cerca tre indizi:
- **codice cambiato**: commit successivi all'ultima revisione sui file citati, o file scomparsi; il repository si cerca fra le cartelle abilitate su questo PC e le loro sotto-cartelle;
- **documento d'origine** modificato o rimosso (solo sul PC che lo possiede);
- **contraddizioni**: ricordi più recenti e simili che la contraddicono, valutati da Claude (al massimo 30 confronti per revisione, entro il budget) più i collegamenti «contraddice» trovati dal dreaming.

Le Radici con indizi diventano **da rivedere** per tutti (evento `root.flag`). Nulla cambia da solo: una persona conferma («Rivista: è ancora valida», evento `root.confirm`), corregge o toglie la Radice.

## Nelle viste grafiche {#visual}

Nel **Nucleo 3D** le Radici stanno al centro della sfera, con un anello bianco (rosso se da rivedere); nella **Mappa 2D** sono rombi con contorno. «◆ Radici» le isola in entrambe.

## Nei file degli agenti {#agent-files}

«File per gli agenti» (in fondo alla pagina) scrive le Radici di un progetto in `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex e altri) o `.cursor/rules/micelio.mdc` (Cursor), i file che gli agenti leggono da soli a ogni sessione. Micelio scrive solo fra i marcatori `<!-- micelio:start -->` e `<!-- micelio:end -->`; il resto del file non si tocca. Il blocco non contiene date: si riscrive solo quando le Radici cambiano davvero, così non sporca i diff. L'elenco dei file tenuti aggiornati sta nelle impostazioni del team (`settings.json`). Da terminale: `micelio roots export <cartella> --format claude|agents|cursor`.

## Importare sapere già scritto {#import}

«Importa Radici» trasforma in Radici il sapere che il team ha già in file: una cartella di **ADR** (una decisione per file, categoria architettura), `CLAUDE.md` / `AGENTS.md` (una Radice per sezione `##`, saltando il blocco di Micelio), un vault Markdown. Nessun LLM: il testo resta quello scritto, passa dal filtro dei segreti e i contenuti riservati (HR, personali) non entrano. Dall'intestazione YAML delle note (Obsidian) si prendono titolo e tag, e l'intestazione esce dal testo. **Reimportare aggiorna**: un file cambiato sostituisce la sua versione precedente (che resta nello storico), uno uguale non si duplica. Da terminale: `micelio roots import <percorso> [--category …]`.
