# Agents and MCP

AI agents (Claude Code, Codex, VS Code, WebStorm…) use Micelio through **MCP** (*Model Context Protocol*), the standard with which an agent discovers and calls external tools. Micelio installs no agents of its own.

## How an agent connects {#mcp}

The daemon exposes an MCP server at `http://127.0.0.1:7337/mcp`, protected by the token. `micelio setup claude-code` (or the button in Settings) registers it with `claude mcp add` at **user level**: from then on every Claude Code session, in any folder, sees Micelio's tools. For clients that use MCP through a process there is the `micelio mcp` shim; `micelio setup codex|vscode|webstorm` prints the configuration to paste.

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

Separate from MCP: the `SessionEnd` hook notifies the daemon at the end of a session, and the scanner collects long sessions. See **Collection and distillation**.

## Security {#security}

The MCP server answers only on 127.0.0.1 and only with the token. Micelio's own calls to Claude run with a variable that excludes them from collection: a distillation is not distilled in turn.
