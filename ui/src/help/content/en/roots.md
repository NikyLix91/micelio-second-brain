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

- **Any member**, unless the team chose "Roots for admins only" (see below), can promote (and remove) a Root: from a memory's details ("Make it a Root"), from the CLI (`micelio roots add <id> <category>`) or by asking the agent (tool `mark_root`).
- **Suggested by Micelio**: the distiller flags memories that look foundational; they stay suggestions in your `private.db` until you promote or dismiss them.
- **Roots folders**: the documents of a folder marked "Roots" (Settings) become Roots by themselves.

## Roots for admins only {#admin-only}

Roots reach everyone's agents as rules to follow, and with "keep up to date" they end up in the colleagues' `CLAUDE.md` and `AGENTS.md`. That's why a team can decide that **only admins create and remove Roots**: Team → Team settings → "Roots for admins only". The other members keep flagging them and confirming them after review, and their Root suggestions stay suggestions until an admin promotes them.

It's **on in new teams** since 0.6.2. In existing teams an admin turns it on; the Roots created before stay.

**How it works behind the scenes.** It's the `roots.adminOnly` team setting, replicated to everyone. The real check is in the replicated log (`src/net/apply.ts`): a `root.set` or `root.unset` from a member who isn't an admin is dropped by every node, even if it comes from a modified client. It applies from the moment the admin turns it on, so every node reaches the same view.

## The review {#review}

A Root that never decays can become **wrong**. "Review the Roots" (or `micelio roots review`) looks for three kinds of clues:
- **code changed**: commits after the last review on the cited files, or files that disappeared; the repository is looked up among the folders enabled on this PC and their subfolders;
- **source document** modified or removed (only on the PC that owns it);
- **contradictions**: newer, similar memories that contradict it, assessed by Claude (at most 30 comparisons per review, within the budget), plus the "contradicts" links found by dreaming.

Roots with clues become **to review** for everyone (`root.flag` event). Nothing changes by itself: a person confirms ("Reviewed: still valid", `root.confirm` event), corrects or removes the Root.

## In the graph views {#visual}

In the **3D Nucleus** Roots sit at the centre of the sphere, with a white ring (red if to review); in the **2D map** they are diamonds with an outline. "◆ Roots" isolates them in both.

## In the agents' files {#agent-files}

"Files for agents" (at the bottom of the page) writes the Roots of a project into `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex and others) or `.cursor/rules/micelio.mdc` (Cursor), the files agents read by themselves at every session. Micelio only writes between the `<!-- micelio:start -->` and `<!-- micelio:end -->` markers; the rest of the file is left alone. The block contains no dates: it is rewritten only when the Roots really change, so it does not clutter diffs. The list of files kept up to date is in the team settings (`settings.json`). From the terminal: `micelio roots export <folder> --format claude|agents|cursor`.

## Importing knowledge already written {#import}

"Import Roots" turns into Roots the knowledge the team already has in files: a folder of **ADRs** (one decision per file, architecture category), `CLAUDE.md` / `AGENTS.md` (one Root per `##` section, skipping Micelio's block), a Markdown vault. No LLM: the text stays as written, goes through the secrets filter, and confidential content (HR, personal) does not get in. Title and tags are taken from the notes' YAML header (Obsidian), and the header leaves the text. **Importing again updates**: a changed file replaces its previous version (which stays in the history), an identical one is not duplicated. From the terminal: `micelio roots import <path> [--category …]`.
