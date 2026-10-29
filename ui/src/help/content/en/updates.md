# Updates

Since version 0.8.0 the desktop app updates itself: it finds the new version, downloads it, checks that it really is ours and installs it when you ask. The card is in **Settings → Updates**; it isn't in the browser, because the update concerns the app installed on the PC.

## How it works {#how}

1. **Check.** 30 seconds after launch and then every 4 hours the app looks at the latest version published on GitHub, on the project's releases page. No account needed: the project is public. "Check now" does it right away.
2. **Download.** If there's a newer version it downloads it in the background; the card shows the progress.
3. **Verification.** Before considering it ready it checks the **signature** (see below). If the signature is missing or doesn't match, it deletes the file and installs nothing.
4. **Notice.** A notification and an item at the top of the icon menu ("Restart and update to…") say it's ready.
5. **Installation.** Only when you choose **Restart and update**: never by surprise, not even when you close the app.

Test versions (for example `0.9.0-rc.1`) don't reach people using a normal version.

## Restart and update {#install}

Micelio shuts the daemon down in an orderly way and closes; the installer replaces the programs **without windows** and at the end reopens the app, which starts the new daemon. It takes **a few minutes** on Windows (about 5: there are thousands of files and the antivirus checks them one by one), a few seconds with the AppImage: don't reopen Micelio by hand meanwhile. Colleagues lose nothing: what they write meanwhile reaches you as soon as the node is back.

Your **data isn't touched**: memories, teams, keys and settings live in `~/.micelio`, outside the programs folder. The app's settings (like this card) stay too.

Claude Code sessions already open: hooks keep working, but the connection to Micelio's MCP server breaks, because the installer has to close every program in its folder. Reconnect it with `/mcp` (or close and reopen the session; `/resume` picks the conversation up again).

## The signature {#signature}

**Why.** The downloaded file comes from GitHub. Checking only the fingerprint written next to it (`latest.yml`) protects against a broken download, not against someone able to change the files of a version: they would change the fingerprint too. That's why every package has **our own Ed25519 signature**, in a `.sig` file next to the package.

**How it works behind the scenes.**
- The signature is made by the process that builds versions on GitHub (the release workflow), with a **private key** that exists only in a GitHub secret, usable only when a version is published, and in a backup copy kept by the author. It isn't on anyone's PC and it isn't in the code.
- The **public key** is inside the app: the app verifies with it, and nobody can sign in our place without the private one.
- The signature covers the package name, the version and its SHA-256 fingerprint: an old package (genuinely signed) can't be passed off as a new version, and not a single byte of the file can change.
- The verification is repeated right before installing, because the file can sit on disk for hours.

If the card says the signature isn't valid, the update has already been deleted: there's nothing to do but report it.

## Linux {#linux}

- **AppImage**: updates like on Windows; the AppImage file is replaced with the new one.
- **.deb package**: the app says there's a new version and opens the page to download it. Installing a .deb requires the administrator password, so the package manager does it (`sudo apt install ./micelio_<version>_amd64.deb`), not the app.

## Automatic check off {#off}

Untick "Check for updates by itself" to keep the app from contacting GitHub: for example on a network that forbids it. "Check now" stays. The choice applies to this PC and survives updates.

## If something goes wrong {#trouble}

- **"I can't reach GitHub"**: no network or a proxy blocking `github.com`. It tries again by itself after 4 hours.
- **Versions before 0.8.0** can't update themselves: 0.8.0 must be installed by hand, then the rest is automatic.
- **Updating by hand** always works: download the installer from the releases page and run it over the existing installation.
- The `updates.log` file tells what happened at each check: on Windows it's in `%APPDATA%\@micelio\desktop\logs`, on Linux in `~/.config/@micelio/desktop/logs`.
