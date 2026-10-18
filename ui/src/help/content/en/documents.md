# Documents

Document folders turn manuals, specifications, technical minutes and diagrams into team memories. Only the **distilled knowledge** reaches the team: the original stays on the PC of its owner.

## Formats {#formats}

PDF, Word (`.docx`), Excel (`.xlsx`), PowerPoint (`.pptx`), OpenDocument, RTF, HTML, Markdown, text, CSV and diagrams: **draw.io** (compressed pages too), **SVG**, **PlantUML**, **Mermaid**. From diagrams the labels are read (blocks, arrows, page names), not the geometry. Text is extracted locally, with no external programs; files over 20 MB are ignored.

## The journey of a document {#flow}

1. The folder is watched: every new or modified file is noticed and identified by its SHA-256 **hash** (an unchanged file is not processed again).
2. Protected paths (e.g. `**/hr/**`) and sensitive files are not even opened.
3. The text is split into parts of about 12,000 characters (at most 6 per document).
4. Each part goes through filter, classification and distillation like a session.
5. Memories carry in the `source` field the file name, size, type and hash: **never the path** on your disk.

## Originals on request {#download}

If the folder is **shareable**, a colleague can press "Download the original" on a memory. The request travels on the already open P2P connection (protocol `micelio/file/v1`): it is **signed** by the colleague and bound to that connection, so only an active member can ask and it cannot be replayed. Your PC looks for the file with that hash and sends it only if it is in a shareable folder; the receiver checks the hash and saves it in `sources/` (30-day cache). The owner must be online.

## Roots folders {#roots-folders}

A folder marked **Roots** (architecture, policies, development rules, the best-practice vault) turns its memories directly into Roots, with the category proposed by the distiller.

## What is not read {#blocked}

Folders such as HR, contracts, payslips, evaluations, private (`**/hr/**`, `**/contratti/**`…, plus the team's ones), sensitive files and Office temporary files (`~$…`). Outcomes go to the Private log.
