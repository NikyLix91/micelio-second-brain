# Automatic context

An agent uses Micelio only if it decides to call `recall`, and often it does not. With automatic context it is Micelio that inserts useful knowledge into the conversation, at the right moment, without waiting for the agent.

## How it works {#how}

`micelio setup claude-code` (or "Configure" in Settings) installs two Claude Code **hooks** next to the end-of-session one:
- `SessionStart`: when a Claude Code session starts it runs `micelio hook session-start`;
- `UserPromptSubmit`: at every user request it runs `micelio hook prompt`.

The command asks the daemon for the context (`POST /api/context`, with the working folder and, for requests, the text) and returns it to Claude Code as `additionalContext`: the agent reads it as part of the conversation. The team is the one of the working **folder** (see **Several teams**), otherwise the default one.

## At session start {#session-start}

The project is the repository where the session starts (or the folder name). What arrives:
- the project **Roots**, plus the general ones (best practices and policies with no project);
- the project's **most alive memories** (highest activation).

Each entry is one line: kind or category, title, first line of the text and id. For the full text the agent uses the MCP tool `get`.

## At every request {#prompt}

Micelio compares the **meaning** of the request with memories and Roots (local vectors) and inserts only what passes the relevance threshold: keywords alone on a free sentence would find too much noise. Very short requests ("ok", "thanks") produce nothing, and what was already shown in the same session is not repeated. These insertions do not count as a "use" of the memory.

## Settings {#settings}

In the "Automatic context" card of Settings: session start on/off, requests on/off, maximum characters per insertion (default 4000). They apply to the whole machine, because the hooks belong to the user. To remove them entirely: `micelio setup claude-code --no-context`.

## Privacy {#privacy}

Everything happens on the PC: the text of requests goes only to the local daemon, is not saved and never enters the team log. The inserted memories are those the user already sees (team and personal), with secrets already redacted. If the daemon is off or slow, the hook inserts nothing and Claude Code carries on normally.
