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

The MCP registered with `micelio setup claude-code` applies to every folder and uses the **default team** (`/mcp`). For a project of another team press "Connect Claude Code" next to the folder, with that team selected (or use `micelio --team <team> setup claude-code --project <folder>`).

Micelio then registers `/mcp/<team>` in Claude Code's **local** scope: it applies when Claude Code is started in that folder and takes precedence over the user registration. It lives in your personal configuration (`~/.claude.json`), not in the repository, so the token never ends up in a file that could be committed. Start Claude Code from the connected folder (usually the repository root).

## Removing a team from this PC {#leave}

"Remove from this PC" (Team page) or `micelio teams leave <team> --yes` closes the team and deletes its subfolder: log, search, inbox, private log and local settings. The team keeps existing on your colleagues' PCs, and the memories you published stay theirs. To come back you need a new invite. It cannot be undone.

## From the single-team version {#migration}

Before, the team files lived directly in the node folder. On the first start of the new version they are moved into `teams/<id>/`, the team settings move from `config.json` to `settings.json` and the node name becomes the one of your identity. The team becomes the default one: CLI, agents and hook keep working as before.
