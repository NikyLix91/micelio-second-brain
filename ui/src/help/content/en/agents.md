# Agents and MCP

AI agents (Claude Code, Codex, VS Code, WebStorm…) use Micelio through **MCP** (*Model Context Protocol*), the standard with which an agent discovers and calls external tools. Micelio installs no agents of its own.

## How an agent connects {#mcp}

The daemon exposes an MCP server at `http://127.0.0.1:7337/mcp`, protected by the token. `micelio setup claude-code` (or the button in Settings) registers it at **user level** (with `claude mcp add`, found even outside the PATH, or by writing `~/.claude.json` directly: see **Settings**): from then on every Claude Code session, in any folder, sees Micelio's tools. For clients that use MCP through a process there is the `micelio mcp` shim; `micelio setup codex|vscode|webstorm` prints the configuration to paste.

With several teams, Claude Code's MCP picks the team from the project folder: the team that enabled it. From a folder that is in no team the agent doesn't read the memory (see below). Every `remember` reply says which team the memory went to. See **Several teams**.

## The team check of `remember` {#team-check}

A memory saved by an agent is **published only if the session's folder is enabled in the team it's being saved to**. Micelio compares it every time with the enabled folders of all teams. If it doesn't match, the memory isn't published but goes to the **Inbox**, with the problem and the proposed fix, and the agent tells you. There are three cases:

- **the folder belongs to another team** (for example an old registration tied to a team): the memory goes to the Inbox of the folder's team, where approving publishes it there;
- **the folder isn't enabled in any team**: it goes to the session team's Inbox; enable the folder in the right team and publish it there with "Publish to…";
- **the session doesn't say which folder it comes from** (old HTTP registration or a client other than the shim): same thing, and the fix is "Configure" in Settings → Claude Code and reopening the sessions.

**How it works behind the scenes.** The `micelio mcp` shim sends the session's folder (`CLAUDE_PROJECT_DIR`, otherwise the working folder) on every request in the `x-micelio-cwd` header. The daemon looks for the team with the most specific enabled folder containing it, the same rule as session collection. A held memory still goes through the filter and classification: if it's private it stays private. Born from a real bug: a session opened before its folder was enabled was saving into the default team.

## A folder outside every team doesn't read the memory {#locked}

From a folder that **isn't enabled in any team** the agent gets nothing from Micelio: neither the automatic context at session start and on every request, nor the answers of `recall`, `get`, `architecture`, `fetch_source`, the Inbox and the other read tools. Instead the agent gets a message explaining why and how to enable the folder. The same applies when the session doesn't say which folder it comes from. `remember` keeps working: the memory goes to the Inbox, never published.

**Why.** An untrusted repository, for example one cloned from the internet, can contain a `CLAUDE.md` or comments written to push the agent to search the memory and send out what it finds. Before 0.6.2 a folder outside the teams received the default team's knowledge; now a team's memory reaches only the folders that team has enabled.

**How it works behind the scenes.** The team is chosen on every request from the session's folder (the shim's `x-micelio-cwd` header): as soon as you enable the folder in Settings → Automatic collection the tools answer, without reopening the session. A registration tied to a specific team (`micelio --team <team> mcp` or `/mcp/<team>`) is an explicit choice of whoever configures the PC and keeps reading that team.

## The registration updates itself {#migration}

Up to 0.5.0 Claude Code was connected to the `/mcp` HTTP endpoint, which doesn't say the folder. At startup the daemon looks in `~/.claude.json` for the old registrations pointing to it (the user one and the per-folder `/mcp/<team>` ones) and replaces them with the shim, first saving a copy in `.claude.json.micelio-backup`. Entries of other servers or other daemons are left alone. Claude Code reads the registration only when a session starts: the ones already open must be closed and reopened (`/resume` works too). Settings → Claude Code reminds you with a warning.

## The tools {#tools}

| Tool | What it does |
|---|---|
| `recall` | hybrid search in the team knowledge, with the **related Roots** appended |
| `remember` | proposes a memory (goes through filter and classification) and answers with the saved text |
| `architecture` | the Roots of a project, of a category or of the files touched |
| `get` | a full memory, with all the code references |
| `vote` | flags a memory as useful or misleading |
| `mark_root` | promotes a memory to Root (only on explicit request) |
| `fetch_source` | downloads the original of a memory born from a document |
| `inbox_review`, `inbox_decide` | shows the inbox and applies the user's decision |

## The instructions {#instructions}

The server sends **instructions** to the agent, which enter its context: search with `recall` at the start of a non-trivial task, call `architecture` before touching the architecture, save only on request and only technical knowledge, never personal data or secrets, write only what was said or shown. The agent decides when to use the tools: use is recommended, not forced. To force it, Claude Code hooks can be used (e.g. injecting the project's Roots at session start).

## Automatic collection {#hook}

Separate from MCP: the `SessionEnd` hook notifies the daemon at the end of a session, and the scanner collects long sessions. See **Collection and distillation**. The `SessionStart` and `UserPromptSubmit` hooks instead bring knowledge to the agent without it asking: see **Automatic context**.

## Security {#security}

The MCP server answers only on 127.0.0.1 and only with the token. A folder outside every team doesn't read the memory (see above). Micelio's own calls to Claude run with a variable that excludes them from collection: a distillation is not distilled in turn.
