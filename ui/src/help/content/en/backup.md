# Backup and restore

The knowledge of a team lives on every PC of the team: as long as one is left, the knowledge is there. But replication is not a backup: it does not protect against a mistake that spreads to everyone or against an abandoned team, and it cannot move the knowledge into a new team. A **backup** is a file with all the knowledge of the team, which can be restored into a new team or into an existing one.

## Creating a backup {#create}

From **Team → Backup and restore**: choose a password (at least 8 characters, typed twice) and press "Create and download". From the terminal: `micelio backup create --out <folder>`; you type the password without it being shown, or scripts pass it in the `MICELIO_BACKUP_PASSWORD` variable. Never as an argument: it would end up in the shell history.

Any member can create a backup: they already see all the knowledge of the team. The file is named `<team>-<date>.micelio-backup`.

**What it contains:** active memories and history (archived and replaced, with the reason), with their original author and date; Roots with category and open flags; links between memories; votes and pinned memories; memory usage; knowledge gaps; the shared team configuration (e.g. the language of memories).

**What it does not contain:** keys, members and invites (a restored team has new keys); the private log, the Inbox and personal memories (they live on one PC only); original documents; redacted memories.

**Keep the password.** Without it the backup cannot be opened: nobody can recover it.

## Restoring {#restore}

From **Team → Backup and restore → Restore a backup**: choose the file. Micelio shows which team it belongs to, when it was made and how many memories it contains; then it asks for the password and where to restore it:
- **into a new team** on this PC: you become its founder and admin, and you invite your colleagues. This also works from the welcome screen on a freshly installed PC ("Restore from a backup");
- **into this team**: the knowledge of the backup is added to the team's, for everyone. Admins only, because it writes for everyone.

From the terminal: `micelio backup restore <file> --new-team [name]` or, into the current team, `micelio backup restore <file>`.

Memories already in the team stay as they are, with their status and Roots: restoring adds, it does not replace. Restoring the same backup twice duplicates nothing. Restored memories show their original author and date, and their priority uses that date: an old memory does not become "new" again.

A wrong password creates nothing: no empty team, no memories.

## Automatic backups {#auto}

From **Settings → Automatic backups**, for each team: turn them on, choose the folder (shared and network folders work too), how many to keep (7 by default) and a password. Micelio makes one backup a day, the first one right away, and deletes the oldest beyond the chosen number (only that team's backups). The result of the last one, or the error, is shown below. From the terminal: `micelio backup auto on --folder <folder>`, `micelio backup auto off`, `micelio backup auto` to see the status.

The password of automatic backups stays on this PC only, in the team settings (`teams/<id>/settings.json`). This weakens nothing: the team data on this disk is already in clear. Encryption protects the copies in the backup folder, which is often shared.

## How it works behind the scenes {#internals}

**The file.** It is a JSON with four parts: the **manifest** in clear (team, date, who made it, counts), the key parameters, the encryption parameters and the **data**. The data is the knowledge of the team as JSON, compressed (gzip) and encrypted with **AES-256-GCM**. The key is derived from the password with **scrypt** (N = 32,768, r = 8, p = 1): each attempt costs about a tenth of a second and 32 MB of memory, so guessing passwords is slow. The manifest is authenticated together with the data: changing a single letter makes the file unreadable. A wrong password and a tampered file give the same error, and nothing is restored.

**The backup** is read from the team view (Hyperbee), not from the local index: it includes the history and everything the index does not keep.

**Restoring** does not copy the view: it writes the knowledge again as **ordinary team events** (`memory.add`, `memory.supersede`, `memory.archive`, `root.set`, `memory.link`, …), signed by the node that restores. So they reach your colleagues like any other event and follow the same rules. For the team, the author is whoever restores (a signed feed cannot be forged); the original author, date and team are kept in the memory, in `source.origin`, and nodes running older versions ignore them. A memory's id derives from its content: that is how memories already present are recognised and not duplicated.

**Performance.** Events are written in blocks of 500 in a single write, and the index is updated once at the end. Embeddings of the new memories are computed in the background, and semantic neighbours are recomputed all at once. Measured: 5,000 memories restored in about 10 seconds, with the daemon still answering.
