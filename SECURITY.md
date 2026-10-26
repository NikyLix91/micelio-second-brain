# Security policy

Micelio moves a development team's knowledge between PCs over the internet and runs a local API on every machine, so security reports are taken seriously.

## Supported versions

Only the latest released version receives security fixes. The app can show its version in Settings → About.

## Reporting a vulnerability

**Please do not open a public issue.** Use one of these private channels:

1. GitHub's [private vulnerability reporting](https://github.com/salvatorestracquadanio86/micelio-second-brain/security/advisories/new) (preferred);
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

## Known limitations

These are known and documented. Reports that only restate them aren't needed, but ideas to close them are welcome.

- **A removed member can still read new memories.** Removal takes away the right to write, but the team's encryption key doesn't change yet, so an ex-member who keeps their data folder can keep replicating. Rotating the key on removal is planned. Until then, for someone who must lose access, create a new team and move the knowledge with a backup.
- **Redaction is best-effort.** A redacted memory disappears from every view, but the original encrypted block stays in its author's feed on every member, so a modified client can still read it.
- **Members are trusted colleagues.** Any member can archive, supersede or restore other people's memories (pinned memories and Roots excepted) and add writers without an invite (traced as invited by them). What a member writes reaches the other members' agents as context.
- **The DHT shows who is online.** Anyone who knows a team's topic can see the IP addresses of the members announcing it, but can't connect to the team's data.
- **Shared machines.** On macOS and Linux the data folder is readable only by its user (since 0.6.2). The local API is protected by a per-user token, but on a PC shared by several users another user can try to occupy the port first; a check that the daemon is really yours is planned.
