# How Micelio works

Micelio is the **shared memory of the development team**: it collects the knowledge born while working (sessions with AI assistants, documents, notes), cleans it, distils it into short **memories** and makes it available to every colleague and their AI agents. There is no central server: every team PC holds a complete, encrypted copy of the knowledge.

## The pieces {#pieces}

| Piece | What it is | Where it runs |
|---|---|---|
| **Daemon** | The process that does everything: P2P network, collection, privacy filter, distillation, search, local API | In the background on your PC (`micelio start`, or at login with `micelio autostart on`) |
| **App** | This interface: watches and controls the daemon | Desktop window (Electron) or browser at `http://127.0.0.1:7337/ui` |
| **AI agents** | Claude Code, Codex, VS Code, WebStorm… | They query the daemon with the **MCP** protocol and receive the relevant memories |
| **CLI** | The `micelio` command | Terminal: everything the app does, plus administration |

The daemon listens **on this PC only** (127.0.0.1) and answers only those who have the **token** saved in `config.json`: the desktop app reads it by itself, the browser gets it through `micelio ui`.

## From work to colleague: the journey of a memory {#flow}

1. **Collection.** At the end of a Claude Code session (or every 15 minutes for long sessions) the daemon reads the transcript; from document folders it reads new or changed files.
2. **Privacy filter, on your PC.** HR and personal topics → the content stays private. Secrets and personal data → replaced by placeholders. Sensitive files (`.env`, keys) → removed entirely.
3. **Classification and distillation.** Claude, through the CLI of your subscription (no API key), decides whether the content is knowledge useful to the team and extracts a few atomic memories from it.
4. **Publication.** Each memory becomes a signed **event** appended to *your* log (a Hypercore feed), encrypted with the team key.
5. **Replication.** Online colleagues' PCs download your log directly from yours (encrypted P2P connection) and merge it with theirs.
6. **Use.** The memory enters the search index of every PC: the next time a colleague (or their agent) searches that topic, they find it.

## Privacy first {#privacy-first}

Everything sensitive is stopped or cleaned **before** any call to an AI: the filter is deterministic and runs locally. Doubtful cases are never published on their own: they go to your **Inbox**. What did not reach the team, and why, stays in the **Private log**, which never leaves the PC.

## Where to go next {#next}

- Where data physically lives: topic **Where the data is**.
- How PCs connect: **Network and replication**.
- How a memory is born, in detail: **Collection and distillation**.
- Knowledge that is never forgotten: **Roots**.
