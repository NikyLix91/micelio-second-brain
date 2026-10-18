# Distillation quality

How many memories should Claude extract from a session? Few and good, or more? The **Distillation quality** card (Team page) gives the data to decide the limit (`distill.maxMemories`, default 5).

## Why a limit {#why}

With the subscription CLI, cost is not the problem: **noise** is. A memory full of marginal entries is harder to use for people and for agents, who query it at every task. The distiller lists memories most important first; the limit cuts the tail.

## How it is measured {#metrics}

Every distilled memory carries its **position** in the distillation (1st, 2nd…) and how many memories the model had proposed. For each position band, on memories **older than 3 days** (before that they have not had time to be used):

| Measure | Meaning |
|---|---|
| Useful | voted up or used by the agents |
| Voted useless | negative sum of votes |
| Merged or archived | removed by dreaming: duplicates or knowledge that was not needed |
| Never used | no use and no vote |
| Score | useful − voted useless − merged or archived (from −1 to +1) |

Plus **saturation**: in how many distillations the model proposed at least as many memories as the limit. If it happens often, the limit is cutting.

## The advice {#advice}

The **first positions** (1–3) are compared with the **last allowed ones** (the last two below the limit):
- **raise**: the last ones are worth almost as much as the first (score gap ≤ 0.15) and the limit is reached in at least 30% of distillations;
- **lower**: the last ones are worth much less (gap ≥ 0.35) or at least half of them are useless or merged;
- **keep**: in the other cases;
- **not enough data**: fewer than 30 mature memories, or fewer than 10 in the last positions.

The metrics are computed on the team log, so they are the same on every PC. From the terminal: `micelio quality`.
