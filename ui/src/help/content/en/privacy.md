# Privacy filter

The filter decides what must **not** reach the team. It is deterministic (rules, not AI) and runs **on your PC before any call to Claude**: what it blocks never leaves the machine.

## Blocking personal topics {#block}

If the text contains HR or personal topics (evaluations, salaries, disciplinary actions, sick leave…, in Italian and English, plus the words added by the team), the content stays **private**: no LLM call, no publication. The outcome goes to the Private log.

## Redacting secrets and personal data {#redact}

Tokens, API keys, passwords, credentials in URLs, private keys, IBANs, Italian tax codes, emails and phone numbers are replaced by placeholders such as `[REDACTED:github-token]` and the rest goes on (a technical session often contains a token). The full list and the team rules are on the **Security** screen.

## Blocked paths {#paths}

In document folders, files under paths such as `**/hr/**`, `**/contratti/**` (contracts), `**/buste paga/**` (payslips), `**/private/**` are not even opened. **Sensitive files** (`.env`, keys, credentials) are never read, from any source.

## The second pass {#second-pass}

After distillation the filter runs again on the memories produced: if the model reported a sensitive detail that escaped the first redaction, it is removed; if a memory touches a blocked topic, it goes to the inbox instead of the team.

## Doubtful cases {#doubt}

When in doubt, nothing is published: mixed content (technical but with sensitive data), unsure classifications or explicit saves without an available LLM go to your **Inbox**, where you decide.
