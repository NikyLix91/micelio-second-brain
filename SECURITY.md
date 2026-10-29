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
- tampering with backups, redaction receipts or app updates (for example getting the desktop app to install a package without a valid signature).

The threat model is described in [docs/en/DESIGN.md](docs/en/DESIGN.md).

## Release and update signing

Since 0.8.0 the desktop app updates itself from this repository's GitHub releases. Every package it can install (Windows installer, AppImage) carries an **Ed25519 signature** in a `.sig` file, and the app installs nothing without a valid one:

- the private key exists only in the `UPDATE_SIGNING_KEY` secret of the GitHub `release` environment, which only `v*` tags can use, and in an offline backup kept by the maintainer. It isn't in the repository or on any build machine;
- the app embeds the accepted public keys ([desktop/src/update-keys.ts](desktop/src/update-keys.ts)) and checks the signature, the package name, the version and the SHA-256 of the downloaded file ([desktop/src/update-signature.ts](desktop/src/update-signature.ts)), again right before installing;
- the app never installs on its own: the user chooses "Restart and update";
- every release also has `SHA256SUMS.txt` and a GitHub provenance attestation (`gh attestation verify <file> --repo salvatorestracquadanio86/micelio-second-brain`).

If the signing key is ever lost or compromised, a new key is added in a release signed with the old one, the old one is removed in a later release, and the change is announced in the release notes. If the old key can't be trusted any more, users are told to install the next version by hand.

## Known limitations

These are known and documented. Reports that only restate them aren't needed, but ideas to close them are welcome.

- **What a removed member already had stays theirs.** With full protection (since 0.7.0, on in new teams) a removed member is cut off from replication and the content key changes, so they neither receive nor read anything new; what was on their PC before can't be taken back. In teams created before 0.7.0 full protection is off until an admin turns it on: until then a removed member who keeps their data folder can keep replicating.
- **Metadata stays in clear inside the log.** Full protection encrypts the content (memories, gap questions, Root flag reasons, dream summaries) with the generation key; ids, kinds, authors, dates, votes, roles and member names stay readable to anyone holding the log key, because every node needs them to compute the same view. Only active members can replicate the log.
- **Redaction is best-effort.** A redacted memory disappears from every view, but the original encrypted block stays in its author's feed on every member, so a modified client can still read it.
- **Members are trusted colleagues.** Any member can archive, supersede or restore other people's memories (pinned memories and Roots excepted) and add writers without an invite (traced as invited by them). What a member writes reaches the other members' agents as context.
- **The DHT shows who is online.** Anyone who knows a team's topic can see the IP addresses of the members announcing it, but can't connect to the team's data.
- **Shared machines.** On macOS and Linux the data folder is readable only by its user, and every client checks that the daemon on the port knows the user's token before sending it (both since 0.6.2). A page of the desktop app that is already open keeps using the token it received at load time.
