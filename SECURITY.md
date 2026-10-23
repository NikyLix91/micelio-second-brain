# Security policy

Micelio moves a development team's knowledge between PCs over the internet and runs a local API on every machine, so security reports are taken seriously.

## Supported versions

Only the latest released version receives security fixes. The app can show its version in Settings → About.

## Reporting a vulnerability

**Please do not open a public issue.** Use one of these private channels:

1. GitHub's [private vulnerability reporting](https://github.com/salvatorestracquadanio86/micelio-brain/security/advisories/new) (preferred);
2. an email to **salvatorestracquadanio86@gmail.com** with `[Micelio security]` in the subject.

Include what you found, how to reproduce it, the version and the OS, and what an attacker could achieve. You will get an answer within 7 days. Once the fix is released, the advisory is published and you are credited, unless you prefer otherwise.

## What is in scope

Examples of what we especially want to hear about:

- anything that lets content reach the team **without passing the privacy filter** or the secret redaction;
- forging events, authors or permissions in the replicated log (`src/net/apply.ts`);
- joining a team without a valid invite, or keeping access after removal;
- access to the local API (`127.0.0.1:7337`) or the MCP endpoint without the token, including from a web page or from another user of the same PC;
- tampering with backups, redaction receipts or, once available, app updates.

The threat model is described in [docs/en/DESIGN.md](docs/en/DESIGN.md).
