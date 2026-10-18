# On your own: local only and personal memories

Micelio also works for a single person: a one-member team is a normal team. On top of that there are two things designed for individual use.

## Local-only mode {#local}

A team in **local-only** mode uses no network: the node joins no DHT, looks for no colleagues and answers no join requests. Everything else (collection, distillation, search, Roots, dreaming, agents) works as always. You choose it when creating the team ("Just for me, no network", or `micelio init <name> --solo`) or later in Settings → Network ("Local only", or `micelio network local`).

To invite someone, first choose a network (public or private): the node reconnects and nothing is lost. In local-only mode invites are refused with this explanation, and the desktop app does not warn about an "isolated node".

Careful: on your own, the data exists only on this PC. Back up the node folder, or invite a second PC of yours: it is also a spare copy.

## Personal memories {#personal}

A **personal** memory stays on this PC (`private.db`, `personal` table): it never enters the log, is not replicated, the team does not see it. It does show up in your searches and in your agents' ones, marked 🔒, next to the team memories. You create one:
- from **Memory → New memory → Just for me**;
- from the agent, asking it to remember something "for you" (tool `remember` with `personal: true`);
- from the terminal: `micelio remember "<title>" -b "<text>" --personal`.

The text goes through secret redaction (agents read it); the block of personal or HR content does not apply, because it never leaves the PC. Votes, pins and Roots do not apply to personal memories, and they stay out of the constellation, dreaming, export and metrics.

## Sharing or deleting {#share}

From the details of a personal memory: **Share with the team** sends it down the same road as an explicit save (filter and classification), so it may end up in the inbox; **Delete** removes it without a trace, because it was never in the log. From the terminal: `micelio personal`, `personal share <id>`, `personal delete <id>`.

## From the inbox {#inbox-keep}

A memory in the inbox that you do not want to give to the team but find useful: **Keep it for me** turns it into a personal memory (in the Private log it appears as a private choice). From the terminal: `micelio inbox keep <id>`.
