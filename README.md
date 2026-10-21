[Italiano](README.it.md) | **English**

# Micelio

**A distributed, peer-to-peer second brain for a development team's AI tools.**

Every machine in the team runs a Micelio node. The nodes find each other on the internet by themselves and exchange the team's knowledge without any central server. Once synchronized, **every node holds 100% of the shared knowledge**. AI assistants (Claude Code, and in the future Codex, VS Code and WebStorm) read and write this memory through **MCP**.

```
 Alice's PC             Bob's PC              "Always-on" container
┌───────────┐  P2P   ┌───────────┐   P2P    ┌───────────┐
│  micelio  │◀──────▶│  micelio  │◀────────▶│  micelio  │
└─────▲─────┘        └─────▲─────┘          └───────────┘
      │ MCP                │ MCP
  Claude Code          Claude Code
```

> Status: **Phase 3 complete**: P2P team, search, MCP for Claude Code, automatic collection with privacy filter and inbox, **desktop app** with the 3D Nucleus. The plan is in [docs/en/PLAN.md](docs/en/PLAN.md).

![The Nucleus: the team's knowledge as a 3D hologram](docs/img/nucleo.png)

## Quick start

```bash
npm ci && npm run build && npm link     # makes the `micelio` command available
npm run desktop                         # desktop app (also starts the daemon)
npm run demo                            # or: demo team with 3 nodes and ~50 memories

micelio start                           # starts the local daemon
micelio init "Team Dev" --name mio-pc   # creates a team (first node only)
micelio invite                          # generates a code for a colleague
micelio setup claude-code               # connects Claude Code via MCP
```

The colleague, on their machine:

```bash
micelio start
micelio join <codice> --name suo-pc
micelio setup claude-code
```

From then on, in Claude Code: *"search the team memory for how we solve X"* or *"save this decision in the team memory"*.

## Documentation

| Document | For whom |
|---|---|
| [User guide](docs/en/user-guide.md) | Micelio users: installation, team, invites, memories, Claude Code |
| [Desktop app and interface](docs/en/app.md) | The 3D Nucleus, the views, the notifications, the demo team |
| [MCP server](docs/en/mcp.md) | Tools exposed to AI agents and client configuration |
| [Developer guide](docs/en/development.md) | Those working on the code: structure, build, tests, conventions |
| [Design](docs/en/DESIGN.md) | Architecture and decisions |
| [Work plan](docs/en/PLAN.md) | Phase status and next steps |
| [Phase 0 spike](docs/en/phase-0-spike.md) | Experiments that validated the technical choices |

## Requirements

Node.js ≥ 22.13 on Windows, macOS or Linux. Docker is only needed for the end-to-end tests.
