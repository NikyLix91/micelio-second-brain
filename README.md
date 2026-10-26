[Italiano](README.it.md) | **English**

# Micelio

**A distributed, peer-to-peer second brain for a development team's AI tools.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-0.7.0-green.svg)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)

Every developer's AI assistant learns something in every session: how a flaky test was fixed, why a library was chosen, which endpoint has a gotcha. Then the session ends and that knowledge is gone. The next colleague, or the next session, starts from zero.

Micelio keeps it. Each PC in the team runs a Micelio node: it distills what the AI sessions discovered into short **memories**, filters out anything private, and shares them with the rest of the team **directly between PCs**, with no central server and no cloud. Assistants such as Claude Code read and write this memory through **MCP**, and get the relevant memories automatically at the start of each request.

```
 Alice's PC             Bob's PC              Always-on node (optional)
┌───────────┐  P2P   ┌───────────┐   P2P    ┌───────────┐
│  micelio  │◀──────▶│  micelio  │◀────────▶│  micelio  │
└─────▲─────┘        └─────▲─────┘          └───────────┘
      │ MCP                │ MCP
  Claude Code          Claude Code
```

![The Nucleus: the team's knowledge as a 3D hologram](docs/img/nucleo.png)

## Features

- **Peer-to-peer, no server.** Built on the [Holepunch](https://holepunch.to) stack (Hyperswarm, Autobase, Hyperbee). Once synchronized every node holds all the shared knowledge and works offline. An optional team server can host a private DHT and a relay.
- **Automatic collection.** Claude Code sessions in the folders you enable are distilled into memories (solutions, decisions, gotchas, procedures), with code references to files, symbols and commits.
- **Privacy first.** A local filter keeps personal data, HR matters, secrets and customer data on your PC; doubtful cases go to your Inbox for review. Secrets are redacted before anything leaves the machine.
- **Context for agents.** MCP tools (`recall`, `remember`, `architecture`, ...) plus hooks that inject the team's foundational knowledge (**Roots**) and the most relevant memories into every prompt.
- **Memory that learns from use.** Memories that help rise, those that keep being ignored fade, memories that help together become linked, and hard-won discoveries weigh more.
- **Dreaming.** Periodic consolidation merges duplicates, marks superseded memories and links related ones.
- **Desktop app.** A 3D Nucleus and a 2D map of the knowledge, chat over the memory with a mind map, Inbox, effectiveness metrics, backups, redaction with signed receipts, multiple teams on the same PC. Interface and in-app help in English and Italian.
- **Uses your own subscription.** Distillation runs through the Claude Code CLI already on your PC: no API keys.

## Install

**Windows:** download `Micelio-Setup-<version>.exe` from the [Releases](https://github.com/salvatorestracquadanio86/micelio-second-brain/releases) page. It installs for the current user, with no administrator rights.

**Linux:** AppImage and `.deb` packages are on the same page.

**From source** (Windows, macOS, Linux; Node.js ≥ 22.13):

```bash
npm ci && npm run build && npm link     # makes the `micelio` command available
npm run desktop                         # desktop app (also starts the daemon)
npm run demo                            # or: a demo team with 3 nodes and ~50 memories
```

## Quick start

```bash
micelio start                           # starts the local daemon
micelio init "Team Dev" --name my-pc    # creates a team (first node only)
micelio invite                          # generates a code for a colleague
micelio setup claude-code               # connects Claude Code via MCP
```

The colleague, on their machine:

```bash
micelio start
micelio join <code> --name their-pc
micelio setup claude-code
```

Everything is also available from the desktop app. From then on, in Claude Code: *"search the team memory for how we solve X"* or *"save this decision in the team memory"*.

## Documentation

| Document | For whom |
|---|---|
| [User guide](docs/en/user-guide.md) | Micelio users: installation, team, invites, memories, Claude Code |
| [Desktop app and interface](docs/en/app.md) | The 3D Nucleus, the views, the notifications, the demo team |
| [MCP server](docs/en/mcp.md) | Tools exposed to AI agents and client configuration |
| [Team server](server/README.md) | Private DHT and relay on a Linux machine |
| [Developer guide](docs/en/development.md) | Those working on the code: structure, build, tests, conventions |
| [Design](docs/en/DESIGN.md) | Architecture and decisions |
| [Work plan](docs/en/PLAN.md) | Phase status and next steps |
| [Changelog](CHANGELOG.md) | What changed in each version |

## Status

Micelio is young (first version October 2026) and used daily by a few development teams. The data format is stable and every change is migrated automatically, but expect rough edges. Bug reports are very welcome.

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Before your first pull request is merged you'll be asked to accept the [Contributor License Agreement](CLA.md), with one click. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

Copyright © 2026 Salvatore Stracquadanio.

Micelio is free software: you can redistribute it and/or modify it under the terms of the [GNU Affero General Public License v3.0](LICENSE). In short: you can use it for free, also at work, and modify it; if you distribute a modified version or offer it as a network service, you must publish its source code under the same license.
