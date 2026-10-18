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

"Scan the memories" checks published memories with the **current** rules (useful after adding a pattern). "Clean" (admins only) publishes the redacted version, removes the original from everyone's view (`memory.redact`) and, if it was a Root, it stays one. Limit: whoever had already read or exported it keeps a copy, and the encrypted blocks stay in the log.

## The log {#log}

What the filter removed on **this PC**, from which session or document, of which kind. Only kinds and file names are recorded, **never the values**. It lives in `private.db` and never leaves the PC.
