# Where the data is

All Micelio data lives in the node folder: `~/.micelio` (on Windows `C:\Users\<you>\.micelio`), or the one given with `--home` or `MICELIO_HOME`. Nothing else is written elsewhere, apart from test logs.

## The node folder {#home}

| File / folder | Content | Format | Replicated? |
|---|---|---|---|
| `config.json` | Port, local API token, LLM, enabled folders, network | JSON | No |
| `state.json` | Node name and **team keys**, including the encryption key | JSON | No: **protect it like a password** |
| `corestore/` | The **team log**: the feeds of all members | Hypercore (binary files + RocksDB) | **Yes**, this is what synchronises |
| `view.db` | Search index, vectors, priority signals | SQLite | No: rebuilt from the log |
| `private.db` | Inbox, private log, job queue, budget, security log | SQLite | **Never** |
| `export/` | Readable copy of the knowledge | Markdown with frontmatter | No |
| `sources/` | Original documents downloaded from colleagues | Original files | No (30-day cache) |
| `logs/` | Daemon and Claude Code hook logs | Text | No |

## The team log {#log}

Each member writes only to **their own feed** (a *Hypercore*: an append-only log, signed with the member's key). Every action is a JSON **event**: `memory.add` (new memory), `memory.vote`, `root.set`, `member.add`, `team.config`… No event is ever changed or deleted: even a correction is a new event.

**Autobase** merges everyone's feeds into a single causal order (the same on every PC). Blocks are **encrypted** with the team key: someone copying `corestore/` without `state.json` could read nothing.

## The view {#view}

From the events, in that order, a **deterministic** function (`apply`) computes the team **state**: members, memories, votes, Roots, configuration. The state is stored in a *Hyperbee* (a key-value database inside the corestore). It is also where **permissions** are enforced: a forbidden event (e.g. a removal made by a non-admin) is simply ignored by everyone.

## The search index {#index}

`view.db` is a **SQLite** database derived from the view: active memories, **FTS5** text search (BM25), the semantic **vectors** computed locally and the priority signals (uses, votes, pins). It can be deleted at any time: on restart the daemon rebuilds it from the log.

## The private store {#private}

`private.db` holds what concerns **only you** and is never replicated: the inbox, the decision log (what did not reach the team and why), the collection job queue, LLM usage, the progress of sessions already read, the documents of watched folders, the security log and Root suggestions. It cannot be rebuilt: do not delete it.

## The Markdown export {#export}

`export/team/<kind>/<title>-<id>.md`: one file per memory, with YAML frontmatter (id, kind, tags, author, date, project) and the code references. It is read-only and updates itself: handy for Obsidian or a grep.

## What to back up {#backup}

The bare minimum is **`state.json`** (the team keys) and `config.json`. The log (`corestore/`) can be downloaded again from colleagues; `view.db` and `export/` are rebuilt. `private.db` holds your inbox and log: back it up if you care about them.
