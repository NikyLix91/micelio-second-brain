# Settings

The settings of **this PC**, saved in `config.json` (not replicated). Those shared by the team are on the Team page.

## Network {#network}

Chooses where team nodes meet: Holepunch's public DHT, the team's private DHT (bootstrap nodes, `host:port`) or **local only**, no network (see **On your own**). "Check" tests the choice without applying it; "Apply" saves and reconnects the node right away, with no restart and no data loss. Every member must use the same DHT. See **Network and replication**.

## Automatic collection {#watch}

The project folders where Claude Code sessions are collected (**opt-in**: outside these folders nothing is read). Subfolders count too. The desktop app has a folder picker.

## Document folders {#documents}

Watched folders for PDF, Office, Markdown and diagrams. For each: **originals downloadable** (colleagues can request the original file) and **Roots** (memories become Roots). See **Documents**.

## Intelligence (LLM) {#llm}

- **Adapter**: `claude` (the Claude Code CLI installed on the PC, with your subscription), `fake` (fake: for demos and tests only, it does not call Claude), `none` (no LLM: all doubtful cases go to the inbox). Changed in `config.json` (`llm.adapter`) with a daemon restart.
- **Models**: a fast one to classify (default Haiku) and a more capable one to distil (default Sonnet); from the dropdown Haiku, Sonnet, Opus or "Other…" with any name accepted by the CLI. Effective immediately.
- **Maximum calls per day** (default 300): beyond the limit work waits in the queue for the next day.

## Claude Code {#claude-code}

Registers Micelio as an **MCP server** of Claude Code (user level: valid in every project) and, if you want, the **hooks** in `~/.claude/settings.json`, saving a backup copy first. From the terminal: `micelio setup claude-code`. See **Agents and MCP**.

**How it works behind the scenes.** Micelio uses the `claude mcp add` command and looks for `claude` outside the PATH too: in the native install (`~/.local/bin`), in the npm one (it runs its `cli.js` with its own Node, because `claude.cmd` can't be started without a shell), in WinGet and inside the Claude Code extension for VS Code, Cursor and Windsurf (the most recent version). If it can't find it anywhere, it writes the same entry directly into `~/.claude.json` (or into the `CLAUDE_CONFIG_DIR` folder), after saving a copy as `.claude.json.micelio-backup`: for Claude Code the result is identical. The message after the click says which way it went. The same executable is also used for distillation (Intelligence).

**After registering** close and reopen your Claude Code sessions (or reload the VS Code window): Claude Code reads MCP servers only at startup.

**One user, one configuration.** Claude Code reads its configuration from the profile of the system user running it. If you start it with a different user from the one Micelio runs as (for example Claude Code installed and used by an admin account because of company policy), it will never see Micelio, and Micelio won't be able to read its sessions. Micelio notices when there's no trace of Claude Code in this profile (neither sessions nor the fields Claude Code writes on first start) and shows a warning. The fix is to open Micelio with the same user you use Claude Code with (right click → "Run as different user"), join the team with an invite and run the setup again.

## About {#about}

App version, author and license, with links to the source code, the license text and the contribution guide.

Micelio is **free software** under the **GNU AGPL-3.0** license: you can use it for free, also at work, study it, modify it and redistribute it. One condition only: if you distribute a modified version, or offer it to others as a network service, you must make its source code available under the same license. Using and modifying it only internally creates no obligation.

**How it works behind the scenes.** The version number comes from `package.json` and is written into the UI at build time. The full license text is also in the installation folder (`LICENSE.txt`). Links open in the system browser, not inside the app.

## The configuration file {#config-file}

`config.json` applies to the whole machine: port and interface of the local API (default `127.0.0.1:7337`), the access **token**, the LLM, the embedding model and the default team. Treat it as private: the token gives access to your node.

Each team then has its own `teams/<id>/settings.json`: enabled folders, session collection thresholds (`watch.sessionScan`), git summary (`watch.gitChanges`), network and dreaming hour. The cards of this page show the settings of the team chosen in the sidebar; LLM and port are shared by all teams.
