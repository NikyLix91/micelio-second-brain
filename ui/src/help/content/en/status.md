# Node status

The **Status** page summarises your PC: node and role, network, knowledge, LLM, automatic collection, inbox and disk usage. It updates by itself.

## The cards {#cards}

- **This node**: name, key (the identity of your feed), role (admin, indexer).
- **Network**: how many colleagues are connected right now. Zero for more than 10 minutes → the desktop app warns you that knowledge is not synchronising.
- **Team knowledge**: the active memories on this PC.
- **Intelligence (LLM)**: which adapter is in use, whether the CLI answers, today's calls against the budget (above 90% a notification arrives).
- **Automatic collection**: queued, done and failed jobs; enabled folders.
- **Inbox**: the memories waiting for your decision.

## Disk usage {#storage}

- **On this disk**: Micelio's total, split into team log (`corestore/`), search index (`view.db`), private store (`private.db`), downloaded documents (`sources/`) and export.
- **By member**: for each member, the size of their feed in the team log (`byteLength` of their Hypercore) and its share of the total. It includes everything they wrote: memories, but also votes, usage and dreams. It is the same on every PC, because every node keeps everything.
