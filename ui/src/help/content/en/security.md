# Security

Passwords, tokens, keys and files such as `.env` never enter the team knowledge: they are removed on your PC before any AI. The **Security** screen shows the rules, lets you test them and fix what has already been published.

## What is detected {#detectors}

Always, with no configuration: keys and tokens of Anthropic, OpenAI, AWS, Azure (account keys and SAS signatures), Google, GitHub, GitLab, npm, PyPI, Slack, Stripe, SendGrid; JWTs; `Authorization` and `Bearer` headers; PEM private keys (also inside JSON); passwords in connection strings and URLs; variables such as `API_KEY=…` or `"password": …`; IBANs, Italian tax codes, emails, phone numbers. Each value becomes a placeholder such as `[REDACTED:aws-key]`.

## Random strings {#entropy}

A secret with no known format (a generated key) is recognised by its **entropy**: at least 32 characters with upper case, lower case and digits, very "random" (≥ 4 bits per character). Hexadecimal hashes (commits, ids) are excluded on purpose. Redaction is **idempotent**: a placeholder is not recognised again.

## Sensitive files {#files}

`.env` and variants, keys (`*.pem`, `*.key`, `id_rsa`…), `credentials`, `secrets.*`, kubeconfig, `.npmrc`, `.netrc`, `*.tfvars`, `*.tfstate`… Their **content** never gets in: in sessions, if Claude reads, writes or edits them (even with `cat .env`), the tool's input and output disappear entirely; in document folders they are not opened; in the git summary only the name appears. Sample files (`.env.example`…) are not sensitive.

## Team rules {#team-rules}

The admin can add, for every node (`team.config` events):
- their own secret **patterns** (named regular expressions, e.g. an internal customer code): invalid or too generic ones are rejected;
- **exceptions** for false positives: text or `/regex/`;
- additional **sensitive files**: globs such as `**/*.conf`.

## The test bench {#bench}

Paste a text or type a file name and see what would be removed, with the rules in force. Nothing is saved. From the terminal: `micelio security test "…"`.

## Cleaning what is already published {#scan-clean}

"Scan the memories" checks published memories with the **current** rules (useful after adding a pattern). "Clean" (admins only) publishes the redacted version, removes the original from everyone's view (`memory.redact`) and, if it was a Root, it stays one. Every PC confirms the redaction: see **Redactions and receipts**. Limit: whoever had already read or exported it by hand keeps a copy, and the encrypted blocks stay in the log.

## Redactions and receipts {#redactions}

When an admin removes a memory for the whole team ("Clean" above, or `micelio redact`), every PC, as soon as it receives the redaction, also removes the memory from its local copies and **confirms** it. The **Redactions** card shows, for every redacted memory, date, admin, reason and how many PCs confirmed; opening it shows each member:

- **confirmed on …**, with what it cleaned and whether the confirmation is signed;
- **pending**: the PC is off or runs a version older than 0.6.0; it will confirm the next time it starts after the update;
- **left the team** without confirming: not counted in the total.

**Export receipt** produces a readable text (in the app's language) or a JSON with the signatures, to hand to whoever must know the data was removed, for example a customer. From the terminal: `micelio redactions` for the list, `micelio redactions <id>` for the receipt (`--json`, `--en`).

**What every PC cleans**, besides the search index, vectors and Markdown export (already removed by the redaction itself):
- **chat answers** that cited the memory or showed it in the map: they stay as "answer removed";
- **Inbox proposals** with the same content;
- the **personal copy** of the same memory, if there was one.

**Backups are not touched**: deleting or rewriting them is too risky. Every PC counts this team's automatic backups made before the redaction and still in the backup folder, and declares them in the receipt: whoever keeps them deletes them if needed.

**Limits, also written in the receipt.** The receipt certifies what the software did on the PCs that confirmed. It can't guarantee that nobody made a copy by hand (copied text, screenshots, exported files), nor know about backups made by hand in other folders. The encrypted blocks of the team log remain; no node shows their content anymore.

**How it works behind the scenes.** The redaction (`memory.redact`) now records when and by which admin. On every view update, each node looks for redacted memories it hasn't confirmed yet, does the local cleanup and publishes the `redact.ack` event with the time, what it cleaned and how many backups remain. Each node confirms only for itself (the event is in its signed feed) and the first confirmation counts. If the PC has a **personal identity** (`identity.json`), the confirmation also carries an Ed25519 signature over the text `micelio/redact-ack/v1:<memory>:<node>:<time>`: the receipt's JSON contains text, public key and signature, so anyone can verify it with a standard tool, without Micelio. Each node keeps the signature only if it's valid. Nodes on older versions ignore the event and stay "pending". Code: `src/insight/redaction-receipt.ts`.

## The log {#log}

What the filter removed on **this PC**, from which session or document, of which kind. Only kinds and file names are recorded, **never the values**. It lives in `private.db` and never leaves the PC.
