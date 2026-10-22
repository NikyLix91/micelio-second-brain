# Priority: which memories matter most

Every memory has an **activation** from 0 to 1: how "alive" it is for the team. It decides the order of equally relevant search results and which memories dreaming lets decay.

## Activation {#activation}

Inspired by the ACT-R model of human memory, it is the weighted sum of four components, computed on the fly:

| Component | Weight | What it measures |
|---|---|---|
| Recency | 40% | Decay since the last use (or creation), with a half-life per kind: decision and reference 365 days, how-to and fact 180, gotcha 120, snippet 90 |
| Uses | 30% | How many times the team used it (logarithmic: saturates around 50 uses) |
| Votes | 20% | Sum of usefulness votes (0 votes = neutral) |
| Centrality | 10% | How many links it has in the constellation |

A **pinned** memory always has activation 1; a **Root** never drops below 0.75. A memory born from a hard session starts with a small head start (see **Hard-won discoveries**).

## Hard-won discoveries {#effort}

A gotcha found after an hour of errors is worth more than an obvious fact. That's why a memory distilled from a session starts with a **head start** proportional to the effort of the chapter it comes from: up to **+0.15** activation. The head start follows recency, so it wears off over time: if nobody uses the memory, after a few months it's gone. When the effort is at least 0.5, the memory's details say "Born from a hard session" with errors and minutes.

**How it works behind the scenes.** Effort (0 to 1) is computed from the chapter's transcript, with no extra LLM calls: half from **tool errors** (full at 15), a quarter from **duration** (full at 120 minutes), a quarter from **user messages** (full at 25). The thresholds were tuned on 196 real chapters: this way about one chapter in five turns out "hard". The value travels in the memory (`source.effort`, with errors and minutes), stays after the Inbox review, isn't part of the memory id and nodes on older versions ignore it. Only memories born from sessions count, not from documents or manual saves. Code: `src/ingest/effort.ts`.

## Votes {#votes}

👍 useful / 👎 misleading or outdated. One vote per member (the last one counts), replicated to everyone as a `memory.vote` event. Agents can vote too with the `vote` tool, when you confirm that a memory helped you or was wrong.

## Uses {#uses}

Every time a memory appears among the results (yours or your agent's) your PC counts a use in `private.db`. Every 30 minutes the counters are published (`usage.report`) as a **G-Counter**: each node has its own cumulative counter and the total is the sum, so repeated or out-of-order reports do not inflate the numbers.

## Pin {#pin}

📌 **pins** a memory: it does not decay and dreaming neither archives nor merges it. Any member can pin; whoever pinned it or an admin can unpin it. For foundational knowledge that must also surface by itself, use **Roots**.
