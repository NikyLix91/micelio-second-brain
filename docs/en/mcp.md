[Italiano](../mcp.md) | **English**

# MCP server

The daemon exposes an MCP server over **Streamable HTTP**:

- URL: `http://127.0.0.1:7337/mcp` (port configurable in `~/.micelio/config.json`)
- Authentication: `Authorization: Bearer <token>` header, with the token taken from `~/.micelio/config.json`
- **Stateless** mode: each request is independent, with no sessions or SSE streams

The server sends **instructions** to the agents:
- search with `recall` before non-trivial tasks;
- save with `remember` only when the user asks, only reusable technical knowledge and **without adding details** that weren't said;
- show the user the saved text;
- never save personal data, HR matters, credentials or customer data.

## Tools

| Tool | Parameters | Effect |
|---|---|---|
| `recall` | `query` (keywords), `limit?` (1–20, default 5) | Full-text search in the team memory, ranked by relevance (BM25: the title weighs more than the tags, the tags more than the body). Ignores accents and accepts prefixes. Read-only |
| `remember` | `title`, `body` (Markdown), `kind?`, `tags?` | **Proposes** a memory. It goes through the privacy filter and the classification, then replies with the outcome: *Published* (with the exact saved text), *in inbox* (with the id and the reason) or *kept as private* (with the reason) |
| `get` | `id` (also abbreviated, min 6 characters) | Full memory, with all the code references (project, branch, files, symbols, commits). Read-only |
| `architecture` | `project?`, `category?`, `files?`, `query?` | The **Roots** (foundational knowledge): by project (name of the repository folder), category, files being touched (a folder works too), or ranked by relevance. Without project Roots it returns the team's general ones. Roots "to review" are flagged with the reasons. Read-only |
| `mark_root` | `id`, `category` | Promotes a memory to Root. Only on the user's explicit request |
| `vote` | `id`, `useful` (true/false) | Reports whether a memory was useful or is misleading/obsolete. Votes raise or lower the memory's activation for the whole team |
| `fetch_source` | memory `id` | For a memory distilled from a document, downloads the **original** from the colleague who has it (they must be online and sharing the folder). Returns the local path and the extracted text (first 20,000 characters) |
| `inbox_review` | none | Lists the doubtful memories awaiting a decision in the user's local inbox. Read-only |
| `inbox_decide` | `id`, `decision` (`approve` \| `reject`), `title?`, `body?` | Approves (publishes, optionally with corrections) or rejects. To be used **only after an explicit decision by the user** |

Since Phase 5 `recall` is a **hybrid search**:
- it combines keywords (BM25) and meaning (local, multilingual embeddings: a question in English finds memories in Italian);
- it merges the two rankings with Reciprocal Rank Fusion;
- at equal relevance it favors memories with higher activation, that is recently used, voted useful, highly connected or pinned.

Every returned result counts as a "use" of the memory.

**Roots (Phase 8).** At the end of the `recall` results come up to 3 **relevant Roots** that aren't already among the results, in the "RADICI PERTINENTI" section. This way the foundational knowledge reaches the agent even when the question doesn't mention it. The server instructions ask the agent to call `architecture` before designing or changing a part of the architecture.

## Client configuration

### Claude Code

```bash
micelio setup claude-code            # MCP (user scope) + end-of-session hook
micelio setup claude-code --no-hook  # MCP only
micelio setup claude-code --print    # shows what it would do, without changing anything
```

The command runs `claude mcp add --transport http --scope user micelio http://127.0.0.1:7337/mcp --header "Authorization: Bearer <token>"`. Then, unless `--no-hook` is given, it adds to `~/.claude/settings.json` (honoring `CLAUDE_CONFIG_DIR`) a `SessionEnd` hook that notifies the daemon at the end of every session. The original file is saved as `settings.json.micelio-backup`. Running the command again is safe: it replaces the previous configuration instead of duplicating it.

For temporary use, without changing the configuration:

```bash
claude --mcp-config '{"mcpServers":{"micelio":{"type":"http","url":"http://127.0.0.1:7337/mcp","headers":{"Authorization":"Bearer <token>"}}}}'
```

### Other clients (Codex CLI, VS Code, WebStorm)

For clients that launch MCP servers as a **process** (stdio), Micelio has a shim: `micelio mcp`. It exposes the same tools as the daemon over stdio and forwards each request to the local HTTP endpoint, so the daemon must be running.

`micelio setup` prints a ready-made configuration, with your machine's paths, to paste into the client:

```bash
micelio setup codex      # block for ~/.codex/config.toml
micelio setup vscode     # block for .vscode/mcp.json or user settings
micelio setup webstorm   # JSON for AI Assistant → Model Context Protocol (other JetBrains IDEs too)
```

For these clients Micelio doesn't change the configuration files: their formats change often from one version to the next. The shim is verified with a real stdio MCP client. The three configurations follow the formats documented by the respective clients, but they haven't been tried inside Codex, VS Code and WebStorm, which weren't available.

Clients that support MCP over HTTP can also connect directly to the daemon URL with the token header.

## Security

- The daemon listens only on `127.0.0.1`, unless `MICELIO_HOST` is set (e.g. in containers).
- Without a valid token all routes respond `401`, except `/api/health`.
- The authentication header also prevents a web page open in the browser from using the local daemon.
- Whoever has the token can read and write the team memory **from that machine**: the `config.json` file must be protected like a credential.

## Multiple teams on the same PC

With multiple teams (see the [user guide](user-guide.md#4-ter-several-teams-on-the-same-pc)):

- `http://127.0.0.1:7337/mcp` works on the **default team** (`micelio teams default <team>`);
- `http://127.0.0.1:7337/mcp/<team>` works on the given team, by local id or by name.

To make Claude Code use a specific team in a project:

```bash
micelio --team "Cliente X" setup claude-code --project C:\progetti\cliente-x
```

The command runs, in the project folder, `claude mcp add --transport http --scope local micelio http://127.0.0.1:7337/mcp/<id> --header "Authorization: Bearer <token>"`. The *local* scope applies only when Claude Code is started in that folder, takes precedence over the user registration and stays in `~/.claude.json`: the token doesn't end up in the repository. The "Connect Claude Code" button next to a folder in Settings does the same.

For clients that use the shim: `micelio --team <team> setup codex|vscode|webstorm` prints a configuration that passes `--team` to the shim.

## Personal memories, code changed, automatic context (B4)

- `remember` accepts `personal: true`: the memory stays only on the user's PC (the agent uses it when the user asks to remember something "for themselves").
- In the `recall` and `get` results a personal memory is marked `PERSONALE`, and one whose cited code changed after it was written `⚠ CODICE CAMBIATO` (with the number of commits and of missing files): the server instructions ask the agent to verify against the current code.
- Automatic context doesn't go through MCP: it is Claude Code's `SessionStart` and `UserPromptSubmit` hooks (`micelio hook session-start` / `prompt`) that ask the daemon for the context (`POST /api/context`) and return it as `additionalContext`. See the "Automatic context" entry in the in-app help.
