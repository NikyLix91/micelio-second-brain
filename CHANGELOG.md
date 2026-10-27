# Changelog

All notable changes to Micelio. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). Before 1.0, minor versions may add features and patch versions only fix bugs. The detailed history, with the reasons behind every decision, is in the [work plan](docs/en/PLAN.md#log).

## [Unreleased]

### Added

- Continuous integration with GitHub Actions: typecheck, build and tests on Linux, Windows and macOS for every push and pull request, team server build, dependency review on pull requests, CodeQL security analysis, Dependabot for actions and npm dependencies. Actions are pinned to commit SHAs.
- Releases built by GitHub Actions from a `v*` tag on `main`: Windows installer, AppImage and `.deb`, with `SHA256SUMS.txt` and a provenance attestation for every package, published as a draft with the notes from this file. `npm run version:set X.Y.Z` aligns the versions and closes the Unreleased section.

### Fixed

- Sidebar: a long node name (e.g. `name.surname`) no longer pushes the IT/EN language selector out of view; it is shortened with an ellipsis and shown in full on hover.

### Security

- Desktop app on **Electron 44** (was 38, no longer supported): includes the fix for [GHSA-jr5w-w6x2-84p9](https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9) and the later Chromium security fixes.
- Daemon dependencies: `body-parser` 2.4.0 and `multer` 2.5.0 (denial of service on crafted requests), `fast-uri` 3.1.9. The daemon only listens on 127.0.0.1 and requires the token, so the exposure was limited to programs already running on the PC.

## [0.7.0] - 2026-10-26

### Security
- **Full protection** for teams: closes the main known limitation, removed members still reading new memories.
  - **Only active members receive the team's data:** on every connection the peer proves, with its feed's key and bound to that session, to be an active member; nodes replicate only after the proof and cut off whoever gets removed.
  - **Content is encrypted with a per-generation key:** memories (title, body, tags, source), gap questions, Root flag reasons and dream summaries. Every active member gets the key encrypted with their own public key; the key changes by itself when an admin removes someone, so whoever left can't read new content even if a member passes them the data. Newcomers read the whole history through the key chain.
  - On in new teams. In existing teams an admin turns it on from Team → Full protection once every member runs 0.7.0 (the card shows everyone's version); it can't be turned off. Admins can also change the key by hand, for example after a lost PC.

## [0.6.2] - 2026-10-26

### Security
Fixes from the security review done before publishing the repository. None of them lets someone outside a team get in: they need a team member, an ex-member, a leaked invite code or another user of the same PC.
- A memory "from a document" with a crafted reference could make a colleague's Micelio read any file of their PC (for example an SSH key) and hand it to their agent. The reference must now be the document's SHA-256 hash.
- The team keys were handed to a joining node even when its entry was then rejected (for example a key already used by a member), creating a reader who doesn't appear among the members. They are now handed over only after the entry is accepted. A malformed join request no longer crashes the daemon.
- A folder that isn't enabled in any team no longer receives the default team's memory: no automatic context, and the read tools (`recall`, `get`, `architecture`, `fetch_source`, Inbox) reply with an explanation. An untrusted repository could push the agent to read the memory and send it out. `remember` still works and goes to the Inbox.
- The original of a document is accepted only from its author, who now signs the answer: any peer connected to the topic could answer first and make the download fail. Older versions can't serve originals to 0.6.2 until they update.
- **Roots for admins only:** a new team setting, on for new teams, lets only admins create and remove Roots. Roots reach everyone's agents as rules and end up in the colleagues' CLAUDE.md files, so any member could use them to instruct the others' agents. The rule is enforced by every node on the replicated log; in existing teams an admin turns it on in Team → Team settings.
- **The daemon proves it is yours** before the CLI, the hooks, the MCP shim or the app send it the token (an HMAC of a random number, keyed with the token). On a PC with several users, another user could occupy the port while your daemon was off and receive the token.
- **Random relay key on the team server:** the relay key was derived from the server address, so anyone could compute the secret key and run a fake relay (no reading, but denial of service and who-talks-to-whom). The server now generates a random seed at installation and prints the address for the PCs as `host:port#key`; it keeps answering on the old key for PCs not yet updated until `MICELIO_SERVER_RELAY_LEGACY=0`. Reinstall the server with the new `install.sh`.
- On macOS and Linux the data folder (`~/.micelio`) is now readable only by its user, also for existing installations.

### Fixed
- The Windows installer couldn't close Micelio ("Micelio is running" kept coming back): Claude Code's hooks and MCP shim restarted the daemon from the installation folder as soon as it was closed. The installer now marks the installation as in progress (hooks and shim don't restart the daemon meanwhile), stops the daemon in an orderly way, closes every Micelio process and retries; it asks to close Micelio by hand only if something still resists.

### Documentation
- `SECURITY.md` lists the known limitations, starting with removed members still being able to read new memories until key rotation arrives.
- The Docker image docs recommend publishing the API only on `127.0.0.1`.

## [0.6.1] - 2026-10-24

### Fixed
- Memories saved by Claude Code could still end up in the default team: installations configured before 0.5.1 kept the old HTTP registration, which doesn't say which folder the session comes from, and updating the app didn't change it. The daemon now migrates the old registrations to the stdio shim at startup (with a backup of `~/.claude.json`), and Settings reminds you to reopen the sessions already open.

### Added
- **Team check on `remember`:** a memory saved by an agent is published only if the session's folder is enabled in the team it's saved to. Otherwise it goes to the Inbox with the problem and the proposed fix, and the agent says so. **Publish to…** in the Inbox moves it to the right team and publishes it there.
- Published under the GNU AGPL-3.0 license, with Contributor License Agreement, contribution guide, security policy and code of conduct.
- Settings → About: version, license and links to the source code.

### Changed
- "Connect Claude Code" next to a folder registers the stdio shim for that folder; it no longer pins a team, the folder decides.

### Removed
- The Phase 0 spike code (still in the git history, branch `phase-0-spikes`).

## [0.6.0] - 2026-10-22

Memory that learns from use.

### Added
- **Habituation:** memories handed to the agent several times without helping go down, fully in the automatic context and by half in searches; a useful outcome brings them back. Pinned memories are exempt.
- **Use synapses:** memories that help in the same sessions become linked for the whole team; a search that finds one brings the other along.
- **Hard-won discoveries:** memories born from long sessions with many errors get more weight.
- **Redaction receipt:** every PC confirms it removed a redacted memory (chat answers, Inbox, personal copies), with an Ed25519 signature; the receipt can be exported as text or verifiable JSON.

## [0.5.3] - 2026-10-22

### Fixed
- "Connect Claude Code" works with every installation (native, npm, WinGet, editor extensions); if the `claude` command can't be found, the configuration is written directly. Warning when Claude Code runs under a different user.

## [0.5.2] - 2026-10-21

### Fixed
- The daemon took up to 55 seconds to start with very large session transcripts: they are now read in a worker, after startup.

## [0.5.1] - 2026-10-21

### Fixed
- The user-scope MCP always worked on the default team: memories saved from a project could end up in the wrong team. The MCP is now a stdio shim that sends the project folder, and the daemon picks the team that owns it.

## [0.5.0] - 2026-10-20

### Added
- **Ask:** chat over the team memory, with answers grounded only on memories, clickable references and a mind map of the knowledge.

## [0.4.1] - 2026-10-21

### Fixed
- Linux: the desktop app runs natively on Wayland when available. Contributed by Federico Partesano.

## [0.4.0] - 2026-10-20

### Added
- Encrypted team backups and restore, with daily automatic backups.
- Relay on the team server for networks that block hole punching.
- **Effectiveness** page: how often memories reach the agents and how often they help.
- Linux packages (AppImage and `.deb`).

## [0.3.2] - 2026-10-18

### Fixed
- Nucleus with filters and tour, 2D Map detail off-screen, off-topic automatic context.

## [0.3.1] - 2026-10-18

### Fixed
- Nucleus with many Roots, import from Obsidian vaults, off-topic automatic context.

## [0.3.0] - 2026-10-18

### Added
- Windows installer, English interface, in-app help, multiple teams on the same PC, automatic context for agents, Roots (foundational knowledge), secret redaction, galaxies for large teams.

## [0.1.0] - 2026-10-17

### Added
- First version: P2P team, memories, hybrid search, MCP for Claude Code, automatic collection with privacy filter and Inbox, document folders, priority and dreaming, desktop app with the 3D Nucleus.

[Unreleased]: https://github.com/salvatorestracquadanio86/micelio-second-brain/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/salvatorestracquadanio86/micelio-second-brain/releases/tag/v0.7.0
[0.6.2]: https://github.com/salvatorestracquadanio86/micelio-second-brain/releases/tag/v0.6.2
[0.6.1]: https://github.com/salvatorestracquadanio86/micelio-second-brain/releases/tag/v0.6.1
[0.6.0]: https://github.com/salvatorestracquadanio86/micelio-second-brain/releases/tag/v0.6.0
