# Several teams

The same PC can take part in several teams: for example your product team and a customer's team, or one team per project. Each team has **knowledge of its own**, which never mixes with the others: an agent working for customer A does not find the memories of customer B, and the other way round.

## What stays separate {#separation}

Each team has its own subfolder `teams/<id>/` in the node folder, with:
- the team **keys** (`state.json`), so a different encryption;
- the replicated **log** (`corestore/`), which synchronises only with the members of that team;
- the **search index**, the **private store** (inbox, log), the Markdown **export**;
- the **settings**: enabled folders, network (even different DHTs) and dreaming.

On the network the teams cannot be linked: each team announces itself on the DHT with a different node key, so whoever watches the DHT cannot see that two teams share a PC.

**Shared** by all teams are: port and token of the local API, the LLM (a single queue of calls to Claude and a single daily limit, because there is one subscription) and the embedding model.

## Switching team {#switch}

The **Team** switcher at the top of the sidebar chooses which team the screens work on. The choice applies to this window and is remembered in the browser; it changes nothing for other programs.

The **default team** (★ on the Team page) is the one used by the command line and the agents when they do not name a team. Change it with "Make default" or `micelio teams default <team>`. From the command line another team is given with `micelio --team <id or name> <command>`.

## Each team's color {#colors}

With several teams the app takes the **color of the team** you are working on: the sidebar is tinted, and buttons, links and the active menu item use the same color. That way you can tell at a glance where you are. With a single team the app stays green as always.

Each team gets a different color automatically; the default one keeps green. To change it, on the **Team** page click the dot next to the team's name and pick from the palette. It is your own preference: it is remembered in this browser and colleagues do not see it.

## Adding a team {#add}

"＋ Add a team…" in the switcher (or on the Team page) opens the same form as the first start: you create a new team or join an existing one with an invite code. The name is already the one of your identity; you can choose another one for the new team only. From the terminal: `micelio init <name>` or `micelio join <code>`, which are added to the teams already there.

## Your identity {#identity}

The first time you join a team, `identity.json` is created: your name and a pair of personal keys. In each team your node publishes a `member.identity` event with the public key of the person and a **signature** over the key of its own feed in that team. Everyone checks the signature: nobody can pretend to be you, nor copy the event from another team.

What it is for: if a colleague is with you in two teams, on the Team page next to their name you see "same person also in: …". This also tells apart two colleagues with the same name. Someone who shares only one team with you sees just a key and does not know which other teams you are in.

The secret key never leaves the PC: protect `identity.json` like `state.json`.

## Which team sessions and documents go to {#folders}

Enabled folders (Settings) belong to the team selected when you enable them, and **a folder belongs to one team only**:
- a Claude Code session goes to the team of the **most specific** folder that contains it: with `C:\work` in team A and `C:\work\customerX` in team B, the sessions in `customerX` go to B only;
- the same folder cannot be enabled in two teams;
- document folders cannot even be nested across teams: watching is recursive and the same file would end up in two teams.

A session in a folder enabled in no team is ignored, as always.

## The agents of a project {#agents}

The MCP registered with `micelio setup claude-code` (or with "Connect Claude Code" in Settings) applies to every folder and **picks the team from the folder Claude Code works in**: in an enabled folder of a team it uses that team; in a folder that is in no team it doesn't read the memory (see **Agents and MCP**). The team is picked on every request, so it also works for a folder enabled while a session is already open. Every `remember` reply says which team the memory went to, and a save from a folder that doesn't belong to the team isn't published but goes to the Inbox (see **Agents and MCP**).

**How it works:** Claude Code starts `micelio mcp` (a small stdio process) in the project folder. The process sends the folder to the daemon on every request and the daemon matches it against the teams' enabled folders, as it does for session collection. Up to version 0.5.0 the MCP was registered over HTTP and the daemon didn't know which folder the agent was working in: a memory saved in a project of another team ended up in the default team. Since 0.6.1 the daemon updates the old registrations by itself at startup: reopen the Claude Code sessions that were already open.

"Connect Claude Code" next to a folder registers the same shim for that folder only, in Claude Code's **local** scope (in `~/.claude.json`, not in the repository): useful if the user registration is missing or belongs to another installation. A team other than the folder's can no longer be forced: since 0.6.1 the folder always decides, and that's the check that prevents publishing to the wrong team. To move a project to another team, enable its folder in that team.

## Removing a team from this PC {#leave}

"Remove from this PC" (Team page) or `micelio teams leave <team> --yes` closes the team and deletes its subfolder: log, search, inbox, private log and local settings. The team keeps existing on your colleagues' PCs, and the memories you published stay theirs. To come back you need a new invite. It cannot be undone.

## From the single-team version {#migration}

Before, the team files lived directly in the node folder. On the first start of the new version they are moved into `teams/<id>/`, the team settings move from `config.json` to `settings.json` and the node name becomes the one of your identity. The team becomes the default one: CLI, agents and hook keep working as before.
