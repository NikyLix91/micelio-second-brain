# Command line

The `micelio` command does everything the app does, and a bit more. `micelio --help` and `micelio <command> --help` list options and subcommands. `--home <folder>` uses a node other than `~/.micelio`. With the Windows installer the command lives in `resources\bin` of the installation folder, added to the user's PATH: it works from any terminal opened after the installation.

## The daemon {#daemon}

| Command | Effect |
|---|---|
| `micelio start` / `stop` / `status` | start in the background, stop, show the status |
| `micelio autostart on` / `off` | automatic start at login (Windows, macOS, Linux) |
| `micelio ui` | opens the app in the browser with a one-time link |

## Team and network {#team}

| Command | Effect |
|---|---|
| `micelio init <team>` | creates a team (added to the ones already there) |
| `micelio invite` · `micelio join <code>` | invite · join a team |
| `micelio teams` · `teams default <team>` · `teams leave <team>` | the teams of the PC, the default one, removing a team |
| `micelio backup create [--out <folder>]` · `backup restore <file> [--new-team [name]]` · `backup auto [on\|off] [--folder <folder>] [--keep <n>]` | backup of the team knowledge, restore, automatic backups (password asked without showing it, or `MICELIO_BACKUP_PASSWORD`) |
| `micelio --team <team> <command>` | any command on a team other than the default |
| `micelio members` | members and roles |
| `micelio team config <key> <value>` | team setting (admin), e.g. `distill.maxMemories 8` |
| `micelio network` · `set` · `public` · `private` · `check` | DHT in use, change, diagnosis |

## Knowledge {#memory}

| Command | Effect |
|---|---|
| `micelio remember "<title>" -b "<text>"` | proposes a memory |
| `micelio recall "<words>"` · `micelio get <id>` | search · read |
| `micelio vote <id> up\|down\|clear` · `pin` / `unpin <id>` | priority signals |
| `micelio roots` · `add` · `remove` · `confirm` · `review` · `suggested` | Roots |
| `micelio dream now` · `dream log` · `archive` · `restore <id>` | dreaming and archive |
| `micelio quality` | distillation quality |
| `micelio remember … --personal` · `micelio personal` | personal memories (only on this PC) |
| `micelio stale [--check]` | memories with changed code |
| `micelio gaps` · `gaps mine` · `gaps report` · `gaps close` · `micelio digest` | gaps and digest |
| `micelio roots export <folder>` · `roots import <path>` | Roots in agent files · import |

## Collection {#collection}

| Command | Effect |
|---|---|
| `micelio setup claude-code` | registers MCP and the hook in Claude Code |
| `micelio watch add <folder>` | enables session collection |
| `micelio docs add <folder> [--shareable] [--roots]` | document folder |
| `micelio ingest status` · `scan` · `run` | queue status, scan, processing |
| `micelio inbox` · `private` | doubtful cases · private log |

## Security {#security}

`micelio security test | scan | clean <id> | log | rules`: test bench, scan, cleaning (admins), log, rules.

The CLI's messages are in Italian.
