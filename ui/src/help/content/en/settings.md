# Settings

The settings of **this PC**, saved in `config.json` (not replicated). Those shared by the team are on the Team page.

## Network {#network}

Chooses where team nodes meet: Holepunch's public DHT or the team's private DHT (bootstrap nodes, `host:port`). "Check" tests the choice without applying it; "Apply" saves and reconnects the node right away, with no restart and no data loss. Every member must use the same DHT. See **Network and replication**.

## Automatic collection {#watch}

The project folders where Claude Code sessions are collected (**opt-in**: outside these folders nothing is read). Subfolders count too. The desktop app has a folder picker.

## Document folders {#documents}

Watched folders for PDF, Office, Markdown and diagrams. For each: **originals downloadable** (colleagues can request the original file) and **Roots** (memories become Roots). See **Documents**.

## Intelligence (LLM) {#llm}

- **Adapter**: `claude` (the Claude Code CLI installed on the PC, with your subscription), `fake` (fake: for demos and tests only, it does not call Claude), `none` (no LLM: all doubtful cases go to the inbox). Changed in `config.json` (`llm.adapter`) with a daemon restart.
- **Models**: a fast one to classify (default Haiku) and a more capable one to distil (default Sonnet); from the dropdown Haiku, Sonnet, Opus or "Other…" with any name accepted by the CLI. Effective immediately.
- **Maximum calls per day** (default 300): beyond the limit work waits in the queue for the next day.

## Claude Code {#claude-code}

Registers Micelio as an **MCP server** of Claude Code (with `claude mcp add`, user level: valid in every project) and, if you want, the end-of-session **hook** in `~/.claude/settings.json`, saving a backup copy first. From the terminal: `micelio setup claude-code`. See **Agents and MCP**.

## The configuration file {#config-file}

`config.json` also holds the port and interface of the local API (default `127.0.0.1:7337`), the access **token**, the session collection thresholds (`watch.sessionScan`), the git summary (`watch.gitChanges`), the embedding model and the dreaming hour. Treat it as private: the token gives access to your node.
