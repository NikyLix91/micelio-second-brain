# Digest and gaps

The **Digest** page shows what the team learned in the last days and what it does not know yet.

## The team's week {#week}

Computed on the spot from the team view (the same on every PC) and from a few local signals; it is not saved anywhere. It contains:
- **new memories** in the period, by kind and by author, and the latest arrivals;
- **new Roots** and **Roots to review**;
- the **most used** (used in the period, sorted by total uses);
- the team's **open gaps**, the dreams, how many of your searches found nothing and how many memories have changed code.

The period can be chosen (7, 14 or 30 days). From the terminal: `micelio digest --days 7`.

## The Monday notification {#notification}

On Mondays from 9 am the desktop app shows a notification with the week's new memories and open gaps; clicking it opens this page. Once a week: the week already notified is remembered on disk, so a restart does not repeat it.

## Your searches with no answer {#mine}

Every **explicit** search that finds nothing (your agents' `recall` tool, the search in the UI or the CLI) is a clue: a piece of knowledge was needed that the team has not written yet. Requests of the automatic context do not count. Searches are grouped when they say the same thing (same words, in any order, without articles and prepositions) and the text first goes through secret redaction. They stay in `private.db`, **only on this PC**: you can report them to the team or ignore them. If a memory that might fill one has arrived in the meantime, it is shown next to it.

## The team's gaps {#team-gaps}

A **reported** gap (`gap.report`) reaches everyone. If a colleague reports the same question they join those asking it: the more people, the more worthwhile it is to write it. Whoever knows the answer writes the memory and closes the gap (`gap.close`), possibly naming the memory that fills it; Micelio suggests one that might. A closed gap reported again reopens. A question can also be written by hand. From the terminal: `micelio gaps`, `gaps mine`, `gaps report`, `gaps close`.
