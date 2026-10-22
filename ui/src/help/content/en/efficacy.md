# Efficacy

The **Efficacy** page shows when agents (Claude Code) query Micelio and whether they get useful data. It tells you how much Micelio really helps, and it improves Micelio itself: useful memories rise, and those that are only noise become visible.

## Queries {#consultations}

Every request from an agent to Micelio, as soon as it arrives:
- **search** (`recall`), **Roots** (`architecture`), **reading** a memory (`get`), original **document** (`fetch_source`);
- **automatic context**: at session start and at each of your requests, if the hooks are active (Settings → Automatic context).

For each one: time, project, question, memories returned and the daemon's **response time**. With the automatic context, every message you write to Claude Code waits for Micelio: above 1 second the response is marked as slow. The top of the page shows the median and the 95th percentile.

## Outcomes {#outcomes}

A memory being **returned** does not mean it **helped**. To find out, Micelio looks at what the agent did **after** receiving it. It does so when it collects the session, that is after a few minutes of inactivity, which is why outcomes arrive after the queries. Two judgements:
- **heuristic**, for every session and at no cost: a distinctive element of the memory appears in the agent's later messages and commands, such as a command in backticks, a file path, a class or function name, a URL or a file from the code references. Outcome **≈ probably useful**, with the element found as evidence; otherwise "no trace of use". Common words do not count;
- **LLM**, for the sessions that get distilled: in the same distillation call the LLM judges each memory delivered as **✓ useful** (really used), **· not used** or **✗ wrong** (outdated or contradicted by what came out), with the reason. The LLM's judgement takes precedence over the heuristic.

**Automatic thumbs up 👍:** a memory confirmed "useful" by the LLM gets this PC's +1 vote, as if you had voted it. Never over a vote you already gave by hand, up or down. The vote raises the memory's priority for the whole team.

## Most useful {#top}

The memories with the most useful outcomes in the period. For each one: how many times it was useful here and how many **in the team**. Every PC publishes its own count, and the total also appears in the memory details ("useful N times to the team's agents").

## Noise {#noise}

Memories returned often, at least 5 times, but never useful. The title probably makes them look relevant to unrelated questions, or they state the obvious. They can be rewritten, merged or archived. Meanwhile Micelio offers them less: see **Habituation**.

## Habituation {#habituation}

A memory delivered to agents several times in a row without ever helping is offered **less**, as happens in the brain with a stimulus that repeats without consequences. It removes noise from the context: every useless memory distracts the agent and uses up tokens.

| Times in a row without helping | Weight |
|---|---|
| up to 2 | 100% |
| 3 | 85% |
| 5 | 55% |
| 7 or more | 30% (minimum) |

- **Automatic context** (session start and every request): full weight. A memory that has only been noise can drop out of a request's context entirely.
- **Explicit searches** (`recall`, search in the app, chat): half the effect, 65% at the lowest, because there the question is precise.
- **One useful outcome** ("used" or "probably useful") is enough to go back to 100%. A "wrong" outcome counts as not helping.
- **Pinned memories are not touched.** Activation doesn't change: constellation, dreaming and archiving stay the same.

The memory's details say how many times in a row it didn't help and how much it weighs now; the **Noise** list shows the current weight.

**How it works behind the scenes.** The run is read from **this PC's** outcomes (`outcomes` table in `private.db`, last 90 days), in time order: every outcome with no use adds one, a useful outcome resets it. The team counters (`usage.report`, `useful.report`) are not used: they are cumulative, have no order in time, and also count deliveries nobody evaluated. The computation is redone only when new outcomes arrive; in search the factor multiplies the final score, in per-request context it multiplies the similarity before the relevance threshold (the threshold is still computed on the original scores). Code: `src/rank/habituation.ts`.

## Wrong or outdated {#wrong}

Memories the LLM found contradicted by what came out in a session: for example a port that changed or a procedure no longer valid. Micelio does nothing on its own: open the memory and decide. You can fix it by writing a new one, vote it down or archive it; if it is a Root, "flag for review".

## Unanswered questions {#unanswered}

Agent searches that found nothing. They are knowledge gaps: you also find them in the **Digest**, where they can be reported to the team.

## Notifications {#notifications}

With the desktop app you get a notification when a memory was **useful** (confirmed) or **wrong**, at most three at a time. Queries do not notify: with the automatic context there are dozens per hour. Turn them off in **Settings → Automatic context**.

## How it works behind the scenes {#internals}

- **Log:** queries and outcomes live in `private.db` (tables `consultations` and `outcomes`), **on this PC only**, and are kept for 90 days. The question goes through secret redaction before being saved.
- **What Micelio delivered:** Micelio re-reads the new part of the session transcript (`~/.claude/projects/…/<session>.jsonl`). The results of its MCP tools and the context inserted by the hooks (`hook_additional_context` rows) carry the `id:` of each memory: this tells exactly what the agent received and from which line onwards to look at its actions.
- **LLM judgement:** the list of memories delivered is appended to the distillation text, with one extra rule in the prompt. No extra call, only a few tokens. Discarded or private sessions are not distilled, so they keep only the heuristic outcome.
- **The team** receives two things: the thumbs up (an ordinary `memory.vote`) and the count of times a memory was useful. The count travels in the `useful.report` event, cumulative counters per memory and per PC like the usage ones; nodes running older versions ignore it.
- **Priority:** in the activation one useful use is worth 3 plain uses. Before, a memory counted as "used" as soon as it was returned.
