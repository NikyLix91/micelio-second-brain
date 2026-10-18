# Memory and search

The **Memory** screen searches the team knowledge and shows the details of the memories. AI agents use the same search (tool `recall`).

## How search works {#search}

It is a **hybrid** search, computed on your PC:

1. **Keywords**: SQLite FTS5 index with BM25 scoring; a word in the title counts 3 times a word in the body, in the tags 2 times. Accents ignored, prefixes accepted.
2. **Meaning**: the question and the memories are turned into **vectors** by a local, multilingual embedding model (`multilingual-e5-small`): a question in English finds memories in Italian.
3. **Fusion**: the two rankings are merged with *Reciprocal Rank Fusion* (k = 60).
4. **Priority**: with equal relevance, the most "alive" memories win (activation: used, voted, linked, pinned).

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
