# Roots

**Roots** are the foundational knowledge of the team: architectural paradigms, network and infrastructure maps, interfaces and contracts between systems, domain model, best practices (e.g. the rules for developing with AI), security policies. They are consulted rarely, but must never be forgotten.

## What changes for a Root {#guarantees}

- **It is never forgotten**: its activation never drops below **0.75**; dreaming neither archives it nor merges it with other memories. These guarantees live in the `apply` function, so they hold on every PC.
- **It surfaces when needed** (see below).
- **It is reviewed instead of forgotten** (see Review).

It is a view record (`root/<id>`) with category, who promoted it, date of the last review, status (`ok` or `review`) and flags.

## How it reaches the agents {#emerge}

- After every `recall` search, up to 3 **related Roots** not already among the results are appended: foundational knowledge reaches the agent even if the question does not mention it.
- The MCP tool **`architecture`** returns the Roots of a project, of a category or of the files the agent is touching; the server instructions ask agents to call it before changing the architecture.

## How a Root is born {#create}

- **Any member** can promote (and remove) a Root: from a memory's details ("Make it a Root"), from the CLI (`micelio roots add <id> <category>`) or by asking the agent (tool `mark_root`).
- **Suggested by Micelio**: the distiller flags memories that look foundational; they stay suggestions in your `private.db` until you promote or dismiss them.
- **Roots folders**: the documents of a folder marked "Roots" (Settings) become Roots by themselves.

## The review {#review}

A Root that never decays can become **wrong**. "Review the Roots" (or `micelio roots review`) looks for three kinds of clues:
- **code changed**: commits after the last review on the cited files, or files that disappeared; the repository is looked up among the folders enabled on this PC and their subfolders;
- **source document** modified or removed (only on the PC that owns it);
- **contradictions**: newer, similar memories that contradict it, assessed by Claude (at most 30 comparisons per review, within the budget), plus the "contradicts" links found by dreaming.

Roots with clues become **to review** for everyone (`root.flag` event). Nothing changes by itself: a person confirms ("Reviewed: still valid", `root.confirm` event), corrects or removes the Root.

## In the graph views {#visual}

In the **3D Nucleus** Roots sit at the centre of the sphere, with a white ring (red if to review); in the **2D map** they are diamonds with an outline. "◆ Roots" isolates them in both.
