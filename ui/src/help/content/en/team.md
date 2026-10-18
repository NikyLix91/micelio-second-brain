# Team

A team is a group of PCs sharing the same knowledge. A project with different people is a separate team.

## Members and roles {#members}

- **Member**: can write to their own feed (memories, votes, Roots, invites). Each member is an Autobase *writer*.
- **Admin**: can also remove and promote members, change the shared settings and redact memories. Admins are also **indexers**: they fix the final order of the team log.

The founder is the first admin. The tree on the Team page shows who joined with whose invite.

## Invites {#invites}

**Any member** can create an invite: a single-use code, valid 24 hours, to be sent only to the person concerned (it is a secret). The colleague uses it with "I have an invite" in the app or with `micelio join <code> --name <pc-name>`. Any online member who has already received the invite accepts them: so, if no other member is online, whoever created the invite must stay on until the colleague has joined.

## Removal {#removal}

Only an admin can remove a member (`member.remove` event): from then on their new events are ignored by everyone. What they had already written stays in the log. Current limit: the removed member keeps the copy of the knowledge already on their PC.

## Shared settings {#shared-settings}

Team settings are `team.config` events, written by an admin and replicated to everyone:
- **language of distilled memories** (Italian or English): memories are born in this language, whatever the language of the source;
- **maximum memories per distillation** (1–20, default 5): see Distillation quality;
- **words that block** a content, in addition to the default ones;
- the **security rules** (Security screen).

The personal settings of your PC (network, folders, LLM models) are in Settings instead.
