# Private log

The log shows **what did not reach the team and why**. It exists only on your PC (`private.db`) and is never replicated.

## The outcomes {#outcomes}

| Outcome | Meaning |
|---|---|
| Blocked by the filter | HR/personal topic, protected path or sensitive file: no call to the AI |
| Private | the classification judged it personal |
| Discarded | no reusable knowledge, or no LLM configured |
| Rejected by you | you discarded it from the inbox |
| Expired | it was in the inbox for more than 14 days without a decision |

For each entry: when, the source (session, document, CLI, agent), a preview and the reason.

## What it is for {#use}

To trust the filter: you can check that an evaluation email, a contract or a `.env` did not end up in the team, and understand why a session produced no memories. For the secrets removed from content there is the log on the **Security** screen.
