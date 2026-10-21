[Italiano](../app.md) | **English**

# Desktop app and interface

Micelio's interface is a **React** web app served by the daemon. There are two ways to use it:

- **Desktop app** (recommended): `npm run desktop`. It starts the daemon on its own, shows notifications and stays in the tray.
- **Browser**: `micelio ui` opens the interface with a single-use link, valid for 60 seconds.

There are no installers for now: the app is started from the console, from the project folder (see the plan, Phase 7).

```bash
npm run build      # daemon + UI
npm run desktop    # desktop app (starts the daemon if needed)
```

If the app closes right away when started from the VS Code terminal, the cause is the `ELECTRON_RUN_AS_NODE` variable, set by VS Code. `npm run desktop` goes through `desktop/launch.js`, which removes it; don't launch `electron` directly.

## Try it without touching your node

```bash
npm run build && npm run demo                     # 3 local nodes (alice, bruno, carla) with ~50 made-up memories
MICELIO_HOME=.demo/alice npm run desktop          # in another terminal (PowerShell: $env:MICELIO_HOME=".demo/alice"; npm run desktop)
```

The demo team uses a private DHT and a fake LLM: nothing goes out to the internet and it doesn't use your subscription. Stop it with Ctrl+C. The data stays in `.demo/` (ignored by git).

## The screens

### Nucleus (home)

![Nucleus](../img/nucleo.png)

The team's knowledge as a **3D hologram**.
- **Memories and synapses:** each point of light is a memory; the lines are the *synapses*, that is the links between related memories, traveled by pulses of light.
- **Correlations today and tomorrow:** today memories are related when they share tags, weighted by rarity. Phase 5 will add similarity of meaning, Phase 6 the links created by dreaming.

**Free navigation:**
- drag to rotate, scroll wheel to zoom;
- click a memory to fly to it and read it in the side panel;
- after 20 seconds without interaction the sphere starts rotating on its own again.

**Guided exploration** ("▶ Start guided exploration"): the camera flies from one topic to the next, with a caption that reports how many memories there are, who wrote them and the prevailing kind. You can go forward, back, pause and stop.

![Guided exploration](../img/nucleo-tour.png)

**Search** ("Light up a topic…"): the relevant memories light up, the others dim, and the camera flies to them.

**Colors:** *Holographic* (amber, lighter for the most connected memories), *By author* (each colleague has a stable color) or *By kind*.

Parameters in the address, useful on PCs with weak graphics or for testing:

| Parameter | Effect |
|---|---|
| `#/?bloom=0` | Turns off the glow |
| `#/?tour=1` | Starts the guided exploration right away |
| `#/?bs=1.35&br=0.4&bt=0.22` | Strength, radius and threshold of the glow |

### 2D map

![2D map](../img/mappa-2d.png)

Two-dimensional view for **targeted analysis**:
- colors by author or by kind;
- click a legend entry to isolate an author or a kind;
- search that lights up the relevant memories;
- labels appear as you zoom in.

### Memory

![Memory](../img/memoria.png)

Full-text search, latest memories received, detail with author and date. "New memory" proposes a memory to the team; it goes through the privacy filter just like from the CLI and from Claude.

### Roots

The team's foundational knowledge, by category: architecture, network, interfaces, domain, best practices, policies.
- Filter by project and by text.
- Roots **to review** are highlighted, with the reasons.
- **Review the Roots** runs the review and shows the report.
- **Suggested by Micelio:** proposals from the distiller, to promote (choosing the category) or ignore.
- In a memory's detail: *Make it a Root*, *Reviewed: still valid*, *Change category*, *No longer a Root*.

In the **Nucleus** the Roots are at the center of the sphere with a white ring (red if to review). In the **2D map** they are outlined diamonds. In both views **◆ Roots** isolates only the Roots.

### Inbox

![Inbox](../img/inbox.png)

Only the doubtful cases: for each one the reason and the deadline. The actions are *Publish to the team*, *Edit* (change title and body, for example to remove a sensitive detail, then publish) and *Discard*. The number in the sidebar shows how many items are waiting.

### Team

![Team](../img/team.png)

- **Invites:** create an invite and copy it, with a warning if no other member has received it yet.
- **Members:** invite tree.
- **Admins only:** promotion, expulsion with confirmation and shared settings (language of memories, maximum memories per distillation, filter keywords).
- **Distillation quality** (for everyone): by position in the distillate, memories that were useful, voted useless, merged or archived and never used, with the score. It also shows how often the limit is reached, and advice to raise, keep or lower the limit.

### Status

![Status](../img/stato.png)

The node at a glance: role, connected peers, memories, LLM and today's budget, automatic collection queue, inbox.

**Disk usage** shows:
- the total on this disk, split by component;
- the share of the team log that comes from each member, with a segmented bar and a table. The member colors are the same as in the Nucleus and the Map.

