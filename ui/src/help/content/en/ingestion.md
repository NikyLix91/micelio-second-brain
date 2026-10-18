# Collection and distillation

How everyday work becomes team knowledge, step by step, and where each piece ends up.

## Where the material comes from {#sources}

- **Claude Code sessions** in the folders you enabled (Settings → Automatic collection). Transcripts are the `.jsonl` files Claude Code writes in `~/.claude/projects/`.
- **Document folders**: PDF, Word, Excel, PowerPoint, OpenDocument, Markdown, text, diagrams (draw.io, SVG, PlantUML, Mermaid).
- **Explicit saves**: "New memory" in the app, `micelio remember`, or the agent with the MCP tool `remember`.

## Sessions {#sessions}

- **At the end of a session**, the `SessionEnd` hook installed in Claude Code notifies the daemon (if it is off, the hook starts it).
- **During long sessions**, every 15 minutes the daemon looks at the transcripts: a session **idle for at least 10 minutes** with enough new material (4 of your messages or 6,000 characters) is processed in **chapters**. A session idle for more than 6 hours is taken anyway.
- **No duplicates**: for each session `private.db` remembers how many lines were already read; only the new part is processed.
- **Recovery**: sessions that ended while the daemon was off are collected at the first start.

From the transcript a compact text is built (questions, answers, tools used in short); the model's internal reasoning and sub-agents are excluded; the content of **sensitive files** read or written (`.env`, keys…) is removed entirely.

## Code changes {#code-changes}

If the session is in a git repository, a **summary of the changes** of the chapter is added: commits made in that interval and uncommitted work, with the files touched and the classes, functions and endpoints added or removed. Code is not copied: only names and commit messages. For sensitive files only the name appears.

## The steps {#steps}

1. **Local filter** (see Privacy filter): blocks HR/personal topics and removes secrets and personal data.
2. **Classification** (fast model, default Haiku): knowledge for the team, private or to discard, with a confidence.
3. **Routing**: team if clean and sure (confidence ≥ 0.8); inbox if doubtful or mixed; private or discarded if clear.
4. **Distillation** (more capable model, default Sonnet): from 0 up to the team **limit** (default 5) atomic memories, most important first, with references to files and commits. Zero memories is a normal outcome.
5. **Second filter** on the memories produced (the model might have reported something sensitive).
6. **Publication** or inbox.

Calls to Claude go through the **CLI** installed on the PC (`claude -p`), with your subscription: no API key, no tools enabled for the model, no session saved. Micelio's own calls are not collected in turn.

## Where a memory ends up {#storage}

Publishing means appending to **your feed** the `memory.add` event with title, body, kind, tags and source (including the position in the distillation and the code references). The memory **id** is the SHA-256 hash of normalised kind + title + body: two PCs distilling the same knowledge produce the same id, and no duplicate is created. Then: replication to colleagues → view → search index (`view.db`) and Markdown export, on every PC.

## The job queue {#queue}

Each session or document is a **job** in the `private.db` queue, run every 3 seconds. LLM budget exhausted → the job restarts tomorrow without losing attempts; CLI not available → retried after 10 minutes; error → after 5 minutes.

## Code references {#code-refs}

Each memory from a session carries the **project** (repository folder), the remote **without credentials**, the branch, the **files** (relative to the repository), the **symbols** and the **commits**. Commits suggested by the model are checked against git: an invented hash is discarded.
