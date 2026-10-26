# Team

A team is a group of PCs sharing the same knowledge. A project with different people is a separate team.

## Members and roles {#members}

- **Member**: can write to their own feed (memories, votes, Roots, invites). Each member is an Autobase *writer*.
- **Admin**: can also remove and promote members, change the shared settings and redact memories. Admins are also **indexers**: they fix the final order of the team log.

The founder is the first admin. The tree on the Team page shows who joined with whose invite.

## Invites {#invites}

**Any member** can create an invite: a single-use code, valid 24 hours, to be sent only to the person concerned (it is a secret). The colleague uses it with "I have an invite" in the app or with `micelio join <code> --name <pc-name>`. Any online member who has already received the invite accepts them: so, if no other member is online, whoever created the invite must stay on until the colleague has joined.

## Removal {#removal}

Only an admin can remove a member (`member.remove` event): from then on their new events are ignored by everyone. What they had already written stays in the log. With **full protection** (see below) the removed member is also cut off from the team's network and the key changes: they no longer receive or read anything new. What they already had on their PC stays theirs: no system can take it away.

## Full protection {#protection}

Two defenses together, against whoever was removed and against whoever gets hold of the team's data:

1. **Only active members receive the data.** On every connection the peer signs the encrypted session's code with their feed's key; a node replicates the team's data only after this proof, and only if the peer is an active member. Whoever is removed gets cut off right away, by everyone.
2. **Content is encrypted with a per-generation key.** Title, body, tags and source of memories, gap questions, Root flag reasons and dream summaries travel encrypted with the current generation's key. Every active member receives the key encrypted with their personal public key; when an admin removes someone the key changes by itself, and whoever left doesn't get the new one. Even if a member passed them the data, they couldn't read it.

**Turning it on.** It's on in teams created since 0.7.0. In an existing team an admin turns it on from the **Full protection** card of this page, when every member has 0.7.0 or later: the card shows everyone's version. Once on **it can't be turned off**, and from then on a PC with an older version doesn't sync until it updates.

**Changing the key by hand.** After a lost or stolen PC: remove that PC's member, then **Change the key now**. New memories get encrypted with a key that PC doesn't receive.

**Whoever joins later** receives the latest key from an online member and reads the history too: every generation contains the previous one encrypted with the new one, so from the latest you walk back to all of them.

**How it works behind the scenes.** Generation keys are 32 random bytes; content is encrypted with XSalsa20-Poly1305 (libsodium `secretbox`) and grants with `crypto_box_seal` to the member's X25519 key, derived from the pair the node's Corestore always generates the same way (no extra secret file). Opened keys live only in memory and are derived at every start. What every node needs to reach the same view stays in clear, inside the log encryption: ids, kinds, authors, dates, votes, roles and names. Events: `member.boxkey` (public key and version), `keys.rotate` (admins only; between two concurrent rotations the first in the log wins), `keys.grant` (handing it to newcomers). Code: `src/core/team-crypto.ts`, `src/net/team-keys.ts`, `src/net/member-gate.ts`.

## Shared settings {#shared-settings}

Team settings are `team.config` events, written by an admin and replicated to everyone:
- **language of distilled memories** (Italian or English): memories are born in this language, whatever the language of the source;
- **maximum memories per distillation** (1–20, default 5): see Distillation quality;
- **words that block** a content, in addition to the default ones;
- the **security rules** (Security screen).

The personal settings of your PC (network, folders, LLM models) are in Settings instead.
