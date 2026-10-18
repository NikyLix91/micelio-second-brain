# Documenti

Le cartelle di documenti trasformano manuali, specifiche, verbali tecnici e diagrammi in ricordi del team. Al team arriva **solo il distillato**: l'originale resta sul PC di chi lo possiede.

## Formati {#formats}

PDF, Word (`.docx`), Excel (`.xlsx`), PowerPoint (`.pptx`), OpenDocument, RTF, HTML, Markdown, testo, CSV e i diagrammi: **draw.io** (anche le pagine compresse), **SVG**, **PlantUML**, **Mermaid**. Dei diagrammi si leggono le etichette (blocchi, frecce, nomi delle pagine), non la geometria. Il testo si estrae in locale, senza programmi esterni; file oltre 20 MB vengono ignorati.

## Il percorso di un documento {#flow}

1. La cartella è sorvegliata: ogni file nuovo o modificato viene notato e identificato dal suo **hash** SHA-256 (un file non cambiato non si rielabora).
2. Percorsi protetti (es. `**/hr/**`) e file sensibili non vengono nemmeno aperti.
3. Il testo viene diviso in parti da circa 12.000 caratteri (al massimo 6 per documento).
4. Ogni parte passa da filtro, classificazione e distillazione come una sessione.
5. I ricordi portano nel campo `source` il nome del file, la dimensione, il tipo e l'hash: **mai il percorso** sul tuo disco.

## Originali su richiesta {#download}

Se la cartella è **condivisibile**, un collega può premere «Scarica l'originale» su un ricordo. La richiesta viaggia sulla connessione P2P già aperta (protocollo `micelio/file/v1`): è **firmata** dal collega e legata a quella connessione, quindi solo un membro attivo può chiedere e non si può riusare. Il tuo PC cerca il file con quell'hash e lo invia solo se sta in una cartella condivisibile; chi lo riceve verifica l'hash e lo salva in `sources/` (cache di 30 giorni). Serve che il proprietario sia online.

## Cartelle di Radici {#roots-folders}

Una cartella marcata **di Radici** (architettura, policy, regole di sviluppo, il vault delle best practice) trasforma i suoi ricordi direttamente in Radici, con la categoria proposta dal distillatore.

## Cosa non viene letto {#blocked}

Cartelle come HR, contratti, buste paga, valutazioni, private (`**/hr/**`, `**/contratti/**`…, più quelle del team), i file sensibili e i file temporanei di Office (`~$…`). Gli esiti finiscono nel Registro privato.
