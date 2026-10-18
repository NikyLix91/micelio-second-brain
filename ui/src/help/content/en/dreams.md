# Dreams (dreaming)

Once a day one team PC "dreams" for everyone: it tidies up the knowledge by merging duplicates, archiving what is outdated or no longer useful and linking related memories. Like sleep for human memory.

## Who dreams and when {#turns}

- Every day is an **epoch**. The turn order among active members is deterministic (hash of the epoch and the keys): every PC computes it the same way, without coordination.
- The first in the list may dream from the **configured hour** (default 1 pm); each following turn after another 30 minutes, if nobody has dreamt yet.
- Whoever starts writes a `dream.claim` event: the first in log order wins; the others see the claim and do not dream.
- Every PC checks its turn every 10 minutes. "Dream now" starts a manual dream with a dedicated epoch.

## What happens in a dream {#phases}

1. **Near-duplicates**: very similar memories are grouped (vector similarity ≥ 0.92 with the e5 model).
2. **Consolidation**: for each group Claude decides whether to **merge** (a new memory replaces the old ones: `memory.supersede` event), mark a memory as **superseded**, or just **link** them (`memory.link`).
3. **Decay**: memories with activation below 0.15 and older than 90 days are **archived** (at most 20 per dream).
4. **Diary**: a summary (`dream.complete`) visible to everyone on the Dreams screen.

Pinned memories and Roots are never merged or archived.

## The cost {#budget}

At most 30 calls to Claude per dream, within the daily budget of the PC that dreams.

## Archive and restore {#archive}

Nothing is lost: superseded or archived memories leave the search but stay in the log. In the **Archive** they are shown with the reason and can be **restored** (`memory.restore` event). Only **redacted** memories (removed by an admin because of their content) cannot be restored.
