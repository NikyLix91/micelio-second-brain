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

A **pinned** memory always has activation 1; a **Root** never drops below 0.75.

## Votes {#votes}

👍 useful / 👎 misleading or outdated. One vote per member (the last one counts), replicated to everyone as a `memory.vote` event. Agents can vote too with the `vote` tool, when you confirm that a memory helped you or was wrong.

## Uses {#uses}

Every time a memory appears among the results (yours or your agent's) your PC counts a use in `private.db`. Every 30 minutes the counters are published (`usage.report`) as a **G-Counter**: each node has its own cumulative counter and the total is the sum, so repeated or out-of-order reports do not inflate the numbers.

## Pin {#pin}

📌 **pins** a memory: it does not decay and dreaming neither archives nor merges it. Any member can pin; whoever pinned it or an admin can unpin it. For foundational knowledge that must also surface by itself, use **Roots**.
