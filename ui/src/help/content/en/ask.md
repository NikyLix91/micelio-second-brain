# Ask

The **Ask** page is a chat with the team memory. Ask a question as you would ask an experienced colleague and you get an answer written only from what the team knows, with its sources, plus a **knowledge map** of the topic.

## Asking a question {#ask}

Write the question and press Enter. Two things start together:
- **the map**, which shows up right away: the relevant memories grouped into themes;
- **the answer**, which arrives a few seconds later. The LLM writes it using **only** the memories found, never general knowledge, and every statement carries the number of the memory it comes from, e.g. [2]. Clicking the number highlights the memory in the map.

Follow-up questions take the conversation into account (the last three questions and answers), so you can ask "and for timeouts?" without repeating the topic.

If the team memory is not enough, the answer says so. With **Report to the team as a gap** the question reaches your colleagues, in the Digest.

## The knowledge map {#map}

On the left the question, then the **themes**, then the **memories**, each with its title and first line. Memories found by the search have a lighter border, those cited in the answer are highlighted, and Roots carry the ◆ symbol.

The dashed lines to the right of the cards are links between memories: same topic, similar meaning, or decided by **dreaming**. Dreaming links are solid and their type shows when you hover them: refines, depends on, contradicts. A contradiction is red.

- **Click a memory:** opens it in the details.
- **+ on a memory:** adds its linked memories next to it.
- **Drag** to move, **wheel** to zoom.

## Saving an answer {#save}

A good answer brings together the knowledge of several memories. **Save as a memory** turns it into a team memory: the title is the question, the text is the answer with its list of sources. It goes the same way as a memory written by hand: privacy filter and, in doubtful cases, the Inbox.

## Conversations {#history}

Conversations stay **on this PC only**: you find them in the left column, and you can rename and delete them. The team does not see them.

## How it works behind the scenes {#internals}

1. **Search, no LLM:** the same hybrid search as the rest of the app (keywords and meaning) finds up to 12 memories, plus the relevant Roots. Then their **neighbours in the constellation** are added, those linked by dreaming first, up to 30 memories.
2. **Map, no LLM:** memories are grouped into themes with the same method as galaxies (communities over their links). Each theme is named after its characteristic tags, until the LLM gives it a more readable name.
3. **Answer:** a single LLM call, with the numbered memories as the only material and the rule not to go beyond them. Model and daily budget are those in **Settings → LLM**. LLM calls are queued: if Micelio is distilling a session, the answer arrives as soon as it is done. Without relevant memories the LLM is not called.
4. **Where the data lives:** conversations are in `private.db` (tables `chats` and `chat_messages`), on this PC only. Questions also show up among the queries of the **Efficacy** page ("chat" channel).
5. **Performance:** with 5,000 memories the map of a question is computed in about a tenth of a second.
