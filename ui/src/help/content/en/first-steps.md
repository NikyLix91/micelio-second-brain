# First steps

The path to make Claude Code work with the team's memory: four steps, each with the button that does it and a check that ticks it by itself. It opens by itself after creating the team or joining with an invite; you find it in the sidebar until it's complete, then here in the Guide.

**What you need first:** Claude Code installed and signed in, on the same PC and with the same user you use Micelio with. Micelio uses your Claude subscription: no API key.

## 1. Claude Code on this PC {#claude}

Micelio is the memory; Claude Code is what uses it. The step is done when Micelio finds the `claude` program **and** sees that this PC user has already opened it at least once.

- **Not found**: install Claude Code from the [official page](https://code.claude.com/docs/en/setup), open it once, sign in, then press "Check again". Micelio looks for it in the PATH, in the known installs (native, npm, WinGet) and in the VS Code, Cursor and Windsurf extensions.
- **Found but never used by this user**: it happens when Claude Code is used with another Windows user, for example an administrator account. Claude Code reads its configuration from the profile of whoever starts it: if you start it with another user, it will never see Micelio. Use Micelio and Claude Code with the same user.

## 2. Connect Claude Code {#connect}

"Connect Claude Code" does three things, for all of this user's projects:
- registers Micelio among Claude Code's tools (**MCP server**): this way the agent can search the memory and save;
- adds the **hooks** that bring the team's knowledge at the start of every session and with every request (**automatic context**);
- adds the session-end hook for the **automatic collection** of long sessions.

Before touching Claude Code's configuration it saves a copy of it. It's the same button as **Settings → Claude Code**.

**After the click** close and reopen the Claude Code sessions already open (in VS Code: reload the window). Claude Code reads its tools only when the session starts.

## 3. Choose the project folders {#folders}

Claude Code uses the team's memory **only in the folders you enable**, subfolders included. Enable the folder of every project you work on with the team: for example `C:\SourceCode\project-name`, or the folder that contains them all.

**Why it's needed.** From a folder that belongs to no team, Claude Code reads nothing from Micelio: an untrusted repository, cloned from the internet, could contain instructions written to make the agent search the memory and send it out. And a memory saved from there isn't published: it ends up in the Inbox.

The same folders apply to **automatic collection**: only the sessions held there are read, filtered and distilled. You change them in **Settings → Automatic collection**. With several teams, each folder belongs to one team only: Claude Code uses the team that owns it.

## 4. Check that it works {#try}

Open Claude Code in one of the enabled folders:
- **from a terminal**: go into the project folder and start `claude`;
- **in VS Code**: open the folder and start a new Claude Code session.

Then write, for example: *"Search Micelio for what the team knows about this project"*. The step ticks itself as soon as Micelio receives the call, and says which folder it came from. With a new team the memory is empty: the answer will be that there's nothing yet, and that's normal.

If the call comes from a wrong folder, the page says so:
- **folder in no team**: enable it in step 3, or open Claude Code in a folder already enabled;
- **folder of another team** on this PC: open Claude Code in a folder of this team;
- **no folder**: it's the old registration, repeat step 2 and reopen the session.

**Nothing arrives?** The session must have been opened **after** step 2. In Claude Code type `/mcp`: "micelio" must show as connected. If it shows an error, check that Micelio is running (the icon in the notification area).

## Then {#next}

- **Save the first memory**: ask the agent *"remember that …"* with a decision or a solution of the project; you'll find it in the **Memory** page.
- **Document folders** (PDF, Office, Markdown): **Settings → Document folders**.
- **Invite a colleague**: **Team → Invite a colleague**.

## How it works behind the scenes {#behind}

Every 3 seconds the page asks the daemon for the state of the steps (`GET /api/setup/first-steps`): where it found `claude`, whether the user's profile has traces of Claude Code, how Micelio is registered in `~/.claude.json`, the team's enabled folders. For step 4 the daemon notes the last MCP call received and the folder it comes from, sent by the `micelio mcp` bridge that Claude Code starts. The note stays in memory only and never leaves the PC. The "path open / finished" state is saved in this app, per team.
