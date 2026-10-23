# Changelog

All notable changes to Micelio. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). Before 1.0, minor versions may add features and patch versions only fix bugs. The detailed history, with the reasons behind every decision, is in the [work plan](docs/en/PLAN.md#log).

## [Unreleased]

### Added
- Published under the GNU AGPL-3.0 license, with Contributor License Agreement, contribution guide, security policy and code of conduct.
- Settings → About: version, license and links to the source code.

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

[Unreleased]: https://github.com/salvatorestracquadanio86/micelio-brain/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/salvatorestracquadanio86/micelio-brain/releases/tag/v0.6.0
