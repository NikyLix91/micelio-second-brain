[Italiano](../spike-fase-0.md) | **English**

# Phase 0 spike

Throwaway experiments to validate the technical choices before writing the product. The spike code isn't maintained and was removed from the repository (it is still in the git history, branch `phase-0-spikes`): the value is in the lessons, recorded in [DESIGN.md](DESIGN.md).

## A: P2P network

**Question:** can Autobase + Hyperswarm handle a team of nodes that join, leave and write at the same time, over the internet?

**Setup:** 3 nodes (plus a fourth that joins late) in Docker containers, public DHT, joining through Autobase *optimistic* blocks.

**Outcome:** ✅ 6 scenarios out of 6. Concurrent writes, deduplication, founder offline, partition, an offline node coming back, a new member joining while the one who invited them is offline. Convergence in 1–2 s, about 40 MB of RAM per node.

**Problems found:**
- With `store.replicate(conn)` (as in the Autobase README) new writers are never discovered. You need `base.replicate(conn)`, which hooks up the *wakeup* protocol.
- Hyperswarm rarely repeats the peer lookup: if the "bridge" node drops, the others stay isolated. A periodic discovery refresh is needed.

**How to run it again** (from the `phase-0-spikes` branch): `cd spikes/a-p2p && npm ci && docker compose up -d && bash scenario.sh`

## B: Headless Claude CLI

**Question:** can we use the user's Claude subscription (no API key) to classify and distill?

**Outcome:** ✅ `claude -p` with `--json-schema` returns structured, validated output. Haiku correctly classifies 5 cases out of 5 (the HR evaluation email and the text with a customer's credentials → `private`) in about 5 s each. Sonnet distills good-quality memories.

**Problems found:**
- On Windows it must be launched without a shell: with `shell: true` the JSON schema passed as an argument breaks.
- The schema must be JSON Schema draft-07: the CLI rejects draft 2020-12 (zod 4's default).
- The default model is the most expensive one: for classification we pick `--model haiku`.
- Distillation adds details that are plausible but absent from the source: the prompt needs a faithfulness rule.

**Not verified:** Codex CLI (no subscription available).

## C: Local embeddings

**Question:** can semantic search run locally, without APIs, on Windows?

**Outcome:** ✅ `multilingual-e5-small` with transformers.js finds the right memory in 4 queries out of 4, even across languages (query in English, memories in Italian). 3.3 ms per text, 130 MB model.

**Caveats:** the process takes about 620 MB of RAM with the model loaded, so it must be loaded in a worker on demand. Similarity scores are compressed (0.80–0.90), so thresholds must be tuned on real data.

## What changed in the move to the product (Phase 1)

- Member joining uses **blind-pairing** instead of optimistic blocks: the encryption key no longer travels in the invite code (decision D2).
- The index uses **`node:sqlite`** instead of better-sqlite3: no native dependencies, so it's simpler on every operating system.