### Security

- **Test bench:** text or file name, and what the filter would remove.
- **Rules:**
  - the fixed ones: 25 types of secrets and personal data, 33 rules on sensitive files;
  - the team's: patterns, exceptions, sensitive files, editable only by the admin.
- **Memories to clean:** scan of the published memories and *Clean* (admin, with confirmation).
- **Log of this PC:** what was removed and from where, without values.

### Private log and Settings

- **Private log:** what didn't go to the team and why.
- **Settings:**
  - **Network:** public DHT or team private DHT, with the bootstrap nodes. *Check* tests the choice without applying it; *Apply* asks for confirmation and reconnects the node right away;
  - folders enabled for automatic collection (the app has a folder picker);
  - LLM models and budget, with immediate effect. Models are chosen from a dropdown (Haiku, Sonnet, Opus) or with "Other…" by typing any name the CLI accepts. The card also says which LLM is in use: `claude`, or `fake`, the demo team's fake LLM that doesn't call Claude;
  - Claude Code configuration (MCP + hooks), with confirmation, because it changes your profile.

![Settings](../img/impostazioni.png)

## Digest

The **Digest** page shows the team's week (new memories by kind and author, new Roots and Roots to review, most used, dreams, memories whose code changed), the **team gaps** (reported questions the memory can't answer, with the memory that might fill them and "Close with this memory") and **your searches with no answer** (only on this PC: "Report to the team" or "Ignore"). On Mondays the desktop app flags it with a notification.

## What's new in the other screens (B4)

- **Memory**: "🔒 Personal" and "⚠ Code changed" filters (with "Check the repositories again"); in the "New memory" form you choose "For the team" or "Just for me". The detail of a personal memory has "Share with the team" and "Delete"; a memory whose code changed shows the warning.
- **Roots**: at the bottom, "Files for agents" (CLAUDE.md, AGENTS.md, Cursor rules kept up to date) and "Import Roots" (ADRs, CLAUDE.md, Markdown vaults).
- **Inbox**: "Keep it for me" turns an item into a personal memory.
- **Team**: "Update instead of adding" among the admin settings; in local-only mode the invite is replaced by an explanation.
- **Settings**: "Local only" network; "Automatic context for agents" card.
- **First start**: "Just for me, no network" when creating the team.

## Multiple teams

If the PC belongs to several teams, the **Team** selector at the top of the sidebar picks which team all the screens work on. The choice applies to the window and is remembered; it doesn't change the default team, which the CLI and agents use. "＋ Add a team…" opens the form to create a team or join with an invite.

On the **Team** page, the "Your teams on this PC" card shows the teams with the default one (★), lets you change it and remove a team from the PC (with confirmation: it deletes that team's local data). Next to the members, "same person also in: …" appears when a colleague is with you in another team too. In **Settings**, next to each enabled folder, "Connect Claude Code" makes Claude Code started in that folder use this team.

## In-app help

Every page and every card has a **?** button next to the title: it opens a side panel on the help section about it (Esc closes it). **F1** opens the help on the page you're on. The **Guide** menu entry shows the full index, with a text search.

The help doesn't just explain what each feature does but also how it works behind the scenes: where the memories physically end up, in what kind of file, how they reach the others, what gets filtered and why. It is in Italian and English and follows the chosen language. `#/guida?t=p2p#discovery` opens a topic directly on a section.

## Language

The app is in **Italian** and **English**. The **IT / EN** selector is at the bottom of the sidebar (and on the welcome screen). The choice also applies to dates and numbers and, in the desktop app, to the tray menu and the notifications. It is remembered between launches; the first time, the system language is used.

Content written by the team (memories, reasons for flags, dream summaries) stays in the language it was written in. The language of distilled memories is chosen for the whole team on the Team page.

## Real-time updates

All screens update on their own: the daemon sends an event on every change (`GET /api/events`) and the UI reloads only the affected data. The dot at the bottom of the sidebar shows whether the connection is active.

## Notifications (desktop app)

The app stays in the tray even with the window closed. "Quit" in the tray menu closes it; the node keeps running. It alerts you when:

- new memories arrive in the inbox;
- the node has been isolated for more than 10 minutes (no colleague reachable);
- the day's LLM budget goes over 90%.

Clicking the notification opens the right screen.

## Security

- The UI in the app runs isolated (`contextIsolation`, `sandbox`, no Node). It receives only the token and the folder picker from the preload.
- Navigation is allowed only to the local UI; external links open in the system browser.
- Memory texts come from other nodes: Markdown is rendered **without** raw HTML, and in the graph tooltips titles are always "neutralized". A malicious node can't run scripts in your UI.
- In the browser the token never appears in the URL: the `micelio ui` link contains a single-use code that is exchanged and immediately removed.
