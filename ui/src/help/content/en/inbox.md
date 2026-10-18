# Inbox

The inbox collects **only the doubtful cases**: memories the filter could not publish by itself. When in doubt, nothing is published: you decide.

## Why a memory ends up here {#why}

- the classification is not sure enough (confidence below 0.8);
- the content is **mixed**: useful technical knowledge but with sensitive data;
- the memory touches a blocked topic after distillation;
- it is an explicit save but the LLM is not available or the budget is used up.

The reason is written on each item.

## What you can do {#actions}

- **Publish to the team**: the memory enters your feed and reaches everyone;
- **Edit**: change title and text (for example remove a sensitive detail), then publish the corrected version;
- **Keep it for me**: it does not go to the team but stays as a personal memory, only on this PC (see **On your own**);
- **Discard**: the memory does not reach the team; the decision stays in the Private log.

An agent can also show you the inbox (tool `inbox_review`) and apply your decision (`inbox_decide`), only after you have made it.

## Where it lives and how long {#storage}

The inbox is in your `private.db` and is **never replicated**: colleagues do not see your doubtful cases. An item with no decision **expires after 14 days** and is recorded as expired. The desktop app notifies you when new items arrive.
