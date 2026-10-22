# Memory and search

The **Memory** screen searches the team knowledge and shows the details of the memories. AI agents use the same search (tool `recall`).

## How search works {#search}

It is a **hybrid** search, computed on your PC:

1. **Keywords**: SQLite FTS5 index with BM25 scoring; a word in the title counts 3 times a word in the body, in the tags 2 times. Accents ignored, prefixes accepted.
2. **Meaning**: the question and the memories are turned into **vectors** by a local, multilingual embedding model (`multilingual-e5-small`): a question in English finds memories in Italian.
3. **Fusion**: the two rankings are merged with *Reciprocal Rank Fusion* (k = 60).
4. **Priority**: with equal relevance, the most "alive" memories win (activation: used, voted, linked, pinned). Memories delivered several times without helping weigh a bit less (**Habituation**, in the Effectiveness guide).
5. **Used together**: the top results bring along up to 2 memories that in the team are usually needed together with them, marked "⇄ used together" (see **Use synapses**).

Every result returned counts as a **use** of the memory.

## Embeddings {#embeddings}

The model (about 130 MB) is downloaded the first time and runs in a separate thread of the daemon, without sending anything out. Vectors live in `view.db` and are recomputed if the model changes. Without the model, search works on keywords only.

## Proposing a memory {#propose}

"New memory" goes through the **same path** as the CLI and agents: privacy filter and classification. The outcome may be: published to the team, in the inbox for your check, or kept private (with the reason). The memory must be self-contained: understandable without the conversation it comes from.

## Memory details {#detail}

The panel shows kind, tags, text, author and date, and then:
- **Activation, uses and votes**, with 👍 / 👎 and 📌 (see Priority);
- the **Root** box (to make it foundational knowledge or review it);
- **From code**: project, branch, files, symbols and commits (commits are links if the repository is on a web server);
- **From document**: the name of the original file and "Download the original" from the colleague who owns it.

## Update instead of adding {#update-on-write}

When a new memory is about to enter the team, Micelio looks for the memories most **similar in meaning**. If there are none, it is simply added. If there are, Claude (the fast model) decides: **new** (it says something else) → added; **duplicate** → nothing is written; **update** (it corrects or completes an existing memory) → ONE updated version is written that replaces the old one (`memory.supersede`), which stays in the history and can be restored from the Archive. Roots and pinned memories are never replaced. Without an LLM or with the budget used up the memory is added as before. The admin turns it off on the Team page ("Update instead of adding").

## Code changed {#stale}

If a memory cites files (from the code of a session) and after it was written those files changed or disappeared, it may describe code that no longer exists. Micelio checks this on the repositories of **this PC** (at start-up, every 6 hours, or with "Check the repositories again" in the "⚠ Code changed" filter): it reads the git history of the cited files only and counts the commits after the memory. Effects: the activation goes down (−5% per commit, −20% per missing file, down to half), and the memory shows the warning, to agents too, so that they check the current code. The signal stays local. Roots have their own review instead. From the terminal: `micelio stale --check`.
